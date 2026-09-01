"""
Serializers del Mapa de Estok (Wizard espacial multi-nivel).

Reciben la estructura jerárquica completa de coordenadas generada por el
wizard del frontend: Nivel 1 (divisiones), Nivel 2 (habitaciones),
Nivel 3 (muebles grandes) y Nivel 4 (estanterías). La validación de
coherencia de coordenadas (parent_grid_row / parent_grid_col contra la
grilla del padre) vive en inventario/services/mapa_estok_service.py.
"""

from rest_framework import serializers


class CeldaMapaSerializer(serializers.Serializer):
    """Una celda del mapa: nombre + sub-grilla propia + nodos del nivel siguiente."""

    nombre = serializers.CharField(max_length=200, allow_blank=False)
    grid_filas = serializers.IntegerField(min_value=1, max_value=12, default=3)
    grid_columnas = serializers.IntegerField(min_value=1, max_value=12, default=3)
    grid_filas_config = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=12),
        required=False,
        allow_null=True,
    )
    parent_grid_row = serializers.IntegerField(min_value=1, max_value=12, required=False)
    parent_grid_col = serializers.IntegerField(min_value=1, max_value=12, required=False)
    # Nodos del nivel siguiente (dicts planos; la recursión profunda la
    # valida el servicio para mantener el serializer acotado y reutilizable).
    nivel_2 = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    nivel_3 = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    nivel_4 = serializers.ListField(child=serializers.DictField(), required=False, default=list)


class MapaEstokSerializer(serializers.Serializer):
    """Payload raíz del wizard: configuración del macro-plano + divisiones."""

    grid_filas = serializers.IntegerField(min_value=1, max_value=12, default=2)
    grid_columnas = serializers.IntegerField(min_value=1, max_value=12, default=2)
    grid_filas_config = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=12),
        required=False,
        allow_null=True,
    )
    nivel_1 = CeldaMapaSerializer(many=True, required=False, default=list)
