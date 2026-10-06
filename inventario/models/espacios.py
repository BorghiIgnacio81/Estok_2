"""
Contenedor físico del Estok (Caja / Espacio / Mueble, con sub-divisiones).

Parte del paquete inventario/models/ (monolito modularizado). La ubicación
física (planta/habitación) vive en `ubicaciones.py` desde la fragmentación
(límite de mantenibilidad: < 400 líneas por archivo).
"""
from .base import (
    models,
    uuid,
)

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
    # TAXONOMÍA ESTRICTA DEL LISTADO DE INVENTARIO (5 tipos físicos)
    # El listado de la pestaña de Objetos filtra por este campo con el ORM:
    #   SECCIÓN 1 (Cajas e Inventario Interno) → tipo='CAJA' EXCLUSIVAMENTE.
    #   SECCIÓN 3 (Muebles y Estructuras Móviles) → tipo='MUEBLE_MOVIL' y
    #     es_inmueble=False.
    #   CONJUNTO (estructura interna del mueble) y MUEBLE_INMUEBLE (mueble fijo)
    #     están ANCLADOS a su cuarto: excluidos de todo listado y de la mudanza.
    # El valor se infiere automáticamente al crear desde cualquier modal,
    # botonera o servicio (ver inventario/services/taxonomia_contenedor.py).
    # =====================================================================
    tipo = models.CharField(
        max_length=16,
        choices=[
            ('CONJUNTO', 'Conjunto / estructura interna'),
            ('MUEBLE_INMUEBLE', 'Mueble inmueble (fijo al cuarto)'),
            ('MUEBLE_MOVIL', 'Mueble móvil (mudable)'),
            ('CAJA', 'Caja móvil de inventario'),
            ('OBJETO', 'Objeto suelto (ítem fino)'),
        ],
        default='CAJA',
        db_index=True,
        verbose_name="Tipo de contenedor",
        help_text="Taxonomía de 5 tipos físicos: CONJUNTO (estructura interna del mueble), MUEBLE_INMUEBLE (fijo al cuarto, fuerza es_inmueble=True), MUEBLE_MOVIL (mudable), CAJA (contenedor móvil) u OBJETO (ítem fino suelto)."
    )
    # =====================================================================
    # «EN TRÁNSITO INTERNO» (evento onDrop dentro de un mueble anfitrión)
    # El elemento ya reside físicamente dentro del mueble con sub-divisiones
    # internas, pero todavía NO fue ubicado de forma fina en un estante
    # definitivo. Se limpia en cuanto se asigna un estante/casillero concreto.
    # =====================================================================
    en_transito_interno = models.BooleanField(
        default=False,
        verbose_name="En tránsito interno",
        help_text="Activo cuando el elemento fue soltado dentro de un mueble con sub-divisiones internas SIN indicar un estante/casillero concreto. Se limpia al ubicarlo de forma fina."
    )
    espacio_lleno = models.BooleanField(
        default=False,
        verbose_name="Espacio físicamente lleno",
        help_text="Marca manual del casillero/estante del mueble (multi-elemento): si está activo, el espacio se pinta con opacidad sutil y deja de aceptar elementos por arrastre (dragover/ondrop bloqueados) hasta desmarcarlo. Se persiste vía PUT hermético al Estok activo."
    )
    # =====================================================================
    # «ESPACIO ÚNICO» (bloque monolítico declarado)
    # ---------------------------------------------------------------------
    # Marca el contenedor (Caja / Espacio / Mueble) como un BLOQUE MONOLÍTICO
    # sin subdivisiones internas: queda listo para recibir objetos de forma
    # DIRECTA, por lo que el motor NUNCA deja sus ítems en el estado de alerta
    # «En Tránsito Interno». Regla de negocio: las CAJAS nacen con este flag
    # activado por defecto (se puede destildar para dividirlas).
    # =====================================================================
    espacio_unico = models.BooleanField(
        default=False,
        verbose_name="Espacio único (monolítico)",
        help_text="Marca el contenedor (Caja/Espacio/Mueble) como un bloque monolítico sin subdivisiones internas: queda listo para recibir objetos de forma directa, sin quedar «En Tránsito Interno». Las Cajas nacen con este flag activado por defecto; destildalo para dividirlas."
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
          - En CREACIÓN infiere el `tipo` taxonómico legítimo (CONJUNTO /
            MUEBLE_INMUEBLE / MUEBLE_MOVIL / CAJA / OBJETO) desde los servicios,
            salvo que el cliente lo haya enviado explícitamente (bandera
            `_tipo_explicito` que fija el serializer).
          - Fuerza `es_inmueble=True` cuando el tipo es MUEBLE_INMUEBLE (regla
            de física: un mueble inmueble siempre es fijo).
          - Al crear una sub-división interna, promueve al mueble anfitrión a
            MUEBLE_MOVIL (una caja que aloja conjuntos deja de ser caja).
          - Genera el QR automáticamente si no existe.
        """
        from inventario.services.qr_service import QRService
        from inventario.services.taxonomia_contenedor import (
            TIPO_CAJA,
            TIPO_MUEBLE_INMUEBLE,
            TIPO_MUEBLE_MOVIL,
            TIPO_OBJETO,
            inferir_tipo_contenedor,
        )

        es_nuevo = self._state.adding
        if es_nuevo:
            self.tipo = inferir_tipo_contenedor(
                self, tipo_explicito=getattr(self, '_tipo_explicito', False),
            )

        # Regla de física: el tipo MUEBLE_INMUEBLE fuerza el flag de inmovilidad.
        if self.tipo == TIPO_MUEBLE_INMUEBLE:
            self.es_inmueble = True

        super().save(*args, **kwargs)  # Guardar primero para tener ID
        if not self.qr_code_image:
            qr_service = QRService()
            qr_path = qr_service.generar_qr(str(self.id), self.nombre)
            if qr_path:
                self.qr_code_image = qr_path
                super().save(update_fields=['qr_code_image'])

        # Promoción del anfitrión: al recibir una sub-división interna, un
        # contenedor RAÍZ que era CAJA (u OBJETO) pasa a ser MUEBLE_MOVIL
        # (un mueble raíz mudable con sub-divisiones sigue siendo mudable).
        if es_nuevo and self.parent_contenedor_id:
            Contenedor.objects.filter(
                pk=self.parent_contenedor_id,
                parent_contenedor__isnull=True,
                tipo__in=(TIPO_CAJA, TIPO_OBJETO),
            ).update(tipo=TIPO_MUEBLE_MOVIL)
