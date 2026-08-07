"""
Mensajería: Mensaje.

Parte del paquete inventario/models/ (monolito modularizado).
"""
from .base import (
    models,
    uuid,
)

class Mensaje(models.Model):
    """
    Mensaje de chat interno entre miembros de un Estok.
    Cada mensaje pertenece a un Estok y tiene un remitente.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    estok = models.ForeignKey(
        'inventario.Estok',
        on_delete=models.CASCADE,
        related_name='mensajes',
        verbose_name="Estok"
    )
    remitente = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.SET_NULL,
        null=True,
        related_name='mensajes_enviados',
        verbose_name="Remitente"
    )
    contenido = models.TextField(verbose_name="Contenido del mensaje")
    leido = models.BooleanField(default=False, verbose_name="Leído")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de envío")

    class Meta:
        verbose_name = "Mensaje"
        verbose_name_plural = "Mensajes"
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.remitente.username if self.remitente else '?'}: {self.contenido[:50]}"
