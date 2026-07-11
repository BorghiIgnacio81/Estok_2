"""
Serializers de Historial de Precios y Alertas de Stock.
"""

from rest_framework import serializers

from ...models import HistorialPrecio, AlertaStock


class HistorialPrecioSerializer(serializers.ModelSerializer):
    class Meta:
        model = HistorialPrecio
        fields = '__all__'
        read_only_fields = ['id', 'fecha_cambio']


class AlertaStockSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlertaStock
        fields = '__all__'
        read_only_fields = ['id', 'created_at']
