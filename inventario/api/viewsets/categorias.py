"""
ViewSets para Categorias.
"""

import logging

from rest_framework import viewsets, permissions

from ...models import Categoria, Membresia
from ..serializers import CategoriaSerializer
from .base import HasRolePermission

logger = logging.getLogger(__name__)


class CategoriaViewSet(viewsets.ModelViewSet):
    queryset = Categoria.objects.all()
    serializer_class = CategoriaSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_permissions(self):
        if self.action == 'create':
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset()
        estok_id = self.request.headers.get('X-Estok-Id') or self.request.query_params.get('estok_id')
        if estok_id:
            qs = qs.filter(estok_id=estok_id)
        return qs

    def perform_create(self, serializer):
        """
        Asigna automaticamente el estok_id al crear una categoria.
        El estok_id se obtiene del header X-Estok-Id, query param, o body.
        Valida que el usuario tenga membresia en el Estok destino.
        """
        estok_id = (
            self.request.headers.get('X-Estok-Id')
            or self.request.query_params.get('estok_id')
            or self.request.data.get('estok_id')
        )
        if estok_id:
            # Validar membresia (seguridad sin depender de HasRolePermission)
            if not self.request.user.is_superuser:
                if not Membresia.objects.filter(
                    usuario=self.request.user,
                    estok_id=estok_id
                ).exists():
                    from rest_framework.exceptions import PermissionDenied
                    raise PermissionDenied("No tienes membresia en este Estok.")
            serializer.save(estok_id=estok_id)
        else:
            serializer.save()