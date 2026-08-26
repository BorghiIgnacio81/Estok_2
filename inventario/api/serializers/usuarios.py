"""
Serializers de Usuarios y Roles.
"""

import logging
from rest_framework import serializers
from django.contrib.auth import get_user_model

from ...models import Role, CustomUser
from ...services.email_service import TIPO_BIENVENIDA, enviar_email_usuario

logger = logging.getLogger(__name__)
User = get_user_model()


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']


class UserSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()
    membresias = serializers.SerializerMethodField()

    class Meta:
        model = CustomUser
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'description', 'phone', 'display_name',
            'is_active', 'date_joined', 'membresias',
            'tiene_clave_temporal',
        ]
        read_only_fields = ['id', 'date_joined', 'membresias']

    def get_display_name(self, obj):
        """
        Retorna el nombre visible del usuario según el Estok activo.
        Si el usuario tiene un alias configurado para el Estok actual,
        muestra ese alias. Si no, muestra get_full_name() o username.

        REGLA DE PRIVACIDAD (SOLO para SoledadMartinez):
        - Si el usuario que CONSULTA es SoledadMartinez, y el usuario
          consultado tiene apellido "Borghi", se oculta completamente
          mostrando "Yamza" en lugar del nombre real.
        - Para cualquier otro usuario, se muestra el nombre real.
        """
        request = self.context.get('request')

        if request and obj.alias_por_estok:
            estok_id = request.headers.get('X-Estok-Id') or request.query_params.get('estok_id')
            if estok_id and str(estok_id) in obj.alias_por_estok:
                return obj.alias_por_estok[str(estok_id)]

        # REGLA DE PRIVACIDAD: Solo SoledadMartinez ve "Yamza" para ygumy44
        # NUNCA debe poder leer "Ignacio Borghi" ni ninguna variante
        if request and request.user.username == 'SoledadMartinez':
            if obj.username == 'ygumy44':
                return 'Yamza'
            if obj.last_name and 'Borghi' in obj.last_name:
                return 'Yamza'
            if obj.first_name and 'Ignacio' in obj.first_name:
                return 'Yamza'

        return obj.get_full_name() or obj.username

    def get_membresias(self, obj):
        """
        Retorna las membresías del usuario con información del Estok y rol.
        Solo visible para superusers (ygumy44) en el panel de administración.
        """
        request = self.context.get('request')
        # Solo incluir membresías si el request existe y es superuser
        if not request or not request.user.is_superuser:
            return []

        from ...models import Membresia
        membresias = Membresia.objects.filter(
            usuario=obj
        ).select_related('estok', 'role')

        return [
            {
                "id": str(m.id),
                "estok_id": str(m.estok.id),
                "estok_nombre": m.estok.nombre,
                "role_id": str(m.role.id) if m.role else None,
                "role_nombre": m.role.name if m.role else None,
                "joined_at": m.joined_at.isoformat() if m.joined_at else None,
            }
            for m in membresias
        ]


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, style={'input_type': 'password'})

    class Meta:
        model = CustomUser
        fields = [
            'username', 'email', 'password', 'first_name', 'last_name',
            'description', 'phone',
        ]

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = CustomUser(**validated_data)
        user.set_password(password)
        user.save()

        # Envío de email de bienvenida (servicio centralizado reutilizable:
        # también lo usa el panel de superadmin en
        # POST /api/admin/usuarios/{id}/enviar_mail/)
        enviar_email_usuario(user, tipo=TIPO_BIENVENIDA, password=password)

        return user