"""
ViewSet para el chat interno entre miembros de un Estok.
"""

import logging

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from ...models import Mensaje
from ..serializers import MensajeSerializer, MensajeCreateSerializer
from .base import HasRolePermission

logger = logging.getLogger(__name__)


class MensajeViewSet(viewsets.ModelViewSet):
    """
    ViewSet para mensajes de chat interno.
    - GET /api/mensajes/ → lista mensajes del Estok activo
    - POST /api/mensajes/ → enviar un mensaje
    - GET /api/mensajes/{id}/ → detalle de un mensaje
    - PATCH /api/mensajes/{id}/marcar_leido/ → marcar como leído

    IMPORTANTE: Sin paginación (pagination_class = None) para que el chat
    pueda cargar TODOS los mensajes del Estok. La paginación global (PAGE_SIZE=25)
    rompe el chat porque los mensajes nuevos quedan en páginas siguientes
    y el frontend nunca los carga.
    """
    queryset = Mensaje.objects.all()
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]
    pagination_class = None

    def get_serializer_class(self):
        if self.action == 'create':
            return MensajeCreateSerializer
        return MensajeSerializer

    def get_queryset(self):
        """
        Filtra mensajes por el Estok activo (query param estok_id).
        SOLO devuelve mensajes si el usuario es miembro del Estok.
        NO usa el header X-Estok-Id porque el frontend ahora pasa el
        estok_id exclusivamente como query param para evitar inconsistencias.
        """
        user = self.request.user
        if user.is_superuser:
            return Mensaje.objects.all()

        estok_id = self.request.query_params.get('estok_id')
        if estok_id:
            # Verificar que el usuario sea miembro del Estok
            from ...models import Membresia
            if not Membresia.objects.filter(usuario=user, estok_id=estok_id).exists():
                return Mensaje.objects.none()
            return Mensaje.objects.filter(estok_id=estok_id).select_related('remitente').order_by('created_at')
        return Mensaje.objects.none()

    def perform_create(self, serializer):
        # El serializer MensajeCreateSerializer.create() ya maneja
        # la asignación de remitente y estok_id desde el request.
        # Pero verificamos membresía aquí también por seguridad
        user = self.request.user
        estok_id = self.request.query_params.get('estok_id')
        if estok_id:
            from ...models import Membresia
            if not Membresia.objects.filter(usuario=user, estok_id=estok_id).exists():
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("No eres miembro de este Estok")
        serializer.save()

    @action(detail=True, methods=['patch'])
    def marcar_leido(self, request, pk=None):
        """Marca un mensaje como leído."""
        mensaje = self.get_object()
        mensaje.leido = True
        mensaje.save(update_fields=['leido'])
        return Response({'status': 'ok', 'leido': True})

    @action(detail=False, methods=['get'])
    def no_leidos(self, request):
        """Retorna la cantidad de mensajes no leídos del Estok activo."""
        estok_id = request.headers.get('X-Estok-Id') or request.query_params.get('estok_id')
        if not estok_id:
            return Response({'no_leidos': 0})

        count = Mensaje.objects.filter(
            estok_id=estok_id,
            leido=False,
        ).exclude(remitente=request.user).count()

        return Response({'no_leidos': count})

    @action(detail=False, methods=['delete'])
    def purge(self, request):
        """
        PURGA TOTAL: Elimina TODOS los mensajes del Estok activo de la base de datos.
        Solo accesible para usuarios con rol Admin del Estok.
        Esto borra los mensajes del servidor de forma permanente.
        """
        estok_id = request.headers.get('X-Estok-Id') or request.query_params.get('estok_id')
        if not estok_id:
            return Response({'error': 'Header X-Estok-Id requerido'}, status=status.HTTP_400_BAD_REQUEST)

        # Verificar que el usuario sea Admin del Estok
        from ...models import Membresia, Role
        try:
            role_admin = Role.objects.get(name='Admin')
            membresia = Membresia.objects.get(usuario=request.user, estok_id=estok_id, role=role_admin)
        except (Role.DoesNotExist, Membresia.DoesNotExist):
            return Response({'error': 'Solo un Admin del Estok puede purgar el chat'}, status=status.HTTP_403_FORBIDDEN)

        # Contar cuántos se van a eliminar
        count = Mensaje.objects.filter(estok_id=estok_id).count()

        # Eliminar todos los mensajes del Estok
        Mensaje.objects.filter(estok_id=estok_id).delete()

        logger.warning(f"PURGA CHAT: Usuario {request.user.username} eliminó {count} mensajes del Estok {estok_id}")

        return Response({
            'status': 'ok',
            'eliminados': count,
            'mensaje': f'Se eliminaron {count} mensajes permanentemente'
        })
