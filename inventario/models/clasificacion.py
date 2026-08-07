"""
Clasificación: Categoria con jerarquía parent / es_contenedor.

Parte del paquete inventario/models/ (monolito modularizado).
"""
from .base import (
    models,
    uuid,
)

class Categoria(models.Model):
    """
    Categoría definida por el usuario para organizar objetos.
    Pertenece a un Estok (aislada por tenant).
    No tiene flujo de venta, fotos ni estados — solo organización y filtros.
    Soporta jerarquía padre/hijo para clasificación en árbol.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nombre = models.CharField(max_length=200, verbose_name="Nombre de la categoría")
    icono = models.CharField(max_length=10, default='🏷️', verbose_name="Ícono (emoji)")
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='hijas',
        verbose_name="Categoría padre",
    )
    es_contenedor = models.BooleanField(
        default=False,
        verbose_name="Es contenedor",
        help_text="Si está marcado, esta categoría puede contener subcategorías.",
    )
    estok = models.ForeignKey(
        'inventario.Estok',
        on_delete=models.CASCADE,
        related_name='categorias',
        verbose_name="Estok"
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de creación")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Última actualización")

    class Meta:
        verbose_name = "Categoría"
        verbose_name_plural = "Categorías"
        ordering = ['nombre']
        unique_together = [('nombre', 'estok')]

    def __str__(self):
        return self.nombre
