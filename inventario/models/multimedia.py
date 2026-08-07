"""
Multimedia: FotoObjeto.

Parte del paquete inventario/models/ (monolito modularizado).
"""
from .base import (
    models,
    uuid,
)

class FotoObjeto(models.Model):
    """
    Almacena múltiples imágenes por objeto.
    Esencial para informes de valoración para seguros.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    objeto = models.ForeignKey(
        'inventario.Objeto',
        on_delete=models.CASCADE,
        related_name='fotos',
        verbose_name="Objeto"
    )
    imagen = models.ImageField(
        upload_to='fotos_objetos/%Y/%m/',
        verbose_name="Imagen"
    )
    descripcion = models.CharField(
        max_length=300,
        blank=True,
        verbose_name="Descripción de la foto"
    )
    es_principal = models.BooleanField(
        default=False,
        verbose_name="Foto principal",
        help_text="Marcar si esta es la imagen principal del objeto"
    )
    fecha_subida = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Fecha de subida"
    )

    class Meta:
        verbose_name = "Foto del objeto"
        verbose_name_plural = "Fotos de objetos"
        ordering = ['-es_principal', 'fecha_subida']

    def __str__(self):
        return f"Foto de: {self.objeto.nombre} ({self.fecha_subida.strftime('%d/%m/%Y')})"
