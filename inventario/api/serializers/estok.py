"""
Serializers de Estok, Membresía, Códigos de Invitación.
"""

import unicodedata
import uuid

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


# =============================================================================
# ROL DEL CÓDIGO DE INVITACIÓN (selector del modal "Invitar miembros")
# =============================================================================
# El modal manda el UUID del Role, pero se aceptan además los nombres visibles
# ("Solo lectura" / "Lectura y edición") y los nombres reales del RBAC
# ("Visualizador" / "Editor"): así un cliente desactualizado obtiene el rol
# correcto (con sus permisos can_read / can_write / can_edit / can_delete) en
# lugar de romper el alta del código.
ALIAS_ROLES_INVITACION = {
    'solo lectura': 'Visualizador',
    'lectura y edicion': 'Editor',
}


def _clave_rol(valor: str) -> str:
    """Clave laxa de comparación (sin tildes, minúsculas, espacios normalizados)."""
    descompuesto = unicodedata.normalize('NFKD', str(valor))
    sin_tildes = ''.join(c for c in descompuesto if not unicodedata.combining(c))
    return ' '.join(sin_tildes.split()).lower()


def _es_uuid(valor: str) -> bool:
    """True si el valor ya es el UUID del rol (flujo normal del modal)."""
    try:
        uuid.UUID(str(valor))
        return True
    except (TypeError, ValueError, AttributeError):
        return False


class RolInvitacionField(serializers.PrimaryKeyRelatedField):
    """
    Campo `role` del código de invitación: resuelve el UUID del rol o su nombre
    legible y devuelve SIEMPRE la instancia Role real de la base.

    Un rol inexistente responde HTTP 400 con mensaje claro (nunca un 500).
    """

    default_error_messages = {
        'rol_desconocido': 'El rol indicado no existe en el sistema.',
    }

    def to_internal_value(self, data):
        if isinstance(data, str) and not _es_uuid(data):
            nombre = ALIAS_ROLES_INVITACION.get(_clave_rol(data), data.strip())
            role = self.queryset.filter(name__iexact=nombre).first()
            if role is None:
                self.fail('rol_desconocido')
            return role
        return super().to_internal_value(data)


class CodigoInvitacionSerializer(serializers.ModelSerializer):
    estok_nombre = serializers.CharField(source='estok.nombre', read_only=True)
    role_name = serializers.CharField(source='role.name', read_only=True, allow_null=True)
    es_valido = serializers.BooleanField(read_only=True)
    creado_por_username = serializers.CharField(source='creado_por.username', read_only=True, allow_null=True)
    role = RolInvitacionField(queryset=Role.objects.all(), required=False, allow_null=True)

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

    # -------------------------------------------------------------------------
    # Los campos virtuales del modal (`invitado`, `es_usuario_estok` y
    # `enviar_email`) NO son columnas de CodigoInvitacion: DRF los mete igual en
    # validated_data y el Manager los pasaría a CodigoInvitacion(**kwargs), lo
    # que produce TypeError y HTTP 500 en CADA POST. create() los descarta.
    # -------------------------------------------------------------------------
    CAMPOS_VIRTUALES = ('invitado', 'es_usuario_estok', 'enviar_email')

    def create(self, validated_data):
        """
        Crea el código descartando antes los campos que no son del modelo.

        Deja intactos `role`, `usos_maximos`, `fecha_expiracion` y `activo`, que
        sí son columnas reales del código de invitación.
        """
        datos = {
            clave: valor for clave, valor in validated_data.items()
            if clave not in self.CAMPOS_VIRTUALES
        }
        return super().create(datos)

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
