"""
Ventas: INGRESO FINANCIERO registrado al cerrar el ciclo de una decisión.

Regla de negocio (paso final de la pestaña /alertas-stock):

Cuando un objeto con decisión de Vender se concreta, el cierre NO puede ser un
borrado silencioso: hay que dejar asiento del ingreso y de QUIÉN lo vendió.
`VentaObjeto.usuario_vendedor_id` es esa contabilidad (el objeto se archiva con
baja lógica `Objeto.deleted_at` y el asiento queda en esta tabla).

Parte del paquete inventario/models/ (monolito modularizado).
"""

from .base import (
    models,
    uuid,
    timezone,
)


class VentaObjeto(models.Model):
    """
    Asiento de la venta de un objeto del Estok (ingreso financiero).

    Lo crea `inventario/services/cierre_service.py` cuando el usuario presiona
    «Marcar como Vendido» en la Sección 1 de /alertas-stock. Sobrevive al
    archivado del objeto: guarda una copia del nombre (`objeto_nombre`) y
    conserva el vendedor aunque la cuenta se elimine (SET_NULL).
    """

    CANAL_MERCADOLIBRE = 'mercadolibre'
    CANAL_FACEBOOK = 'facebook'
    CANAL_INSTAGRAM = 'instagram'
    CANAL_DIRECTO = 'directo'
    CANAL_OTRO = 'otro'

    CANAL_CHOICES = [
        (CANAL_MERCADOLIBRE, 'Mercado Libre'),
        (CANAL_FACEBOOK, 'Facebook Marketplace'),
        (CANAL_INSTAGRAM, 'Instagram'),
        (CANAL_DIRECTO, 'Venta directa'),
        (CANAL_OTRO, 'Otro canal'),
    ]

    MONEDA_USD = 'USD'
    MONEDA_ARS = 'ARS'

    MONEDA_CHOICES = [
        (MONEDA_USD, 'Dólares (USD)'),
        (MONEDA_ARS, 'Pesos argentinos (ARS)'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # El objeto puede archivarse (deleted_at) o eliminarse: el asiento queda.
    objeto = models.ForeignKey(
        'inventario.Objeto',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ventas',
        verbose_name="Objeto vendido"
    )
    # Copia del nombre al momento de la venta (histórico legible sin el objeto).
    objeto_nombre = models.CharField(
        max_length=300,
        verbose_name="Nombre del objeto (al vender)"
    )

    estok = models.ForeignKey(
        'inventario.Estok',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ventas',
        verbose_name="Estok (tenant) que vendió"
    )

    # CONTABILIDAD: quién concretó la venta dentro del Estok.
    usuario_vendedor = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ventas_realizadas',
        verbose_name="Usuario vendedor"
    )

    precio_venta = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Precio de venta"
    )
    moneda = models.CharField(
        max_length=3,
        choices=MONEDA_CHOICES,
        default=MONEDA_USD,
        verbose_name="Moneda"
    )
    canal = models.CharField(
        max_length=20,
        choices=CANAL_CHOICES,
        default=CANAL_MERCADOLIBRE,
        verbose_name="Canal de venta"
    )

    vendido_en = models.DateTimeField(
        default=timezone.now,
        verbose_name="Fecha de la venta"
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de registro")

    class Meta:
        verbose_name = "Venta de objeto"
        verbose_name_plural = "Ventas de objetos"
        ordering = ['-vendido_en']
        indexes = [
            models.Index(fields=['estok', 'vendido_en']),
            models.Index(fields=['usuario_vendedor']),
        ]

    def __str__(self):
        return f"{self.objeto_nombre} → {self.precio_venta or 'sin precio'} {self.moneda}"
