"""
Serializers de Organización Espacial (Ubicaciones y Contenedores).
"""

from rest_framework import serializers

from ...models import Ubicacion, Contenedor


class UbicacionSerializer(serializers.ModelSerializer):
    objetos_count = serializers.SerializerMethodField()
    contenedores_count = serializers.SerializerMethodField()

    class Meta:
        model = Ubicacion
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_objetos_count(self, obj):
        """Cuenta solo objetos NO eliminados (excluye soft-delete)."""
        return obj.objetos.filter(deleted_at__isnull=True).count()

    def get_contenedores_count(self, obj):
        """Cuenta los contenedores dentro de esta ubicación."""
        return obj.contenedores.count()


class ContenedorSerializer(serializers.ModelSerializer):
    ubicacion_nombre = serializers.CharField(source='ubicacion.nombre', read_only=True)
    qr_code_url = serializers.SerializerMethodField()
    objetos_count = serializers.SerializerMethodField()
    # Campos de dimensiones y material (editable desde el frontend)
    largo = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True)
    ancho = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True)
    alto = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True)
    foto = serializers.ImageField(required=False, allow_null=True)
    material = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    tipo_madera = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = Contenedor
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at', 'qr_code_image']

    def get_qr_code_url(self, obj):
        """Retorna la URL completa del código QR."""
        if obj.qr_code_image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.qr_code_image.url)
            return obj.qr_code_image.url
        return None

    def get_objetos_count(self, obj):
        """Retorna la cantidad de objetos NO eliminados dentro del contenedor."""
        return obj.objetos.filter(deleted_at__isnull=True).count()
