"""
ViewSets para Estok, Membresia y CodigoInvitacion.
"""

import logging

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from ...models import Estok, Membresia, CodigoInvitacion, Role, CustomUser
from ...services.mapa_estok_service import MapaEstokService
from ..serializers import (
    EstokSerializer, EstokCreateSerializer,
    MembresiaSerializer, CodigoInvitacionSerializer,
    UnirseConCodigoSerializer, CambiarEstokActivoSerializer,
    MapaEstokSerializer,
)
from .base import HasRolePermission, EsAdminDelEstok

logger = logging.getLogger(__name__)


class EstokViewSet(viewsets.ModelViewSet):
    """
    ViewSet para Estoks.
    - GET /api/estoks/ → lista Estoks del usuario autenticado
    - POST /api/estoks/ → crea Estok + Membresia(admin) para el creador
    - GET /api/estoks/{id}/ → detalle del Estok
    - PUT/PATCH /api/estoks/{id}/ → actualizar Estok
    - DELETE /api/estoks/{id}/ → eliminar Estok
    - POST /api/estoks/unirse/ → unirse con codigo de invitacion
    - GET /api/estoks/mis-estoks/ → lista Estoks del usuario
    """
    queryset = Estok.objects.all()
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_permissions(self):
        if self.action in ('unirse', 'mis_estoks', 'create', 'list', 'retrieve'):
            return [permissions.IsAuthenticated()]
        if self.action == 'mapa':
            return [permissions.IsAuthenticated(), EsAdminDelEstok()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'create':
            return EstokCreateSerializer
        return EstokSerializer

    def get_queryset(self):
        """Filtra solo los Estoks donde el usuario es miembro."""
        user = self.request.user
        if user.is_superuser:
            return Estok.objects.all()
        return Estok.objects.filter(miembros__usuario=user)

    @action(detail=False, methods=['get'])
    def mis_estoks(self, request):
        """Lista los Estoks del usuario autenticado."""
        estoks = self.get_queryset()
        serializer = EstokSerializer(estoks, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='mapa')
    def mapa(self, request, pk=None):
        """
        POST /api/estoks/{id}/mapa/

        Persiste el Mapa de Estok generado por el wizard del frontend:
        la jerarquía completa de Ubicaciones (Niveles 1-2) y Contenedores
        (Niveles 3-4) con sus coordenadas, en UNA sola transacción.
        Exige membresía Admin en el Estok (EsAdminDelEstok vía X-Estok-Id)
        y que el Estok del path coincida con el header X-Estok-Id activo.
        """
        estok = self.get_object()

        estok_header = request.headers.get('X-Estok-Id')
        if estok_header and str(estok.id) != str(estok_header):
            return Response(
                {'error': 'El Estok del mapa no coincide con el Estok activo (X-Estok-Id).'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = MapaEstokSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            resultado = MapaEstokService.guardar_mapa(estok, serializer.validated_data)
        except ValidationError as exc:
            detalle = exc.detail
            if isinstance(detalle, (list, tuple)):
                detalle = ' '.join(str(d) for d in detalle)
            return Response(
                {'error': str(detalle)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(resultado, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def unirse(self, request):
        """
        Se une a un Estok usando un codigo de invitacion.
        POST /api/estoks/unirse/ con {codigo: "EST-XXXXXX"}
        """
        serializer = UnirseConCodigoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        codigo = serializer.validated_data['codigo']
        invitacion = CodigoInvitacion.objects.get(codigo=codigo)

        # Verificar que el usuario no sea ya miembro
        if Membresia.objects.filter(usuario=request.user, estok=invitacion.estok).exists():
            return Response(
                {"error": "Ya eres miembro de este Estok."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Usar el codigo (incremento atomico)
        if not invitacion.usar():
            return Response(
                {"error": "El codigo de invitacion ya no es valido."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Crear Membresia con el rol del codigo
        Membresia.objects.create(
            usuario=request.user,
            estok=invitacion.estok,
            role=invitacion.role,
        )

        return Response({
            "mensaje": f"Te has unido a '{invitacion.estok.nombre}' correctamente.",
            "estok": EstokSerializer(invitacion.estok, context={'request': request}).data,
        }, status=status.HTTP_200_OK)


class CodigoInvitacionViewSet(viewsets.ModelViewSet):
    """
    CRUD de codigos de invitacion.
    Solo Admin del Estok puede crear/editar/borrar.
    Cualquier miembro puede listar los codigos de SU Estok.
    """
    queryset = CodigoInvitacion.objects.all()
    serializer_class = CodigoInvitacionSerializer

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [permissions.IsAuthenticated(), EsAdminDelEstok()]
        return [permissions.IsAuthenticated(), HasRolePermission()]

    def get_queryset(self):
        """Filtra por estok_id del header X-Estok-Id."""
        user = self.request.user
        if user.is_superuser:
            return CodigoInvitacion.objects.all()

        estok_id = self.request.headers.get('X-Estok-Id') or self.request.query_params.get('estok_id')
        if estok_id:
            return CodigoInvitacion.objects.filter(estok_id=estok_id)
        return CodigoInvitacion.objects.none()

    def perform_create(self, serializer):
        estok_id = self.request.headers.get('X-Estok-Id') or self.request.data.get('estok')
        serializer.save(
            creado_por=self.request.user,
            estok_id=estok_id,
        )


class CambiarEstokActivoView(viewsets.ViewSet):
    """
    POST /api/usuarios/cambiar_estok_activo/ con {estok_id}
    Actualiza ultimo_estok_activo del usuario.
    """
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request):
        serializer = CambiarEstokActivoSerializer(
            data=request.data,
            context={'request': request}
        )
        serializer.is_valid(raise_exception=True)

        estok_id = serializer.validated_data['estok_id']
        request.user.ultimo_estok_activo_id = estok_id
        request.user.save(update_fields=['ultimo_estok_activo_id'])

        # ── CONTROL ANALÍTICO DE ACCESOS ──────────────────────────────────────
        # Cada carga o conmutación a un Estok (sincronización de inquilinato
        # activo) incrementa en +1 el contador de la Membresia que une al
        # usuario con ese Estok específico. Se usa get_or_create para que, si
        # la fila no existe o quedó en blanco, se cree con éxito y el endpoint
        # devuelva HTTP 200 con el token actualizado sin colapsar (Error 500).
        try:
            membresia, created = Membresia.objects.get_or_create(
                usuario=request.user,
                estok_id=estok_id,
                defaults={'login_count': 0},
            )
            membresia.login_count += 1
            membresia.save(update_fields=['login_count'])
            logger.info(
                "cambiar-estok-activo: login_count de membresia incrementado "
                "(usuario=%s, estok=%s, created=%s, total=%s)",
                request.user.username, estok_id, created, membresia.login_count,
            )
        except Exception as exc:
            # El contador analítico es un control no-crítico: si falla se
            # loguea y NUNCA se tumba el cambio de Estok. Se recupera la
            # membresía para armar la respuesta sin colapsar en producción.
            logger.warning(
                "No se pudo incrementar login_count de la membresia "
                "(usuario=%s, estok=%s): %s",
                request.user.username, estok_id, exc,
            )
            membresia = Membresia.objects.filter(
                usuario=request.user,
                estok_id=estok_id,
            ).select_related('estok', 'role').first()

        return Response({
            "id": str(estok_id),
            "nombre": membresia.estok.nombre if membresia else "",
            "role": membresia.role.name if membresia and membresia.role else None,
            "role_id": str(membresia.role.id) if membresia and membresia.role else None,
        })