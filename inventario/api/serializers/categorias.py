"""
Serializers de Categorías.
"""

from rest_framework import serializers

from ...models import Categoria


class CategoriaSerializer(serializers.ModelSerializer):
    estok = serializers.PrimaryKeyRelatedField(read_only=True)
    objetos_count = serializers.SerializerMethodField()

    class Meta:
        model = Categoria
        fields = '__all__'
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'estok', 'es_sistema',
        ]

    def get_objetos_count(self, obj):
        """Cuenta solo objetos NO eliminados (excluye soft-delete)."""
        return obj.objetos.filter(deleted_at__isnull=True).count()
