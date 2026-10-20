"""
Serializer de las PROPIEDADES DE OBJETO de un espacio declarado.

El panel del editor de espacios envía únicamente las cuatro propiedades
editables del Objeto espejo:

    · dueno_original      → FK a CustomUser (miembro del Estok)
    · categoria           → FK a Categoria del Estok
    · estado_conservacion → choices canónicos de Objeto
    · valor_estimado      → decimal ≥ 0 (valores en pesos ARS, sin sufijo USD)

Las reglas de dominio (resolver/crear el espejo y persistir) viven en
`inventario.services.objeto_espacio`; este serializer sólo valida el contrato.
"""

from rest_framework import serializers

from ...models import Categoria, CustomUser, Membresia
from ...services.objeto_espacio import ESTADOS_CONSERVACION_OBJETO


class PropiedadesObjetoEspacioSerializer(serializers.Serializer):
    """Contrato de entrada del PUT parcial `/contenedores/{id}/guardar_propiedades_objeto/`."""

    # Id del espejo devuelto por el GET: permite editar el registro exacto
    # aunque el espacio aloje además objetos reales sin casillero.
    objeto_id = serializers.UUIDField(required=False, allow_null=True)

    dueno_original = serializers.PrimaryKeyRelatedField(
        queryset=CustomUser.objects.all(),
        required=False,
        allow_null=True,
    )
    categoria = serializers.PrimaryKeyRelatedField(
        queryset=Categoria.objects.all(),
        required=False,
        allow_null=True,
    )
    estado_conservacion = serializers.ChoiceField(
        choices=[(estado, estado) for estado in ESTADOS_CONSERVACION_OBJETO],
        required=False,
    )
    valor_estimado = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        required=False,
        allow_null=True,
        min_value=0,
    )

    def _contenedor(self):
        return self.context.get('contenedor')

    def validate_categoria(self, value):
        """Aislamiento multi-tenant: la categoría debe ser del Estok del espacio."""
        contenedor = self._contenedor()
        if value is None or contenedor is None:
            return value
        estok_id = contenedor.ubicacion.estok_id
        if value.estok_id != estok_id:
            raise serializers.ValidationError(
                'La categoría no pertenece al Estok del espacio.'
            )
        return value

    def validate_dueno_original(self, value):
        """El propietario debe ser miembro del Estok (o el operador superuser)."""
        contenedor = self._contenedor()
        if value is None or contenedor is None:
            return value
        request = self.context.get('request')
        if request is not None and getattr(request.user, 'is_superuser', False):
            return value
        estok_id = contenedor.ubicacion.estok_id
        if not Membresia.objects.filter(usuario=value, estok_id=estok_id).exists():
            raise serializers.ValidationError(
                'El dueño debe ser miembro del Estok del espacio.'
            )
        return value
