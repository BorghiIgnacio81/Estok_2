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
    # ID real de la categoría en Mercado Libre Argentina (ej: "MLA412445").
    # Es la ÚNICA fuente de verdad al publicar: el servicio de publicación lee
    # este campo y lo usa de forma ESTRICTA como `category_id` del POST /items.
    # Si está vacío, se predice con el NOMBRE de la categoría (jamás con el
    # título del objeto, que provocaba desvíos absurdos) y se persiste acá.
    # Aplica a TODAS las categorías (las 11 del sistema y las que crea el
    # usuario), por lo que el catálogo NO está limitado a una lista fija.
    mercadolibre_category_id = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        verbose_name="ID Categoría Mercado Libre",
        help_text="ID de categoría de Mercado Libre en formato MLAxxxxx (ej: MLA412445).",
    )
    # Distingue las 11 categorías macro del sistema (es_sistema=True) de las
    # creadas dinámicamente por usuarios (es_sistema=False). La limpieza
    # destructiva del seeding SOLO aplica sobre es_sistema=True; las de usuario
    # están BLINDADAS contra delete() (bug crítico de pérdida de datos).
    es_sistema = models.BooleanField(
        default=False,
        verbose_name="Categoría del sistema",
        help_text=(
            "True si es una de las 11 categorías macro oficiales de Mercado "
            "Libre inyectadas por el sistema. Las categorías creadas por "
            "usuarios son False y el seeding jamás las elimina."
        ),
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

    def save(self, *args, **kwargs):
        """Normaliza el ID de Mercado Libre (sin espacios, en mayúsculas).

        Evita que un "mla412445" o " MLA412445 " guardado desde el API quede
        como un mapeo inválido y termine desviando la publicación.
        """
        if self.mercadolibre_category_id:
            self.mercadolibre_category_id = self.mercadolibre_category_id.strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.nombre
