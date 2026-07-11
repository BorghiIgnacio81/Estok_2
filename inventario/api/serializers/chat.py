"""
Serializers de Chat Interno (Mensajes).
"""

from rest_framework import serializers

from ...models import Mensaje, Membresia


class MensajeSerializer(serializers.ModelSerializer):
    """Serializer para mensajes de chat interno."""
    remitente_nombre = serializers.SerializerMethodField()
    remitente_username = serializers.SerializerMethodField()

    class Meta:
        model = Mensaje
        fields = [
            'id', 'estok', 'remitente', 'remitente_nombre', 'remitente_username',
            'contenido', 'leido', 'created_at',
        ]
        read_only_fields = ['id', 'remitente', 'created_at']

    def get_remitente_nombre(self, obj):
        if obj.remitente:
            # REGLA DE PRIVACIDAD ABSOLUTA: SoledadMartinez NO debe ver "Borghi" ni "Ignacio"
            request = self.context.get('request')
            if request and request.user.username == 'SoledadMartinez':
                remitente_str = f"{obj.remitente.username} {obj.remitente.first_name} {obj.remitente.last_name}".lower()
                if 'ygumy44' in remitente_str or 'borghi' in remitente_str or 'ignacio' in remitente_str:
                    return 'Yamza'

            # Usar alias si está configurado para este Estok
            request = self.context.get('request')
            if request and obj.remitente.alias_por_estok:
                estok_id = str(obj.estok_id)
                if estok_id in obj.remitente.alias_por_estok:
                    return obj.remitente.alias_por_estok[estok_id]
            return obj.remitente.get_full_name() or obj.remitente.username
        return None

    def get_remitente_username(self, obj):
        if obj.remitente:
            return obj.remitente.username
        return None


class MensajeCreateSerializer(serializers.ModelSerializer):
    """Serializer para crear un mensaje."""

    class Meta:
        model = Mensaje
        fields = ['contenido']

    def create(self, validated_data):
        request = self.context.get('request')
        if not request:
            raise serializers.ValidationError({"error": "Contexto de request requerido"})

        # SOLO query param estok_id (única fuente confiable)
        estok_id = request.query_params.get('estok_id')
        if not estok_id:
            raise serializers.ValidationError({"error": "Estok ID requerido (query param estok_id)"})

        # Validar membresía del usuario en el Estok
        if not request.user.is_superuser:
            if not Membresia.objects.filter(usuario=request.user, estok_id=estok_id).exists():
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("No eres miembro de este Estok")

        mensaje = Mensaje.objects.create(
            estok_id=estok_id,
            remitente=request.user,
            **validated_data
        )
        return mensaje
