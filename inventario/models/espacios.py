"""
Organización espacial: Ubicacion y Contenedor.

Parte del paquete inventario/models/ (monolito modularizado).
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
    largo = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True, verbose_name="Largo (cm)")
    ancho = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True, verbose_name="Ancho (cm)")
    alto = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True, verbose_name="Alto (cm)")
    foto = models.ImageField(upload_to='ubicaciones/', blank=True, null=True, verbose_name="Foto")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Ubicación"
        verbose_name_plural = "Ubicaciones"
        ordering = ['nombre']

    def __str__(self):
        return self.nombre
class Contenedor(models.Model):
    """
    Representa un contenedor físico dentro de una ubicación (ej: "Caja 4", "Estante A").
    Cada contenedor tiene un código QR único para escaneo rápido.
    No tiene FK directa a Estok (se accede vía ubicacion.estok).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nombre = models.CharField(max_length=200, verbose_name="Nombre")
    descripcion = models.TextField(blank=True, verbose_name="Descripción")
    ubicacion = models.ForeignKey(
        'inventario.Ubicacion',
        on_delete=models.CASCADE,
        related_name='contenedores',
        verbose_name="Ubicación"
    )
    parent_contenedor = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='subcontenedores',
        verbose_name="Contenedor padre",
        help_text="Si está definido, este contenedor es un sub-contenedor jerárquico de otro."
    )
    parent_grid_row = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name="Fila del casillero en el contenedor padre",
        help_text="Coordenada relativa (fila, 1-based) del casillero de la grilla del contenedor padre donde reside este elemento."
    )
    parent_grid_col = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name="Columna del casillero en el contenedor padre",
        help_text="Coordenada relativa (columna, 1-based) del casillero de la grilla del contenedor padre donde reside este elemento."
    )
    grid_filas = models.PositiveIntegerField(
        default=3,
        verbose_name="Filas de la grilla interna",
        help_text="Cantidad de filas de la grilla interna de casilleros del contenedor (ej: 2 en un armario empotrado)."
    )
    grid_columnas = models.PositiveIntegerField(
        default=3,
        verbose_name="Columnas de la grilla interna",
        help_text="Cantidad de columnas de la grilla interna de casilleros del contenedor (ej: 3 en un armario empotrado)."
    )
    largo = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True, verbose_name="Largo (cm)")
    ancho = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True, verbose_name="Ancho (cm)")
    alto = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True, verbose_name="Alto (cm)")
    foto = models.ImageField(upload_to='contenedores/', blank=True, null=True, verbose_name="Foto")
    material = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        choices=[
            ('madera', 'Madera'),
            ('metal', 'Metal'),
            ('plastico', 'Plastico'),
            ('vidrio', 'Vidrio'),
            ('tela', 'Tela'),
            ('otro', 'Otro'),
        ],
        verbose_name="Material"
    )
    tipo_madera = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        choices=[
            ('pino', 'Pino'),
            ('roble', 'Roble'),
            ('nogal', 'Nogal'),
            ('cerezo', 'Cerezo'),
            ('haya', 'Haya'),
            ('caoba', 'Caoba'),
            ('mdf', 'MDF'),
            ('aglomerado', 'Aglomerado'),
            ('terciado', 'Terciado (Multicapa)'),
            ('otro', 'Otro'),
        ],
        verbose_name="Tipo de Madera",
        help_text="Solo aplica si el material es 'Madera'"
    )
    qr_code_image = models.ImageField(
        upload_to='qrcodes/',
        blank=True,
        null=True,
        verbose_name="Código QR",
        help_text="Imagen del código QR generado para este contenedor"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Contenedor"
        verbose_name_plural = "Contenedores"
        ordering = ['ubicacion', 'nombre']

    def __str__(self):
        return f"{self.nombre} ({self.ubicacion.nombre})"

    def save(self, *args, **kwargs):
        """Al guardar, genera el QR automáticamente si no existe."""
        from inventario.services.qr_service import QRService
        super().save(*args, **kwargs)  # Guardar primero para tener ID
        if not self.qr_code_image:
            qr_service = QRService()
            qr_path = qr_service.generar_qr(str(self.id), self.nombre)
            if qr_path:
                self.qr_code_image = qr_path
                super().save(update_fields=['qr_code_image'])
