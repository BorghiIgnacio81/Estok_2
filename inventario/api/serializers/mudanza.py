"""
Serializer del endpoint de Mudanza Inter-Estok (POST /api/inventario/mudanza/).
"""

from rest_framework import serializers


class MudanzaSerializer(serializers.Serializer):
    """
    Valida la solicitud de transferencia entre Estoks.

    Reglas:
      - Se transfiere EXACTAMENTE un elemento: `contenedor_id` O `objeto_id`.
      - `estok_destino_id` es obligatorio.
      - `ubicacion_destino_id` / `contenedor_destino_id` son opcionales:
        si llegan, deben pertenecer al Estok destino (lo valida la vista).
      - `en_transito=True` (zona «En Tránsito» del tablero): el elemento viaja
        al Estok destino SIN destino espacial explícito. Es EXCLUYENTE con
        `ubicacion_destino_id` / `contenedor_destino_id`: o se suelta en una
        habitación real, o se deja en el limbo del nuevo inquilinato.
    """

    contenedor_id = serializers.UUIDField(required=False, allow_null=True)
    objeto_id = serializers.UUIDField(required=False, allow_null=True)
    estok_destino_id = serializers.UUIDField(required=True)
    ubicacion_destino_id = serializers.UUIDField(required=False, allow_null=True)
    contenedor_destino_id = serializers.UUIDField(required=False, allow_null=True)
    en_transito = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        tiene_contenedor = attrs.get('contenedor_id') is not None
        tiene_objeto = attrs.get('objeto_id') is not None
        if tiene_contenedor == tiene_objeto:
            raise serializers.ValidationError(
                "Debe indicar exactamente un `contenedor_id` o un `objeto_id`."
            )
        if attrs.get('en_transito') and (
            attrs.get('ubicacion_destino_id') or attrs.get('contenedor_destino_id')
        ):
            raise serializers.ValidationError(
                "«En Tránsito» es excluyente: no se puede indicar una ubicación "
                "o un contenedor destino al mismo tiempo."
            )
        # El destino espacial es opcional. Si llega `contenedor_destino_id`,
        # la ubicación destino se resuelve desde ese contenedor en la vista.
        return attrs
