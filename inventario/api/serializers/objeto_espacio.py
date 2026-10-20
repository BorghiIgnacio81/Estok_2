"""
Serializer de las PROPIEDADES DE OBJETO de un espacio declarado.

El panel del editor de espacios y el modal de edición de muebles envían la
totalidad de los datos editables del Objeto espejo:

    · dueno_original / dueno_externo_nombre / beneficiario
    · categoria                      → FK a Categoria del Estok
    · estado_conservacion            → choices canónicos de Objeto
    · valor_estimado                 → decimal ≥ 0 (pesos ARS, sin sufijo USD)
    · descripcion                    → Notas / descripción patrimonial
    · color, material, marca, modelo, numero_serie, autor, anio,
      artista_fabricante, tamano     → campos patrimoniales adicionales
    · fotos                          → imágenes (galería o cámara) del objeto

Las reglas de dominio (resolver/crear el espejo y persistir) viven en
`inventario.services.objeto_espacio`; este serializer sólo valida el contrato.
"""

from rest_framework import serializers

from ...models import Categoria, CustomUser, Membresia
from ...services.objeto_espacio import ESTADOS_CONSERVACION_OBJETO

# Límite por archivo: misma política que `FotoObjetoUploadSerializer`.
MAX_FOTO_BYTES = 10 * 1024 * 1024


class PropiedadesObjetoEspacioSerializer(serializers.Serializer):
    """Contrato de entrada del PUT parcial `/contenedores/{id}/guardar_propiedades_objeto/`.

    También valida el bloque de objeto que viaja PREFIJADO (`objeto_*`) en el
    PUT unificado del espacio (`/contenedores/{id}/`).
    """

    # Id del espejo devuelto por el GET: permite editar el registro exacto
    # aunque el espacio aloje además objetos reales sin casillero.
    objeto_id = serializers.UUIDField(required=False, allow_null=True)

    descripcion = serializers.CharField(
        required=False, allow_blank=True, max_length=5000,
    )
    dueno_original = serializers.PrimaryKeyRelatedField(
        queryset=CustomUser.objects.all(),
        required=False,
        allow_null=True,
    )
    dueno_externo_nombre = serializers.CharField(
        required=False, allow_blank=True, max_length=200,
    )
    beneficiario = serializers.PrimaryKeyRelatedField(
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
    color = serializers.CharField(
        required=False, allow_blank=True, max_length=100,
    )
    material = serializers.CharField(
        required=False, allow_blank=True, max_length=200,
    )
    marca = serializers.CharField(
        required=False, allow_blank=True, max_length=200,
    )
    modelo = serializers.CharField(
        required=False, allow_blank=True, max_length=200,
    )
    numero_serie = serializers.CharField(
        required=False, allow_blank=True, max_length=200,
    )
    autor = serializers.CharField(
        required=False, allow_blank=True, max_length=300,
    )
    anio = serializers.IntegerField(
        required=False, allow_null=True, min_value=0, max_value=2100,
    )
    artista_fabricante = serializers.CharField(
        required=False, allow_blank=True, max_length=300,
    )
    tamano = serializers.CharField(
        required=False, allow_blank=True, max_length=50,
    )
    # Galería / cámara: DRF parsea `getlist('fotos')` en multipart.
    fotos = serializers.ListField(
        child=serializers.ImageField(),
        required=False,
        write_only=True,
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

    def _validar_miembro(self, value, etiqueta):
        """El usuario referenciado debe ser miembro del Estok (o superuser)."""
        contenedor = self._contenedor()
        if value is None or contenedor is None:
            return value
        request = self.context.get('request')
        if request is not None and getattr(request.user, 'is_superuser', False):
            return value
        estok_id = contenedor.ubicacion.estok_id
        if not Membresia.objects.filter(usuario=value, estok_id=estok_id).exists():
            raise serializers.ValidationError(
                f'{etiqueta} debe ser miembro del Estok del espacio.'
            )
        return value

    def validate_dueno_original(self, value):
        """El propietario debe ser miembro del Estok (o el operador superuser)."""
        return self._validar_miembro(value, 'El dueño')

    def validate_beneficiario(self, value):
        """El beneficiario, si se informa, también debe ser miembro del Estok."""
        return self._validar_miembro(value, 'El beneficiario')

    def validate_fotos(self, value):
        """Cada imagen debe respetar el límite de 10 MB (política del sistema)."""
        for archivo in value or []:
            if getattr(archivo, 'size', 0) > MAX_FOTO_BYTES:
                raise serializers.ValidationError(
                    'Cada foto no puede superar los 10MB.'
                )
        return value
