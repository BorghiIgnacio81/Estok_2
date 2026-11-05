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

    # ------------------------------------------------------------------
    # PROPIEDAD Y MONETIZACIÓN DEL HOGAR
    # ------------------------------------------------------------------
    # `creador` es el dueño original del hogar (quien lo dio de alta con
    # POST /api/estoks/). Es la pieza que hace posible la REGLA DE HERENCIA:
    # si el creador tiene plan Pro, TODOS los miembros heredan
    # `ocultar_publicidad = True` (ver inventario/services/suscripcion.py).
    creador = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='estoks_creados',
        verbose_name="Creador del Estok",
        help_text="Dueño original del hogar. Si es premium, sus miembros no ven publicidad.",
    )
    # Plan a nivel HOGAR: permite vender el plan al Estok completo sin depender
    # de que el creador siga siendo el titular de la cuenta.
    es_premium = models.BooleanField(
        default=False,
        verbose_name="Estok premium",
        help_text="El hogar tiene plan Pro: todos sus miembros navegan sin publicidad.",
    )
    plan_suscripcion = models.CharField(
        max_length=10,
        choices=[('free', 'Gratuito (con publicidad)'), ('pro', 'Pro (sin publicidad)')],
        default='free',
        verbose_name="Plan del hogar",
    )
    limite_objetos = models.PositiveIntegerField(
        null=True,
        blank=True,
        default=100,
        verbose_name="Límite de objetos del hogar",
        help_text="Tope de objetos del plan gratuito (100). NULL = ilimitado (plan Pro).",
    )
    ocultar_publicidad = models.BooleanField(
        default=False,
        verbose_name="Ocultar publicidad en el hogar",
        help_text="Se propaga a los miembros cuando el hogar (o su creador) es premium.",
    )

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
    cantidad_pisos = models.PositiveIntegerField(
        default=1,
        verbose_name="Cantidad de plantas (pisos) del inmueble",
        help_text="Pregunta inicial obligatoria del alta de Estok: si es mayor a 1 se activa el Modo Casa (casa con techo puntiagudo y layout multi-planta); si es exactamente 1 se activa el Modo Planta Única (departamento de perímetro continuo, sin techo)."
    )
    grid_filas = models.PositiveIntegerField(
        default=3,
        verbose_name="Filas de la grilla del macro-Estok",
        help_text="Cantidad de filas de la grilla estilo Word del macro-Estok (por piso)."
    )
    grid_columnas = models.PositiveIntegerField(
        default=3,
        verbose_name="Columnas de la grilla del macro-Estok",
        help_text="Cantidad de columnas de la grilla estilo Word del macro-Estok (por piso)."
    )
    grid_filas_config = models.JSONField(
        null=True,
        blank=True,
        verbose_name="Columnas por fila del macro-plano (grilla asimétrica)",
        help_text="Arreglo opcional con las columnas de cada fila del macro-plano (ej: [3,2]). Si es null, todas las filas usan grid_columnas."
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de creación")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Última actualización")

    def save(self, *args, **kwargs):
        """
        Mantiene SIEMPRE coherente el binomio cantidad_pisos ↔ tipo_layout,
        sin importar el punto de entrada (API de usuario, panel Admin Global
        o admin de Django):
          - cantidad_pisos > 1  → 'CASA_2_PISOS'      (Modo Casa)
          - cantidad_pisos == 1 → 'VISTA_PLANTA_UNICA' (Modo Planta Única)
        Si se pasa update_fields, se agrega 'tipo_layout' para no omitirlo.
        """
        try:
            cantidad = int(self.cantidad_pisos or 1)
        except (TypeError, ValueError):
            cantidad = 1
        self.tipo_layout = 'CASA_2_PISOS' if cantidad > 1 else 'VISTA_PLANTA_UNICA'
        update_fields = kwargs.get('update_fields')
        if update_fields is not None:
            kwargs['update_fields'] = set(update_fields) | {'tipo_layout'}
        super().save(*args, **kwargs)

    class Meta:
        verbose_name = "Estok"
        verbose_name_plural = "Estoks"
        ordering = ['nombre']

    def __str__(self):
        return self.nombre
