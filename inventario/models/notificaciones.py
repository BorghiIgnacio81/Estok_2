"""
Notificaciones: AlertaStock.

Parte del paquete inventario/models/ (monolito modularizado).
"""
from .base import (
    models,
    uuid,
)

class AlertaStock(models.Model):
    """
    Define niveles mínimos de reposición para objetos.
    Basado en conceptos de gestión de inventario (Smartsheet).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    objeto = models.OneToOneField(
        'inventario.Objeto',
        on_delete=models.CASCADE,
        related_name='alerta_stock',
        verbose_name="Objeto"
    )
    nivel_minimo = models.PositiveIntegerField(
        default=1,
        verbose_name="Nivel mínimo",
        help_text="Cantidad mínima antes de generar alerta"
    )
    cantidad_actual = models.PositiveIntegerField(
        default=1,
        verbose_name="Cantidad actual"
    )
    activa = models.BooleanField(default=True, verbose_name="Alerta activa")
    ultima_verificacion = models.DateTimeField(
        auto_now=True,
        verbose_name="Última verificación"
    )
    creada_por = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Creada por"
    )

    class Meta:
        verbose_name = "Alerta de stock"
        verbose_name_plural = "Alertas de stock"

    @property
    def necesita_reposicion(self):
        return self.activa and self.cantidad_actual <= self.nivel_minimo

    def __str__(self):
        estado = "⚠️ Reponer" if self.necesita_reposicion else "✅ OK"
        return f"{self.objeto.nombre}: {self.cantidad_actual}/{self.nivel_minimo} {estado}"
