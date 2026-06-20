"""
ViewSet para fotos de objetos.
"""

from rest_framework import viewsets, permissions

from ...models import FotoObjeto
from ..serializers import FotoObjetoSerializer
from .base import HasRolePermission


class FotoObjetoViewSet(viewsets.ModelViewSet):
    queryset = FotoObjeto.objects.all()
    serializer_class = FotoObjetoSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_queryset(self):
        qs = super().get_queryset()
        objeto_id = self.request.query_params.get('objeto')
        if objeto_id:
            qs = qs.filter(objeto_id=objeto_id)
        return qs
