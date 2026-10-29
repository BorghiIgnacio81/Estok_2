"""
Multimedia: FotoObjeto.

Parte del paquete inventario/models/ (monolito modularizado).
"""
from django.db import transaction

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

    def save(self, *args, **kwargs):
        """
        Garantiza la EXCLUSIVIDAD de la foto principal: un objeto tiene UNA sola
        foto con `es_principal=True`.

        La regla vive acá (y no en cada vista) porque las fotos se crean/editan
        desde varios caminos: `PATCH /api/fotos/<id>/`, la acción
        `POST /api/fotos/<id>/hacer_principal/`, `subir_foto`, la carga con IA,
        el alta de espacios (`agregar_fotos_objeto`) y el admin de Django.

        El degradado de las hermanas y el guardado de esta foto ocurren en la
        MISMA transacción atómica: si el guardado falla, ninguna otra foto queda
        degradada (nunca se pierde la portada anterior).
        """
        if not self.es_principal:
            return super().save(*args, **kwargs)

        with transaction.atomic():
            hermanas = FotoObjeto.objects.filter(objeto_id=self.objeto_id)
            if self.pk:
                # `exclude(pk=None)` no es válido en Django: sólo se excluye
                # cuando la fila ya existe (edición, no creación).
                hermanas = hermanas.exclude(pk=self.pk)
            hermanas.update(es_principal=False)
            return super().save(*args, **kwargs)
