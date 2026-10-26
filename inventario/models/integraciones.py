"""
Integraciones: MercadoLibreToken y MercadoLibrePublicacion.

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


class MercadoLibrePublicacion(models.Model):
    """
    Publicación de un Objeto en Mercado Libre (una por objeto).

    POR QUÉ EXISTE: POST /items devuelve un `item_id` que es el ÚNICO dato que
    permite, después, pausar la publicación (objeto vendido o sin stock) o
    darla de baja (objeto eliminado) con PUT /items/{item_id}. Sin persistirlo
    la sincronización de stock es imposible.

    Se guarda también el `usuario` dueño del token OAuth que publicó porque los
    tokens de Mercado Libre son POR USUARIO: la sincronización debe usar la
    misma cuenta que creó el ítem.

    El campo legacy `meli_id` (presente solo en algunos despliegues) se sigue
    leyendo de forma defensiva en services/mercadolibre_publicacion.py.
    """
    ESTADO_ACTIVO = 'active'
    ESTADO_PAUSADO = 'paused'
    ESTADO_CERRADO = 'closed'
    ESTADO_CHOICES = [
        (ESTADO_ACTIVO, 'Activa'),
        (ESTADO_PAUSADO, 'Pausada'),
        (ESTADO_CERRADO, 'Cerrada'),
    ]

    objeto = models.OneToOneField(
        'inventario.Objeto',
        on_delete=models.CASCADE,
        related_name='publicacion_ml',
        verbose_name="Objeto",
    )
    usuario = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='publicaciones_ml',
        verbose_name="Usuario que publicó",
        help_text="Dueño del token OAuth con el que se creó el ítem en Mercado Libre.",
    )
    item_id = models.CharField(
        max_length=40,
        unique=True,
        verbose_name="ID del ítem en Mercado Libre",
    )
    status = models.CharField(
        max_length=20,
        choices=ESTADO_CHOICES,
        default=ESTADO_ACTIVO,
        verbose_name="Estado en Mercado Libre",
    )
    permalink = models.URLField(
        max_length=300,
        blank=True,
        verbose_name="Enlace a la publicación",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Publicación de Mercado Libre"
        verbose_name_plural = "Publicaciones de Mercado Libre"

    def __str__(self):
        return f"{self.item_id} ({self.status})"
