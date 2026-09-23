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
            'tipo_layout', 'cantidad_pisos',
            'grid_filas', 'grid_columnas', 'grid_filas_config',
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
    Devuelve el `id` del Estok recién creado (read_only) para que el
    frontend pueda encadenar el Wizard del Mapa sin un ID undefined.
    """

    cantidad_pisos = serializers.IntegerField(min_value=1, max_value=99, required=False, default=1)

    class Meta:
        model = Estok
        fields = ['id', 'nombre', 'descripcion', 'tipo_layout', 'cantidad_pisos']
        read_only_fields = ['id']

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

    # -------------------------------------------------------------------------
    # Campos de SOLO ESCRITURA del modal "Invitar miembros": no son columnas del
    # modelo, viajan en el POST y el ViewSet los consume para despachar el
    # correo (ver CodigoInvitacionViewSet.create + services/email_service.py).
    # -------------------------------------------------------------------------
    invitado = serializers.CharField(
        write_only=True, required=False, allow_blank=True, max_length=254,
        help_text='Email o nombre de usuario del invitado (se acepta cualquiera de los dos).',
    )
    es_usuario_estok = serializers.BooleanField(
        write_only=True, required=False, default=False,
        help_text='True si `invitado` es un nombre de usuario de Estok en vez de un email.',
    )
    enviar_email = serializers.BooleanField(
        write_only=True, required=False, default=False,
        help_text='True para despachar la invitación por SMTP al destinatario indicado.',
    )

    class Meta:
        model = CodigoInvitacion
        fields = [
            'id', 'estok', 'estok_nombre', 'role', 'role_name',
            'codigo', 'creado_por', 'creado_por_username',
            'activo', 'usos_maximos', 'usos_actuales',
            'fecha_expiracion', 'es_valido', 'created_at',
            'invitado', 'es_usuario_estok', 'enviar_email',
        ]
        read_only_fields = ['id', 'codigo', 'usos_actuales', 'created_at', 'estok']

    def validate(self, attrs):
        """El envío por email exige un destinatario: se corta antes de enviar."""
        if attrs.get('enviar_email') and not (attrs.get('invitado') or '').strip():
            raise serializers.ValidationError({
                'invitado': 'Indicá un email o un nombre de usuario para enviar la invitación.',
            })
        return attrs


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
