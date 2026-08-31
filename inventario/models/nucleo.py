"""
Núcleo: Estok (tenant raíz).

Parte del paquete inventario/models/ (monolito modularizado).
"""
from .base import (
    models,
    uuid,
)

class Estok(models.Model):
    """
    Representa una cuenta de Estok: un inventario compartido entre usuarios.
    Cada usuario puede pertenecer a múltiples Estoks.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nombre = models.CharField(max_length=200, default='Mi Inventario', verbose_name="Nombre del Estok")
    descripcion = models.TextField(blank=True, verbose_name="Descripción")
    tipo_layout = models.CharField(
        max_length=50,
        choices=[
            ('CASA_2_PISOS', 'Casa de 2 pisos'),
            ('VISTA_PLANTA_UNICA', 'Vista planta única'),
        ],
        default='VISTA_PLANTA_UNICA',
        verbose_name="Tipo de layout del mapa espacial",
        help_text="Define cómo se renderiza el mapa espacial del Estok (inquilino)."
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de creación")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Última actualización")

    class Meta:
        verbose_name = "Estok"
        verbose_name_plural = "Estoks"
        ordering = ['nombre']

    def __str__(self):
        return self.nombre
