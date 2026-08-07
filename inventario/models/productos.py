"""
Productos: Objeto y subtipos multi-tabla, más HistorialPrecio.

Parte del paquete inventario/models/ (monolito modularizado).
"""
from .base import (
    models,
    uuid,
    timezone,
)

class Objeto(models.Model):
    """
    Modelo base para todos los objetos del inventario.
    Utiliza multi-table inheritance: cada modelo hijo crea una tabla
    con una relación 1:1 hacia esta tabla base.

    Incluye soft delete (deleted_at) para evitar pérdida de información.
    Pertenece a un Estok.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nombre = models.CharField(max_length=300, verbose_name="Nombre del objeto")
    descripcion = models.TextField(blank=True, verbose_name="Descripción")

    # Estok al que pertenece
    estok = models.ForeignKey(
        'inventario.Estok',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='objetos',
        verbose_name="Estok"
    )

    # Organización espacial
    ubicacion = models.ForeignKey(
        'inventario.Ubicacion',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='objetos',
        verbose_name="Ubicación"
    )
    contenedor = models.ForeignKey(
        'inventario.Contenedor',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='objetos',
        verbose_name="Contenedor"
    )

    # Categoría definida por el usuario (organización)
    categoria = models.ForeignKey(
        'inventario.Categoria',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='objetos',
        verbose_name="Categoría"
    )

    # Relación de contención entre objetos (objeto_padre = contenedor lógico)
    es_contenedor = models.BooleanField(
        default=False,
        verbose_name="Es contenedor",
        help_text="Si está marcado, este objeto puede contener otros objetos dentro"
    )
    objeto_padre = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='objetos_contenidos',
        verbose_name="Objeto contenedor padre",
        help_text="Si este objeto está dentro de otro objeto que actúa como contenedor"
    )

    # Estado y valoración
    estado_conservacion = models.CharField(
        max_length=50,
        choices=[
            ('excelente', 'Excelente'),
            ('bueno', 'Bueno'),
            ('regular', 'Regular'),
            ('malo', 'Malo'),
            ('muy_malo', 'Muy malo'),
        ],
        default='bueno',
        verbose_name="Estado de conservación"
    )
    valor_estimado = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Valor estimado (USD)"
    )
    color = models.CharField(max_length=100, blank=True, verbose_name="Color")

    # Trazabilidad y legado
    dueno_original = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='objetos_dueno',
        verbose_name="Dueño original"
    )
    beneficiario = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='objetos_beneficiario',
        verbose_name="Beneficiario"
    )

    # Estado de completitud (para IA con campos pendientes)
    ESTADO_CARGA_CHOICES = [
        ('completo', 'Completo'),
        ('incompleto', 'Incompleto - requiere datos del usuario'),
        ('pendiente_ia', 'Pendiente de análisis por IA'),
    ]
    estado_carga = models.CharField(
        max_length=20,
        choices=ESTADO_CARGA_CHOICES,
        default='pendiente_ia',
        verbose_name="Estado de carga",
        help_text="Indica si el objeto tiene todos los datos o falta información del usuario"
    )
    campos_pendientes = models.JSONField(
        blank=True,
        default=list,
        verbose_name="Campos pendientes",
        help_text="Lista de campos que la IA no pudo determinar y requiere input del usuario"
    )

    # Acción del dueño original (Vender / Recuperar / Tirar)
    OWNER_ACTION_CHOICES = [
        ('vender', 'Vender'),
        ('conservar', 'Conservar'),
        ('tirar', 'Tirar / Desechar'),
    ]
    owner_action = models.CharField(
        max_length=20,
        choices=OWNER_ACTION_CHOICES,
        null=True,
        blank=True,
        verbose_name="Acción del dueño original",
        help_text="Decisión del dueño original sobre qué hacer con el objeto: Vender, Conservar o Tirar"
    )

    # Publicación en marketplaces
    plataformas_publicadas = models.JSONField(
        blank=True,
        default=list,
        verbose_name="Plataformas publicadas",
        help_text="Lista de plataformas donde se ha publicado (ej: ['facebook', 'instagram', 'mercadolibre'])"
    )

    # Auditoría
    fecha_registro = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de registro")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Última actualización")

    # Soft Delete
    deleted_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Fecha de eliminación (soft delete)"
    )

    class Meta:
        verbose_name = "Objeto"
        verbose_name_plural = "Objetos"
        ordering = ['-fecha_registro']

    def __str__(self):
        return self.nombre

    def delete(self, using=None, keep_parents=False):
        """Soft delete: marca como eliminado en lugar de borrar."""
        self.deleted_at = timezone.now()
        self.save()

    def hard_delete(self, using=None, keep_parents=False):
        """Eliminación física real (uso con precaución)."""
        super().delete(using=using, keep_parents=keep_parents)
class LibroRevista(Objeto):
    """
    Objeto específico: Libro, Revista o Cómic.
    Incluye campos específicos para cómics (serie, tomo, número, editorial).
    """
    autor = models.CharField(max_length=300, blank=True, verbose_name="Autor")
    edicion = models.CharField(max_length=100, blank=True, verbose_name="Edición")
    anio = models.IntegerField(null=True, blank=True, verbose_name="Año de publicación")
    isbn_issn = models.CharField(
        max_length=30,
        blank=True,
        verbose_name="ISBN / ISSN",
        help_text="Código ISBN para libros o ISSN para revistas"
    )

    # Campos específicos para cómics / revistas
    nombre_serie = models.CharField(
        max_length=300,
        blank=True,
        verbose_name="Nombre de la serie",
        help_text="Ej: Garfield, Batman, Los Simpsons"
    )
    titulo_tomo = models.CharField(
        max_length=300,
        blank=True,
        verbose_name="Título del tomo",
        help_text="Ej: Se queda con la torta, El caballero oscuro"
    )
    numero_tomo = models.IntegerField(
        null=True,
        blank=True,
        verbose_name="Número del tomo",
        help_text="Ej: 2, 15, 100"
    )
    editorial = models.CharField(
        max_length=200,
        blank=True,
        verbose_name="Editorial",
        help_text="Ej: Planeta DeAgostini, DC Comics, Marvel"
    )
    idioma = models.CharField(
        max_length=100,
        blank=True,
        verbose_name="Idioma",
        help_text="Ej: Español, Inglés, Portugués"
    )

    class Meta:
        verbose_name = "Libro / Revista / Cómic"
        verbose_name_plural = "Libros / Revistas / Cómics"

    def __str__(self):
        if self.nombre_serie:
            tomo = f" #{self.numero_tomo}" if self.numero_tomo else ""
            return f"{self.nombre_serie}{tomo} - {self.titulo_tomo or self.nombre}"
        return f"{self.nombre} - {self.autor or 'Sin autor'}"
class Tecnologia(Objeto):
    """
    Objeto específico: Artículo de tecnología / electrónica.
    Incluye especificaciones flexibles en JSONB.
    """
    marca = models.CharField(max_length=200, blank=True, verbose_name="Marca")
    modelo = models.CharField(max_length=200, blank=True, verbose_name="Modelo")
    numero_serie = models.CharField(
        max_length=200,
        blank=True,
        verbose_name="Número de serie",
        help_text="Número de serie único del dispositivo"
    )
    peso = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Peso (kg)"
    )
    especificaciones = models.JSONField(
        blank=True,
        default=dict,
        verbose_name="Especificaciones técnicas (JSON)",
        help_text="Almacena especificaciones flexibles en formato JSON (RAM, almacenamiento, etc.)"
    )

    class Meta:
        verbose_name = "Tecnología"
        verbose_name_plural = "Tecnologías"

    def __str__(self):
        return f"{self.nombre} - {self.marca} {self.modelo}".strip()
class MuebleArte(Objeto):
    """
    Objeto específico: Mueble, obra de arte o antigüedad.
    """
    material = models.CharField(max_length=200, blank=True, verbose_name="Material")
    largo = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Largo (cm)"
    )
    ancho = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Ancho (cm)"
    )
    alto = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Alto (cm)"
    )
    artista_fabricante = models.CharField(
        max_length=300,
        blank=True,
        verbose_name="Artista / Fabricante"
    )

    class Meta:
        verbose_name = "Mueble / Arte"
        verbose_name_plural = "Muebles / Obras de Arte"

    def __str__(self):
        return f"{self.nombre} - {self.artista_fabricante or 'Sin artista'}"
class Ropa(Objeto):
    """
    Objeto específico: Prenda de vestir o accesorio.
    """
    tamano = models.CharField(
        max_length=50,
        blank=True,
        verbose_name="Tamaño / Talla",
        help_text="Ej: S, M, L, XL, 38, 42, etc."
    )

    class Meta:
        verbose_name = "Ropa / Accesorio"
        verbose_name_plural = "Ropa / Accesorios"

    def __str__(self):
        return f"{self.nombre} - Talla: {self.tamano or 'N/A'}"
class HistorialPrecio(models.Model):
    """
    Registra cada cambio en el valor_estimado de un objeto.
    Permite calcular plusvalía/depreciación para informes de seguros.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    objeto = models.ForeignKey(
        'inventario.Objeto',
        on_delete=models.CASCADE,
        related_name='historial_precios',
        verbose_name="Objeto"
    )
    valor_anterior = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Valor anterior (USD)"
    )
    valor_nuevo = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        verbose_name="Valor nuevo (USD)"
    )
    diferencia = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Diferencia (USD)"
    )
    porcentaje_cambio = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Porcentaje de cambio"
    )
    motivo = models.CharField(
        max_length=200,
        blank=True,
        verbose_name="Motivo del cambio",
        help_text="Ej: Revalorización, Depreciación, Actualización por IA, etc."
    )
    registrado_por = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Registrado por"
    )
    fecha_cambio = models.DateTimeField(auto_now_add=True, verbose_name="Fecha del cambio")

    class Meta:
        verbose_name = "Historial de precio"
        verbose_name_plural = "Historial de precios"
        ordering = ['-fecha_cambio']

    def save(self, *args, **kwargs):
        if self.valor_anterior is not None and self.valor_nuevo is not None:
            self.diferencia = self.valor_nuevo - self.valor_anterior
            if self.valor_anterior != 0:
                self.porcentaje_cambio = (
                    (self.valor_nuevo - self.valor_anterior) / self.valor_anterior
                ) * 100
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.objeto.nombre}: ${self.valor_anterior} → ${self.valor_nuevo}"
