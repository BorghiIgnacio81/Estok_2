"""
Metodos del modelo Objeto separados de los campos para mantener
productos.py por debajo del limite de 400 lineas (Fase A refactor preventivo).
"""

from .base import (
    models,
    uuid,
    timezone,
)


class ObjetoMetodosMixin:
    """Metodos de instancia de Objeto (soft delete + consultas de descarte)."""

    def __str__(self):
        return self.nombre

    # ------------------------------------------------------------------
    # UBICACIÓN RESUELTA CON FALLBACK (contenedor → espacio → ubicación)
    # ------------------------------------------------------------------
    @property
    def contenedor_nombre(self):
        """
        Nombre del contenedor/espacio del objeto con la jerarquía de fallback.

        `contenedor` → Objeto contenedor («espacio») → `ubicacion`. Devuelve
        `Contenedor ausente` SOLO cuando las tres referencias son nulas. La
        regla vive en `services/ubicacion_objeto.py` (fuente única, compartida
        con los serializers).
        """
        from ..services.ubicacion_objeto import (
            TEXTO_CONTENEDOR_AUSENTE,
            nombre_contenedor_objeto,
        )

        return nombre_contenedor_objeto(self) or TEXTO_CONTENEDOR_AUSENTE

    @property
    def ubicacion_display(self):
        """Ruta física completa («Habitación · Mueble · Caja») o el aviso final."""
        from ..services.ubicacion_objeto import etiqueta_ubicacion_objeto

        return etiqueta_ubicacion_objeto(self)

    # ------------------------------------------------------------------
    # CONSULTAS DE DESCARTE (derivadas, sin duplicar la lógica del service)
    # ------------------------------------------------------------------
    @property
    def en_periodo_gracia(self):
        """
        True si hay orden de tirar y el plazo de reclamo TODAVÍA NO venció.

        Es la condición que mantiene el objeto visible en el Bloque 4 y activa
        el contador regresivo del Alerta Rojo del Bloque 2 del frontend.
        """
        if self.owner_action != 'tirar' or self.fecha_limite_descarte is None:
            return False
        return timezone.now() < self.fecha_limite_descarte

    @property
    def descarte_listo_para_ejecutar(self):
        """
        True si hay orden de tirar y ya se puede ejecutar el descarte FÍSICO.

        Ocurre cuando no se fijó período de gracia (Estok de un solo usuario) o
        cuando la fecha límite almacenada ya venció.
        """
        if self.owner_action != 'tirar':
            return False
        if self.fecha_limite_descarte is None:
            return True
        return timezone.now() >= self.fecha_limite_descarte

    @property
    def segundos_para_descarte(self):
        """
        Segundos restantes del período de gracia (None si no hay plazo activo).

        El frontend lo usa como respaldo del contador regresivo cuando el reloj
        del navegador está desfasado del servidor.
        """
        if not self.en_periodo_gracia:
            return None
        return int((self.fecha_limite_descarte - timezone.now()).total_seconds())

    def delete(self, using=None, keep_parents=False):
        """Soft delete: marca como eliminado en lugar de borrar."""
        self.deleted_at = timezone.now()
        self.save()

    def hard_delete(self, using=None, keep_parents=False):
        """Eliminación física real (uso con precaución)."""
        super().delete(using=using, keep_parents=keep_parents)
