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
    grid_filas_config = models.JSONField(
        null=True,
        blank=True,
        verbose_name="Columnas por fila (grilla asimétrica)",
        help_text="Arreglo opcional con la cantidad de casilleros de cada fila (ej: [3,2,2]). Si es null, todas las filas usan grid_columnas. Permite layouts asimétricos (Fila 1 de 3 celdas, Fila 2 de 2 celdas)."
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
    es_inmueble = models.BooleanField(
        default=False,
        verbose_name="Mueble inmueble",
        help_text="Si está activo, el mueble queda FIJO e inmóvil (mueble inmueble fijo): no puede arrastrarse ni eliminarse desde la pantalla de almacenamiento."
    )
    # =====================================================================
    # TAXONOMÍA ESTRICTA DEL LISTADO DE INVENTARIO
    # El listado de la pestaña de Objetos filtra por este campo con el ORM:
    #   SECCIÓN 1 (Cajas e Inventario Interno) → tipo='CAJA' EXCLUSIVAMENTE.
    #   SECCIÓN 3 (Muebles y Estructuras Móviles) → tipo='MUEBLE' y
    #     es_inmueble=False.
    #   tipo='ESTANTE' (sub-divisiones internas) → EXCLUIDO de todo listado.
    # El valor se infiere automáticamente al crear desde cualquier modal,
    # botonera o servicio (ver inventario/services/taxonomia_contenedor.py).
    # =====================================================================
    tipo = models.CharField(
        max_length=10,
        choices=[
            ('MUEBLE', 'Mueble Grande'),
            ('CAJA', 'Caja Móvil Menor'),
            ('ESTANTE', 'Estante/Cajón Interno'),
        ],
        default='CAJA',
        db_index=True,
        verbose_name="Tipo de contenedor",
        help_text="Taxonomía estricta del inventario: MUEBLE (armario/cucheta/ropero), CAJA (contenedor pequeño móvil de objetos) o ESTANTE (sub-división interna de un mueble, excluida de los listados)."
    )
    espacio_lleno = models.BooleanField(
        default=False,
        verbose_name="Espacio físicamente lleno",
        help_text="Marca manual del casillero/estante del mueble (multi-elemento): si está activo, el espacio se pinta con opacidad sutil y deja de aceptar elementos por arrastre (dragover/ondrop bloqueados) hasta desmarcarlo. Se persiste vía PUT hermético al Estok activo."
    )
    # =====================================================================
    # GEOMETRÍA ELÁSTICA 2D (arquitectura unificada recursiva)
    # Los muebles (Nivel 2: habitación) y sus estantes/cajones internos
    # (Nivel 3/4: interior del mueble) se reposicionan como rectángulos libres
    # en el lienzo interactivo: mismos campos que Ubicacion (ui_left/ui_top +
    # fusion_grupo) para reutilizar el motor 2D y permitir fusiones en "L".
    # =====================================================================
    ui_left = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        default="0%",
        verbose_name="Posición X visual (UI)",
        help_text="Coordenada horizontal elástica del rectángulo libre dentro del lienzo del visor (Nivel 2 habitación / Nivel 3-4 interior del mueble), ej: '12%'. Se persiste en caliente vía PUT desde el arrastre libre."
    )
    ui_top = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        default="0%",
        verbose_name="Posición Y visual (UI)",
        help_text="Coordenada vertical elástica del rectángulo libre dentro del lienzo del visor (Nivel 2 habitación / Nivel 3-4 interior del mueble), ej: '8%'. Se persiste en caliente vía PUT desde el arrastre libre."
    )
    fusion_grupo = models.UUIDField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Grupo de fusión (espacio en L)",
        help_text="ID relacional compartido por dos o más muebles/estantes fusionados (geometría en L). Los espacios con el mismo fusion_grupo se renderizan como UN único rectángulo elástico receptor, sin fronteras internas."
    )
    ui_width = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        default="100%",
        verbose_name="Ancho visual (UI)",
        help_text="Medida de ancho relativo de la tarjeta en el lienzo interactivo (ej: '100%' o '210px'). Se persiste en caliente vía PUT desde el resizing recursivo (Visor de Habitación / Contenedor Grande)."
    )
    ui_height = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        default="auto",
        verbose_name="Alto visual (UI)",
        help_text="Medida de alto relativo de la tarjeta en el lienzo interactivo (ej: 'auto' o '160px'). Se persiste en caliente vía PUT desde el resizing recursivo (Visor de Habitación / Contenedor Grande)."
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
        """
        Al guardar:
          - En CREACIÓN infiere el `tipo` taxonómico legítimo (MUEBLE/CAJA/
            ESTANTE) desde los servicios, salvo que el cliente lo haya enviado
            explícitamente (bandera `_tipo_explicito` que fija el serializer).
          - Al crear una sub-división interna, promueve al mueble anfitrión a
            MUEBLE (un contenedor con hijos nunca es una caja).
          - Genera el QR automáticamente si no existe.
        """
        from inventario.services.qr_service import QRService
        from inventario.services.taxonomia_contenedor import (
            TIPO_MUEBLE,
            inferir_tipo_contenedor,
        )

        es_nuevo = self._state.adding
        if es_nuevo:
            self.tipo = inferir_tipo_contenedor(
                self, tipo_explicito=getattr(self, '_tipo_explicito', False),
            )

        super().save(*args, **kwargs)  # Guardar primero para tener ID
        if not self.qr_code_image:
            qr_service = QRService()
            qr_path = qr_service.generar_qr(str(self.id), self.nombre)
            if qr_path:
                self.qr_code_image = qr_path
                super().save(update_fields=['qr_code_image'])

        # Promoción del anfitrión: al recibir una sub-división interna, un
        # contenedor RAÍZ deja de ser caja y pasa a ser MUEBLE GRANDE.
        if es_nuevo and self.parent_contenedor_id:
            Contenedor.objects.filter(
                pk=self.parent_contenedor_id,
                parent_contenedor__isnull=True,
            ).exclude(tipo=TIPO_MUEBLE).update(tipo=TIPO_MUEBLE)
