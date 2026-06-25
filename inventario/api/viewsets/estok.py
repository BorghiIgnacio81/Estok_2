"""
ViewSets para Estok, Membresia y CodigoInvitacion.
"""

import logging

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from ...models import Estok, Membresia, CodigoInvitacion, Role, CustomUser
from ..serializers import (
    EstokSerializer, EstokCreateSerializer,
    MembresiaSerializer, CodigoInvitacionSerializer,
    UnirseConCodigoSerializer, CambiarEstokActivoSerializer,
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
    - POST /api/estoks/unirse/ → unirse con código de invitación
    - GET /api/estoks/mis-estoks/ → lista Estoks del usuario
    """
    queryset = Estok.objects.all()
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_permissions(self):
        if self.action in ('unirse', 'mis_estoks'):
            return [permissions.IsAuthenticated()]
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

    @action(detail=False, methods=['post'])
    def unirse(self, request):
        """
        Se une a un Estok usando un código de invitación.
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

        # Usar el código (incremento atómico)
        if not invitacion.usar():
            return Response(
                {"error": "El código de invitación ya no es válido."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Crear Membresia con el rol del código
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
    CRUD de códigos de invitación.
    Solo Admin del Estok puede crear/editar/borrar.
    Cualquier miembro puede listar los códigos de SU Estok.
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

        return Response({
            "mensaje": "Estok activo actualizado.",
            "ultimo_estok_activo_id": str(estok_id),
        })
