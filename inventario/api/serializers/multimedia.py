"""
Serializers de Fotos de Objetos (multimedia).
"""

from rest_framework import serializers

from ...models import FotoObjeto


class FotoObjetoSerializer(serializers.ModelSerializer):
    """Serializer general para fotos de objetos."""

    class Meta:
        model = FotoObjeto
        fields = '__all__'
        read_only_fields = ['id', 'fecha_subida']


class FotoObjetoUploadSerializer(serializers.ModelSerializer):
    """Serializer para subir fotos a un objeto existente."""

    class Meta:
        model = FotoObjeto
        fields = ['id', 'objeto', 'imagen', 'descripcion', 'es_principal', 'fecha_subida']
        read_only_fields = ['id', 'fecha_subida', 'objeto']

    def validate_imagen(self, value):
        """Valida que el archivo sea una imagen."""
        if value.size > 10 * 1024 * 1024:  # 10MB
            raise serializers.ValidationError("La imagen no puede superar los 10MB.")
        return value
