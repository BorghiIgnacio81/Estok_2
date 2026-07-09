"""
ViewSet para el chat interno entre miembros de un Estok.
SEGURIDAD: Aislamiento estricto por estok_id. Ningún mensaje puede
filtrarse entre Estoks diferentes.
"""

import logging

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from ...models import Mensaje, Membresia, Role
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

    SEGURIDAD: Aislamiento estricto por estok_id.
    - get_queryset() SIEMPRE filtra por estok_id, incluso para superusers.
    - perform_create() valida membresía activa antes de guardar.
    - El estok_id se obtiene EXCLUSIVAMENTE del query param, no del header.
    """
    queryset = Mensaje.objects.all()
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]
    pagination_class = None

    def _get_estok_id(self):
        """
        Obtiene el estok_id del query param.
        NO usa header X-Estok-Id para evitar inconsistencias.
        Retorna None si no está presente.
        """
        return self.request.query_params.get('estok_id')

    def _validar_membresia(self, user, estok_id):
        """
        Valida que el usuario tenga una membresía activa en el Estok.
        Retorna True si es miembro, False en caso contrario.
        Los superusers también pasan esta validación.
        """
        if user.is_superuser:
            return True
        if not estok_id:
            return False
        return Membresia.objects.filter(usuario=user, estok_id=estok_id).exists()

    def get_serializer_class(self):
        if self.action == 'create':
            return MensajeCreateSerializer
        return MensajeSerializer

    def get_queryset(self):
        """
        Filtra mensajes por el Estok activo (query param estok_id).
        AISLAMIENTO ESTRICTO: NO existe fallback global.
        - Si el usuario no es miembro del Estok → QuerySet vacío.
        - Si no hay estok_id → QuerySet vacío (no se filtran datos de otros Estoks).
        - Incluso superusers deben pasar por estok_id (aunque tienen membresía virtual).
        """
        user = self.request.user
        estok_id = self._get_estok_id()

        if not estok_id:
            # Sin estok_id no se devuelve NADA
            return Mensaje.objects.none()

        if not self._validar_membresia(user, estok_id):
            return Mensaje.objects.none()

        return Mensaje.objects.filter(
            estok_id=estok_id
        ).select_related('remitente').order_by('created_at')

    def perform_create(self, serializer):
        """
        Crea un mensaje con validación estricta de membresía.
        El estok_id se obtiene del query param (única fuente confiable).
        Se valida membresía ANTES de guardar para prevenir inyecciones manuales.
        """
        user = self.request.user
        estok_id = self._get_estok_id()

        if not estok_id:
            raise PermissionDenied("Estok ID requerido (query param estok_id)")

        if not self._validar_membresia(user, estok_id):
            raise PermissionDenied("No eres miembro de este Estok")

        serializer.save()

    @action(detail=True, methods=['patch'])
    def marcar_leido(self, request, pk=None):
        """Marca un mensaje como leído, validando que pertenezca al Estok del usuario."""
        mensaje = self.get_object()
        estok_id = self._get_estok_id()

        # Verificar que el mensaje pertenezca al Estok activo del usuario
        if estok_id and str(mensaje.estok_id) != str(estok_id):
            return Response(
                {'error': 'El mensaje no pertenece al Estok activo'},
                status=status.HTTP_403_FORBIDDEN
            )

        mensaje.leido = True
        mensaje.save(update_fields=['leido'])
        return Response({'status': 'ok', 'leido': True})

    @action(detail=False, methods=['get'])
    def no_leidos(self, request):
        """Retorna la cantidad de mensajes no leídos del Estok activo."""
        estok_id = self._get_estok_id()
        if not estok_id:
            return Response({'no_leidos': 0})

        if not self._validar_membresia(request.user, estok_id):
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
        estok_id = self._get_estok_id()
        if not estok_id:
            return Response({'error': 'Query param estok_id requerido'}, status=status.HTTP_400_BAD_REQUEST)

        # Verificar que el usuario sea Admin del Estok
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
