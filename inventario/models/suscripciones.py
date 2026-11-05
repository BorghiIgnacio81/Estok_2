"""
Monetización: comprobante de cada intento de compra del plan Pro.

`SuscripcionPago` es el registro legal/auditable de la pasarela de pago
(Mercado Pago Checkout Pro). NO resuelve el plan: la única fuente de verdad del
plan es `inventario/services/suscripcion.py` (que lee `CustomUser.es_premium` /
`Estok.es_premium`). Este modelo sólo deja constancia de:

    quién pagó, cuánto, con qué preferencia, con qué `pago_id` de la pasarela,
    en qué estado quedó y cuántos días de Pro se otorgaron.

Se usa además para la IDEMPOTENCIA del webhook: un pago ya `aprobado` no se
vuelve a aplicar (Mercado Pago reintenta la notificación varias veces).

Parte del paquete inventario/models/ (monolito modularizado).
"""
from .base import models, uuid


class SuscripcionPago(models.Model):
    """
    Pago (o intento de pago) de la suscripción Pro.

    `referencia_externa` es la clave que viaja a Mercado Pago como
    `external_reference`: es el puente entre la notificación de la pasarela y el
    usuario/Estok que se está suscribiendo, sin confiar en el cuerpo del webhook.
    """

    PROVEEDOR_MERCADOPAGO = 'mercadopago'

    ESTADO_PENDIENTE = 'pendiente'
    ESTADO_APROBADO = 'aprobado'
    ESTADO_RECHAZADO = 'rechazado'
    ESTADOS = [
        (ESTADO_PENDIENTE, 'Pendiente de pago'),
        (ESTADO_APROBADO, 'Aprobado (Pro activado)'),
        (ESTADO_RECHAZADO, 'Rechazado / cancelado'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    usuario = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.CASCADE,
        related_name='suscripciones_pago',
        verbose_name="Usuario que paga",
    )
    # El plan Pro se puede vender al HOGAR completo (todos sus miembros heredan
    # `ocultar_publicidad`); si es una compra individual queda en NULL.
    estok = models.ForeignKey(
        'inventario.Estok',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='suscripciones_pago',
        verbose_name="Estok beneficiado",
        help_text="NULL = el plan Pro se activa sólo para el usuario.",
    )
    proveedor = models.CharField(
        max_length=30,
        default=PROVEEDOR_MERCADOPAGO,
        verbose_name="Pasarela de pago",
    )
    plan = models.CharField(max_length=10, default='pro', verbose_name="Plan")
    referencia_externa = models.CharField(
        max_length=80,
        unique=True,
        verbose_name="Referencia externa",
        help_text=(
            "Valor enviado como external_reference a la pasarela. Es la única "
            "credencial con la que el webhook identifica la compra."
        ),
    )
    preferencia_id = models.CharField(
        max_length=120, blank=True, verbose_name="Preferencia de pago",
    )
    pago_id = models.CharField(
        max_length=120, blank=True, verbose_name="ID de pago de la pasarela",
    )
    estado = models.CharField(
        max_length=20,
        choices=ESTADOS,
        default=ESTADO_PENDIENTE,
        verbose_name="Estado",
    )
    monto = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Monto",
    )
    moneda = models.CharField(max_length=8, default='ARS', verbose_name="Moneda")
    dias_otorgados = models.PositiveIntegerField(
        default=30, verbose_name="Días de Pro otorgados",
    )
    init_point = models.URLField(
        max_length=500, blank=True, verbose_name="URL de checkout",
    )
    detalle = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Detalle crudo",
        help_text="Última respuesta de la pasarela (pago o preferencia).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Pago de suscripción"
        verbose_name_plural = "Pagos de suscripción"
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['estado']),
            models.Index(fields=['pago_id']),
        ]

    def __str__(self):
        return f"{self.usuario_id} · {self.estado} · {self.referencia_externa}"
