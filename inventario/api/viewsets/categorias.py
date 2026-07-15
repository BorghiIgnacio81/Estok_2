"""
ViewSets para Categorías.
"""

import logging

from rest_framework import viewsets, permissions

from ...models import Categoria
from ..serializers import CategoriaSerializer
from .base import HasRolePermission

logger = logging.getLogger(__name__)


class CategoriaViewSet(viewsets.ModelViewSet):
    queryset = Categoria.objects.all()
    serializer_class = CategoriaSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_queryset(self):
        qs = super().get_queryset()
        estok_id = self.request.headers.get('X-Estok-Id') or self.request.query_params.get('estok_id')
        if estok_id:
            qs = qs.filter(estok_id=estok_id)
        return qs

    def perform_create(self, serializer):
        """
        Asigna automáticamente el estok_id al crear una categoría.
        El estok_id se obtiene del header X-Estok-Id.
        """
        estok_id = self.request.headers.get('X-Estok-Id') or self.request.query_params.get('estok_id')
        if estok_id:
            serializer.save(estok_id=estok_id)
        else:
            serializer.save()
