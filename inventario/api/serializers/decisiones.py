"""
Serializers del módulo de Decisiones (votaciones democráticas del Estok).
"""

from rest_framework import serializers

from ...models import CustomUser, DecisionVotacion, VotoDecision


class VotoDecisionSerializer(serializers.ModelSerializer):
    """Voto individual (lectura)."""

    usuario_nombre = serializers.SerializerMethodField()
    beneficiario_nombre = serializers.SerializerMethodField()
    opcion_label = serializers.CharField(source='get_opcion_display', read_only=True)

    class Meta:
        model = VotoDecision
        fields = [
            'id', 'usuario', 'usuario_nombre',
            'opcion', 'opcion_label',
            'beneficiario', 'beneficiario_nombre',
            'comentario', 'created_at',
        ]

    def get_usuario_nombre(self, obj):
        return obj.usuario.get_full_name() or obj.usuario.username

    def get_beneficiario_nombre(self, obj):
        if not obj.beneficiario:
            return None
        return obj.beneficiario.get_full_name() or obj.beneficiario.username


class DecisionVotacionSerializer(serializers.ModelSerializer):
    """Votación completa con su padrón y los votos emitidos."""

    votos = VotoDecisionSerializer(many=True, read_only=True)
    objeto_nombre = serializers.CharField(source='objeto.nombre', read_only=True, default=None)
    motivo_label = serializers.CharField(source='get_motivo_display', read_only=True)
    total_votantes = serializers.SerializerMethodField()

    class Meta:
        model = DecisionVotacion
        fields = [
            'id', 'objeto', 'objeto_nombre', 'estok',
            'motivo', 'motivo_label', 'estado',
            'resultado', 'total_votantes', 'votos',
            'creada_por', 'resuelta_en', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'resuelta_en', 'resultado']

    def get_total_votantes(self, obj):
        """Padrón democrático: miembros con Membresia en el Estok de la votación."""
        from ...services.decisiones_service import total_votantes

        return total_votantes(obj.estok_id)


class VotoCreateSerializer(serializers.Serializer):
    """Payload del POST /api/decisiones/{id}/votar/."""

    opcion = serializers.ChoiceField(choices=DecisionVotacion.OPCION_CHOICES)
    beneficiario = serializers.PrimaryKeyRelatedField(
        queryset=CustomUser.objects.all(),
        required=False,
        allow_null=True,
    )
    comentario = serializers.CharField(required=False, allow_blank=True, max_length=1000)

    def validate(self, attrs):
        if (
            attrs.get('opcion') == DecisionVotacion.OPCION_ASIGNAR_BENEFICIARIO
            and not attrs.get('beneficiario')
        ):
            raise serializers.ValidationError(
                {'beneficiario': 'Elegí el beneficiario que proponés.'}
            )
        return attrs
