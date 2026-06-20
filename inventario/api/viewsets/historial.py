"""
ViewSets para historial de precios y alertas de stock.
"""

from rest_framework import viewsets, permissions

from ...models import HistorialPrecio, AlertaStock
from ..serializers import HistorialPrecioSerializer, AlertaStockSerializer
from .base import HasRolePermission


class HistorialPrecioViewSet(viewsets.ModelViewSet):
    queryset = HistorialPrecio.objects.all()
    serializer_class = HistorialPrecioSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_queryset(self):
        qs = super().get_queryset()
        objeto_id = self.request.query_params.get('objeto')
        if objeto_id:
            qs = qs.filter(objeto_id=objeto_id)
        return qs.order_by('-fecha_cambio')


class AlertaStockViewSet(viewsets.ModelViewSet):
    queryset = AlertaStock.objects.all()
    serializer_class = AlertaStockSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_queryset(self):
        qs = super().get_queryset()
        solo_criticas = self.request.query_params.get('solo_criticas')
        if solo_criticas:
            qs = qs.filter(necesita_reposicion=True)
        return qs
