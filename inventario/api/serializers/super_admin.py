"""
Serializers del panel Modo Dios (Super Admin).

Vista global de auditoría: CRUD completo e independiente de CustomUser y Estok.
Solo accesible por el usuario 'ygumy44' (ver IsYgumyMaster en viewsets/super_admin.py).

Están aislados del flujo multi-tenant normal: NO filtran por Estok ni por las
membresías del usuario autenticado. Es una vista global intencional.
"""

from rest_framework import serializers

from ...models import CustomUser, Estok, Membresia


class SuperAdminUserSerializer(serializers.ModelSerializer):
    """
    Serializer de lectura/edición de CustomUser para el panel Modo Dios.
    - Incluye resumen de membresías sin importar el Estok activo del request.
    - `password` es opcional: si se envía, se actualiza la contraseña encriptada.
    - `display_name` es independiente: no aplica reglas de privacidad por Estok.
    """
    display_name = serializers.SerializerMethodField()
    membresias = serializers.SerializerMethodField()
    ultimo_estok_activo_id = serializers.UUIDField(
        source='ultimo_estok_activo_id',
        read_only=True,
        allow_null=True,
    )
    password = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=False,
        style={'input_type': 'password'},
    )

    class Meta:
        model = CustomUser
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'description', 'phone', 'display_name',
            'is_active', 'is_superuser', 'password',
            'date_joined', 'ultimo_estok_activo_id', 'membresias',
        ]
        read_only_fields = ['id', 'date_joined']

    def get_display_name(self, obj):
        return obj.get_full_name() or obj.username

    def get_membresias(self, obj):
        membresias = Membresia.objects.filter(
            usuario=obj
        ).select_related('estok', 'role')
        return [
            {
                'id': str(m.id),
                'estok_id': str(m.estok.id),
                'estok_nombre': m.estok.nombre,
                'role_id': str(m.role.id) if m.role else None,
                'role_nombre': m.role.name if m.role else None,
                'joined_at': m.joined_at.isoformat() if m.joined_at else None,
            }
            for m in membresias
        ]

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class SuperAdminUserCreateSerializer(serializers.ModelSerializer):
    """
    Serializer de creación de CustomUser para el panel Modo Dios.
    Encripta la contraseña con set_password(). No envía email de bienvenida
    (es una operación de auditoría global, no de auto-registro).
    """
    password = serializers.CharField(
        write_only=True,
        style={'input_type': 'password'},
    )

    class Meta:
        model = CustomUser
        fields = [
            'username', 'email', 'password',
            'first_name', 'last_name', 'description', 'phone',
            'is_active', 'is_superuser',
        ]

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = CustomUser(**validated_data)
        user.set_password(password)
        user.save()
        return user


class SuperAdminEstokSerializer(serializers.ModelSerializer):
    """
    Serializer de Estok (inquilino) para el panel Modo Dios.
    Vista global: muestra todos los miembros y conteos, sin filtros de Estok.
    """
    miembros = serializers.SerializerMethodField()
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

    def get_miembros(self, obj):
        membresias = Membresia.objects.filter(
            estok=obj
        ).select_related('usuario', 'role')
        return [
            {
                'id': str(m.id),
                'usuario_id': str(m.usuario.id),
                'username': m.usuario.username,
                'display_name': m.usuario.get_full_name() or m.usuario.username,
                'email': m.usuario.email,
                'role_id': str(m.role.id) if m.role else None,
                'role_nombre': m.role.name if m.role else None,
                'joined_at': m.joined_at.isoformat() if m.joined_at else None,
            }
            for m in membresias
        ]

    def get_miembros_count(self, obj):
        return obj.miembros.count()

    def get_objetos_count(self, obj):
        return obj.objetos.count()
