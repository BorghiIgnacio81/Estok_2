"""
Serializers de Estok, Membresía, Códigos de Invitación.
"""

from rest_framework import serializers

from ...models import Estok, Membresia, CodigoInvitacion, Role


class MembresiaSerializer(serializers.ModelSerializer):
    usuario_username = serializers.CharField(source='usuario.username', read_only=True)
    usuario_email = serializers.CharField(source='usuario.email', read_only=True)
    role_name = serializers.CharField(source='role.name', read_only=True, allow_null=True)

    class Meta:
        model = Membresia
        fields = [
            'id', 'usuario', 'usuario_username', 'usuario_email',
            'estok', 'role', 'role_name', 'joined_at',
        ]
        read_only_fields = ['id', 'joined_at']


class EstokSerializer(serializers.ModelSerializer):
    miembros = MembresiaSerializer(many=True, read_only=True)
    miembros_count = serializers.SerializerMethodField()
    objetos_count = serializers.SerializerMethodField()

    class Meta:
        model = Estok
        fields = [
            'id', 'nombre', 'descripcion',
            'miembros', 'miembros_count', 'objetos_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_miembros_count(self, obj):
        return obj.miembros.count()

    def get_objetos_count(self, obj):
        return obj.objetos.count()


class EstokCreateSerializer(serializers.ModelSerializer):
    """
    Serializer para crear un Estok.
    Auto-asigna al usuario autenticado como Admin del Estok.
    """

    class Meta:
        model = Estok
        fields = ['nombre', 'descripcion']

    def create(self, validated_data):
        user = self.context['request'].user
        role_admin = Role.objects.get(name='Admin')

        estok = Estok.objects.create(**validated_data)

        Membresia.objects.create(
            usuario=user,
            estok=estok,
            role=role_admin,
        )

        return estok


class CodigoInvitacionSerializer(serializers.ModelSerializer):
    estok_nombre = serializers.CharField(source='estok.nombre', read_only=True)
    role_name = serializers.CharField(source='role.name', read_only=True, allow_null=True)
    es_valido = serializers.BooleanField(read_only=True)
    creado_por_username = serializers.CharField(source='creado_por.username', read_only=True, allow_null=True)

    class Meta:
        model = CodigoInvitacion
        fields = [
            'id', 'estok', 'estok_nombre', 'role', 'role_name',
            'codigo', 'creado_por', 'creado_por_username',
            'activo', 'usos_maximos', 'usos_actuales',
            'fecha_expiracion', 'es_valido', 'created_at',
        ]
        read_only_fields = ['id', 'codigo', 'usos_actuales', 'created_at', 'estok']


class UnirseConCodigoSerializer(serializers.Serializer):
    codigo = serializers.CharField(max_length=20)

    def validate_codigo(self, value):
        try:
            invitacion = CodigoInvitacion.objects.get(codigo=value)
        except CodigoInvitacion.DoesNotExist:
            raise serializers.ValidationError("El código de invitación no existe.")

        if not invitacion.es_valido:
            raise serializers.ValidationError("El código de invitación ya no es válido (expirado, desactivado o sin usos disponibles).")

        return value


class CambiarEstokActivoSerializer(serializers.Serializer):
    estok_id = serializers.UUIDField()

    def validate_estok_id(self, value):
        user = self.context['request'].user
        if not Membresia.objects.filter(usuario=user, estok_id=value).exists():
            raise serializers.ValidationError("No eres miembro de este Estok.")
        return value
