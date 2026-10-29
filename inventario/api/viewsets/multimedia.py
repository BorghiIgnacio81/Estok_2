"""
ViewSet para fotos de objetos.
"""

from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response

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

    @action(detail=True, methods=['post'])
    def hacer_principal(self, request, pk=None):
        """
        Marca esta foto como la ÚNICA principal de su objeto.

        La exclusividad (degradar las demás + promover ésta) es atómica y vive
        en `FotoObjeto.save()`, así que acá sólo se pide el cambio y se devuelve
        la galería YA normalizada: el frontend reemplaza su estado local con
        esta lista y no tiene que adivinar cuál foto perdió el badge.
        """
        foto = self.get_object()
        foto.es_principal = True
        foto.save(update_fields=['es_principal'])

        fotos = FotoObjeto.objects.filter(
            objeto_id=foto.objeto_id
        ).order_by('-es_principal', 'fecha_subida')
        return Response(self.get_serializer(fotos, many=True).data)

