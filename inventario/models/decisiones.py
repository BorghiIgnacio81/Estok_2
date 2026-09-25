"""
Decisiones: votaciones democráticas del Estok.

Regla de negocio (CRÍTICA): cuando un Objeto se cataloga con DUEÑO ORIGINAL
(lleno, sea usuario de la plataforma o un dueño externo registrado como texto
plano) y SIN BENEFICIARIO, el sistema abre automáticamente una VOTACIÓN
PENDIENTE. Todos los usuarios con Membresia activa en ese Estok (tenant
X-Estok-Id) votan de forma democrática en la pestaña "Decisiones" para asignar
el beneficiario final o resolver el destino del objeto (vender/conservar/tirar).

Parte del paquete inventario/models/ (monolito modularizado).
"""
from .base import (
    models,
    uuid,
    timezone,
)


class DecisionVotacion(models.Model):
    """
    Votación abierta a los miembros de un Estok sobre el destino de un Objeto.

    Nace SIEMPRE en estado 'pendiente' (ver services/decisiones_service.py) y se
    resuelve por mayoría simple cuando votaron todos los miembros activos.
    """

    # ------------------------------------------------------------------
    # Motivo de apertura
    # ------------------------------------------------------------------
    MOTIVO_SIN_BENEFICIARIO = 'dueno_sin_beneficiario'
    MOTIVO_CHOICES = [
        (MOTIVO_SIN_BENEFICIARIO, 'Dueño original definido sin beneficiario'),
    ]

    # ------------------------------------------------------------------
    # Estado de la votación
    # ------------------------------------------------------------------
    ESTADO_PENDIENTE = 'pendiente'
    ESTADO_RESUELTA = 'resuelta'
    ESTADO_CANCELADA = 'cancelada'
    ESTADO_CHOICES = [
        (ESTADO_PENDIENTE, 'Pendiente'),
        (ESTADO_RESUELTA, 'Resuelta'),
        (ESTADO_CANCELADA, 'Cancelada'),
    ]

    # ------------------------------------------------------------------
    # Opciones que puede elegir cada votante
    # ------------------------------------------------------------------
    OPCION_ASIGNAR_BENEFICIARIO = 'asignar_beneficiario'
    OPCION_VENDER = 'vender'
    OPCION_CONSERVAR = 'conservar'
    OPCION_TIRAR = 'tirar'
    OPCION_CHOICES = [
        (OPCION_ASIGNAR_BENEFICIARIO, 'Asignar beneficiario'),
        (OPCION_VENDER, 'Vender'),
        (OPCION_CONSERVAR, 'Conservar'),
        (OPCION_TIRAR, 'Tirar / Desechar'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    objeto = models.ForeignKey(
        'inventario.Objeto',
        on_delete=models.CASCADE,
        related_name='decisiones',
        verbose_name="Objeto en disputa"
    )
    estok = models.ForeignKey(
        'inventario.Estok',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='decisiones',
        verbose_name="Estok (tenant) que vota"
    )

    motivo = models.CharField(
        max_length=40,
        choices=MOTIVO_CHOICES,
        default=MOTIVO_SIN_BENEFICIARIO,
        verbose_name="Motivo de la votación"
    )
    estado = models.CharField(
        max_length=20,
        choices=ESTADO_CHOICES,
        default=ESTADO_PENDIENTE,
        verbose_name="Estado"
    )

    creada_por = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='decisiones_creadas',
        verbose_name="Creada por"
    )

    # Resultado consolidado al cerrar: opción ganadora + beneficiario elegido.
    resultado = models.JSONField(
        blank=True,
        default=dict,
        verbose_name="Resultado",
        help_text="Resumen de la decisión: opción ganadora, conteos y beneficiario asignado."
    )
    resuelta_en = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Fecha de resolución"
    )

    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de apertura")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Última actualización")

    class Meta:
        verbose_name = "Votación de decisión"
        verbose_name_plural = "Votaciones de decisión"
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['estado', 'estok']),
        ]

    def __str__(self):
        return f"Votación {self.get_estado_display()} · {self.objeto_id}"

    @property
    def esta_pendiente(self):
        return self.estado == self.ESTADO_PENDIENTE

    def cerrar(self, resultado=None):
        """Marca la votación como resuelta y sella la fecha de cierre."""
        self.estado = self.ESTADO_RESUELTA
        self.resuelta_en = timezone.now()
        if resultado is not None:
            self.resultado = resultado
        self.save(update_fields=['estado', 'resultado', 'resuelta_en', 'updated_at'])


class VotoDecision(models.Model):
    """
    Voto individual de un miembro activo del Estok sobre una DecisionVotacion.

    Un usuario vota UNA sola vez por votación (unique_together): volver a votar
    actualiza su voto (no agrega uno nuevo), garantizando una democracia 1-a-1.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    votacion = models.ForeignKey(
        DecisionVotacion,
        on_delete=models.CASCADE,
        related_name='votos',
        verbose_name="Votación"
    )
    usuario = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.CASCADE,
        related_name='votos_decision',
        verbose_name="Votante"
    )

    opcion = models.CharField(
        max_length=30,
        choices=DecisionVotacion.OPCION_CHOICES,
        verbose_name="Opción elegida"
    )
    # Solo cuando la opción es 'asignar_beneficiario'.
    beneficiario = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='votos_como_beneficiario',
        verbose_name="Beneficiario propuesto"
    )
    comentario = models.TextField(blank=True, verbose_name="Comentario")

    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha del voto")

    class Meta:
        verbose_name = "Voto de decisión"
        verbose_name_plural = "Votos de decisión"
        ordering = ['created_at']
        unique_together = [('votacion', 'usuario')]

    def __str__(self):
        return f"{self.usuario_id} → {self.opcion}"
