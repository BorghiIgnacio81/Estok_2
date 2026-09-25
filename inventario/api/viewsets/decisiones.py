"""
ViewSet del módulo de Decisiones (votaciones democráticas del Estok).

Rutas (registradas como `/api/decisiones/`):
    GET  /api/decisiones/                 → votaciones del tenant
    GET  /api/decisiones/?estado=pendiente
    GET  /api/decisiones/pendientes/      → solo pendientes (pestaña Decisiones)
    GET  /api/decisiones/{id}/            → detalle con votos y conteos
    POST /api/decisiones/{id}/votar/      → voto de un miembro activo
    POST /api/decisiones/{id}/cerrar/     → cierre manual (Admin del Estok)

Aislamiento multi-tenant: el Estok SIEMPRE se resuelve por el header
X-Estok-Id (o query param `estok_id`); nunca se acepta del body.
"""

from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from ...models import DecisionVotacion, Membresia
from ...services import decisiones_service
from ..serializers.decisiones import DecisionVotacionSerializer, VotoCreateSerializer
from .base import HasRolePermission


class DecisionVotacionViewSet(viewsets.ReadOnlyModelViewSet):
    """Votaciones de decisión del Estok activo."""

    serializer_class = DecisionVotacionSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    # ------------------------------------------------------------------
    # Helpers de tenant
    # ------------------------------------------------------------------
    def _estok_id(self):
        """Estok activo del request (header X-Estok-Id con fallback a query)."""
        return (
            self.request.headers.get('X-Estok-Id')
            or self.request.query_params.get('estok_id')
        )

    def _es_miembro(self, user, estok_id):
        """Padrón democrático: miembro del Estok o superuser."""
        if user.is_superuser:
            return True
        if not estok_id:
            return False
        return Membresia.objects.filter(usuario=user, estok_id=estok_id).exists()

    def _es_admin(self, user, estok_id):
        """Admin del Estok (o superuser) para el cierre manual."""
        if user.is_superuser:
            return True
        return Membresia.objects.filter(
            usuario=user, estok_id=estok_id, role__name='Admin'
        ).exists()

    # ------------------------------------------------------------------
    # Lectura
    # ------------------------------------------------------------------
    def get_queryset(self):
        estok_id = self._estok_id()
        if not estok_id:
            return DecisionVotacion.objects.none()
        qs = (
            DecisionVotacion.objects.filter(estok_id=estok_id)
            .select_related('objeto', 'estok', 'creada_por')
            .prefetch_related('votos__usuario', 'votos__beneficiario')
        )
        estado = self.request.query_params.get('estado')
        if estado:
            qs = qs.filter(estado=estado)
        return qs

    @action(detail=False, methods=['get'])
    def pendientes(self, request):
        """Votaciones abiertas del tenant, listas para votar."""
        estok_id = self._estok_id()
        votaciones = (
            decisiones_service.votaciones_pendientes(estok_id) if estok_id else []
        )
        resultados = [
            decisiones_service.serializar_votacion(votacion, request.user)
            for votacion in votaciones
        ]
        return Response({'count': len(resultados), 'results': resultados})

    # ------------------------------------------------------------------
    # Votar
    # ------------------------------------------------------------------
    @action(detail=True, methods=['post'])
    def votar(self, request, pk=None):
        """
        Registra el voto del miembro autenticado.

        Un usuario = un voto por votación (volver a votar lo actualiza). Al
        completarse el padrón y existir ganador claro, la votación se resuelve
        y el resultado se aplica automáticamente al objeto.
        """
        votacion = self.get_object()

        if not self._es_miembro(request.user, votacion.estok_id):
            return Response(
                {'error': 'Solo los usuarios del Estok pueden votar esta decisión.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = VotoCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        votacion, aviso = decisiones_service.registrar_voto(
            votacion,
            request.user,
            serializer.validated_data['opcion'],
            serializer.validated_data.get('beneficiario'),
            serializer.validated_data.get('comentario', ''),
        )
        votacion.refresh_from_db()

        payload = decisiones_service.serializar_votacion(votacion, request.user)
        payload['aviso'] = aviso
        payload['mensaje'] = aviso or 'Voto registrado correctamente.'
        return Response(payload, status=status.HTTP_200_OK)

    # ------------------------------------------------------------------
    # Cierre manual
    # ------------------------------------------------------------------
    @action(detail=True, methods=['post'])
    def cerrar(self, request, pk=None):
        """Cierra la votación con el resultado vigente (solo Admin del Estok)."""
        votacion = self.get_object()

        if not self._es_admin(request.user, votacion.estok_id):
            return Response(
                {'error': 'Solo un Admin del Estok puede cerrar esta votación.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not votacion.esta_pendiente:
            return Response(
                {'error': 'La votación ya está cerrada.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        decisiones_service.cerrar_votacion(votacion)
        votacion.refresh_from_db()

        payload = decisiones_service.serializar_votacion(votacion, request.user)
        payload['mensaje'] = 'Votación cerrada y decisión aplicada al objeto.'
        return Response(payload, status=status.HTTP_200_OK)
