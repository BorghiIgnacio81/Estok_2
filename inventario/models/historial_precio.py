"""
HistorialPrecio, separado de productos.py para mantener el limite de 400
lineas (Fase A refactor preventivo).
"""

from .base import (
    models,
    uuid,
    timezone,
)


class HistorialPrecio(models.Model):
    """
    Registra cada cambio en el valor_estimado de un objeto.
    Permite calcular plusvalía/depreciación para informes de seguros.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    objeto = models.ForeignKey(
        'inventario.Objeto',
        on_delete=models.CASCADE,
        related_name='historial_precios',
        verbose_name="Objeto"
    )
    valor_anterior = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Valor anterior (USD)"
    )
    valor_nuevo = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        verbose_name="Valor nuevo (USD)"
    )
    diferencia = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Diferencia (USD)"
    )
    porcentaje_cambio = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Porcentaje de cambio"
    )
    motivo = models.CharField(
        max_length=200,
        blank=True,
        verbose_name="Motivo del cambio",
        help_text="Ej: Revalorización, Depreciación, Actualización por IA, etc."
    )
    registrado_por = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Registrado por"
    )
    fecha_cambio = models.DateTimeField(auto_now_add=True, verbose_name="Fecha del cambio")

    class Meta:
        verbose_name = "Historial de precio"
        verbose_name_plural = "Historial de precios"
        ordering = ['-fecha_cambio']

    def save(self, *args, **kwargs):
        if self.valor_anterior is not None and self.valor_nuevo is not None:
            self.diferencia = self.valor_nuevo - self.valor_anterior
            if self.valor_anterior != 0:
                self.porcentaje_cambio = (
                    (self.valor_nuevo - self.valor_anterior) / self.valor_anterior
                ) * 100
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.objeto.nombre}: ${self.valor_anterior} → ${self.valor_nuevo}"
