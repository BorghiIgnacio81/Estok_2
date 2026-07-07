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
    """
    queryset = Mensaje.objects.all()
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_serializer_class(self):
        if self.action == 'create':
            return MensajeCreateSerializer
        return MensajeSerializer

    def get_queryset(self):
        """Filtra mensajes por el Estok activo (header X-Estok-Id)."""
        user = self.request.user
        if user.is_superuser:
            return Mensaje.objects.all()

        estok_id = self.request.headers.get('X-Estok-Id') or self.request.query_params.get('estok_id')
        if estok_id:
            return Mensaje.objects.filter(estok_id=estok_id).select_related('remitente')
        return Mensaje.objects.none()

    def perform_create(self, serializer):
        # El serializer MensajeCreateSerializer.create() ya maneja
        # la asignación de remitente y estok_id desde el request.
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
