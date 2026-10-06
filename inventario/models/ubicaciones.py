"""
Ubicaciones físicas del Estok: divisiones de planta y habitaciones (Nivel 1/2).

Extraído de inventario/models/espacios.py para respetar el límite de
mantenibilidad (< 400 líneas por archivo). La fachada inventario/models/__init__.py
sigue re-exportando Ubicacion, así que ningún consumidor cambia.
"""
from .base import (
    models,
    uuid,
)


class Ubicacion(models.Model):
    """
    Representa una ubicación física general (ej: "Garaje", "Sótano", "Oficina").
    Pertenece a un Estok.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nombre = models.CharField(max_length=200, verbose_name="Nombre")
    descripcion = models.TextField(blank=True, verbose_name="Descripción")
    estok = models.ForeignKey(
        'inventario.Estok',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='ubicaciones',
        verbose_name="Estok"
    )
    # =====================================================================
    # POSICIÓN EN LA JERARQUÍA DEL MACRO-ESTOK (plano de planta)
    # =====================================================================
    piso = models.CharField(
        max_length=20,
        choices=[
            ('PRIMER_PISO', '1er piso'),
            ('PLANTA_BAJA', 'Planta baja'),
        ],
        default='PLANTA_BAJA',
        verbose_name="Piso de la casa",
        help_text="Piso del macro-Estok donde se diagrama esta ubicación."
    )
    parent_grid_row = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name="Fila en la grilla del piso",
        help_text="Coordenada relativa (fila, 1-based) del cuadrante de la grilla del piso donde reside esta ubicación."
    )
    parent_grid_col = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name="Columna en la grilla del piso",
        help_text="Coordenada relativa (columna, 1-based) del cuadrante de la grilla del piso donde reside esta ubicación."
    )
    grid_colspan = models.PositiveIntegerField(
        default=1,
        verbose_name="Ancho en celdas (colspan)",
        help_text="Ancho variable del cuadrante en celdas de la grilla estilo Word."
    )
    grid_rowspan = models.PositiveIntegerField(
        default=1,
        verbose_name="Alto en celdas (rowspan)",
        help_text="Alto variable del cuadrante en celdas de la grilla estilo Word."
    )
    # =====================================================================
    # SUB-GRILLA MATRICIAL DE LA DIVISIÓN (Mapa Estok - Nivel 1)
    # Cada división de primer nivel define una grilla interna configurable
    # (Filas Internas × Columnas por fila, asimétrica) donde se encastran
    # las habitaciones (Nivel 2) vía parent_ubicacion + parent_grid_row/col.
    # =====================================================================
    parent_ubicacion = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sububicaciones',
        verbose_name="División padre",
        help_text="División del Mapa Estok donde se encastra esta habitación (parent_id)."
    )
    grid_filas = models.PositiveIntegerField(
        default=3,
        verbose_name="Filas internas de la división",
        help_text="Cantidad de filas internas de la sub-grilla de la división."
    )
    grid_columnas = models.PositiveIntegerField(
        default=3,
        verbose_name="Columnas internas de la división",
        help_text="Cantidad de columnas por defecto de cada fila interna."
    )
    grid_filas_config = models.JSONField(
        null=True,
        blank=True,
        verbose_name="Columnas por fila interna (grilla asimétrica)",
        help_text="Arreglo opcional con las columnas de cada fila interna (ej: [3,2,2]). Si es null, todas usan grid_columnas."
    )
    largo = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True, verbose_name="Largo (cm)")
    ancho = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True, verbose_name="Ancho (cm)")
    alto = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True, verbose_name="Alto (cm)")
    foto = models.ImageField(upload_to='ubicaciones/', blank=True, null=True, verbose_name="Foto")
    posicion_puerta = models.CharField(
        max_length=10,
        blank=True,
        null=True,
        choices=[
            ('TOP', 'Superior'),
            ('BOTTOM', 'Inferior'),
            ('LEFT', 'Izquierda'),
            ('RIGHT', 'Derecha'),
        ],
        verbose_name="Posición de la puerta",
        help_text="Pared de la habitación donde se colocó la puerta arrastrable (valores: TOP, BOTTOM, LEFT, RIGHT)."
    )
    ui_width = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        default="100%",
        verbose_name="Ancho visual (UI)",
        help_text="Medida de ancho relativo de la tarjeta en el lienzo interactivo (ej: '100%' o '210px'). Se persiste en caliente vía PUT desde el resizing del Mapa Estok."
    )
    ui_height = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        default="auto",
        verbose_name="Alto visual (UI)",
        help_text="Medida de alto relativo de la tarjeta en el lienzo interactivo (ej: 'auto' o '160px'). Se persiste en caliente vía PUT desde el resizing del Mapa Estok."
    )
    ui_left = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        default="0%",
        verbose_name="Posición X visual (UI)",
        help_text="Coordenada horizontal elástica del rectángulo libre dentro del contenedor del departamento (Modo Planta Única), ej: '12%'. Se persiste en caliente vía PUT desde el arrastre libre."
    )
    ui_top = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        default="0%",
        verbose_name="Posición Y visual (UI)",
        help_text="Coordenada vertical elástica del rectángulo libre dentro del contenedor del departamento (Modo Planta Única), ej: '8%'. Se persiste en caliente vía PUT desde el arrastre libre."
    )
    fusion_grupo = models.UUIDField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Grupo de fusión (espacio en L)",
        help_text="ID relacional compartido por dos o más espacios fusionados (ej: pasillos en L). Los espacios con el mismo fusion_grupo se renderizan como UN único espacio receptor Drag & Drop de geometría irregular, sin fronteras internas."
    )
    # =====================================================================
    # «ESPACIO ÚNICO» (bloque monolítico declarado)
    # ---------------------------------------------------------------------
    # Si está tildado, la habitación/espacio se declara un BLOQUE MONOLÍTICO
    # SIN subdivisiones internas: queda lista para recibir objetos de forma
    # DIRECTA (no se le crean divisiones ni espacios internos). Lo consume la
    # configuración estructural (Onboarding / Almacenamiento) y el motor de
    # tránsito interno.
    # =====================================================================
    espacio_unico = models.BooleanField(
        default=False,
        verbose_name="Espacio único (monolítico)",
        help_text="Marca la habitación/espacio como un bloque monolítico sin subdivisiones internas: queda listo para recibir objetos de forma directa, sin quedar «En Tránsito»."
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Ubicación"
        verbose_name_plural = "Ubicaciones"
        ordering = ['nombre']

    def __str__(self):
        return self.nombre

