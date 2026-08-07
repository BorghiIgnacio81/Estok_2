"""
Integraciones: MercadoLibreToken.

Parte del paquete inventario/models/ (monolito modularizado).
"""
from .base import (
    models,
)

class MercadoLibreToken(models.Model):
    """
    Token OAuth de MercadoLibre asociado a un usuario.
    Cada usuario puede tener un solo token activo a la vez.
    """
    usuario = models.OneToOneField(
        'inventario.CustomUser',
        on_delete=models.CASCADE,
        related_name='mercadolibre_token',
        verbose_name="Usuario"
    )
    access_token = models.TextField(verbose_name="Token de acceso")
    refresh_token = models.TextField(verbose_name="Token de refresh")
    token_type = models.CharField(max_length=50, default='Bearer')
    expires_in = models.IntegerField(default=21600, verbose_name="Segundos hasta expirar")
    scope = models.TextField(blank=True, verbose_name="Scopes autorizados")
    ml_user_id = models.BigIntegerField(null=True, blank=True, verbose_name="User ID de ML")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Token de MercadoLibre"
        verbose_name_plural = "Tokens de MercadoLibre"

    def __str__(self):
        return f"ML Token de {self.usuario.username} (user_id={self.ml_user_id})"
