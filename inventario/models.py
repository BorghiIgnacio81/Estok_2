import uuid
import secrets
import string
from django.db import models
from django.db.models import F
from django.contrib.auth.models import AbstractUser
from django.utils import timezone


# =============================================================================
# MODELO DE ROLES (RBAC Dinámico)
# =============================================================================
class Role(models.Model):
    """
    Representa un rol dentro del sistema RBAC dinámico.
    Cada rol tiene permisos booleanos que definen las capacidades del usuario.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True, verbose_name="Nombre del rol")
    description = models.TextField(blank=True, verbose_name="Descripción")

    # Permisos booleanos (checkboxes)
    can_read = models.BooleanField(default=False, verbose_name="Puede leer")
    can_write = models.BooleanField(default=False, verbose_name="Puede escribir")
    can_edit = models.BooleanField(default=False, verbose_name="Puede editar")
    can_delete = models.BooleanField(default=False, verbose_name="Puede eliminar")

    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de creación")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Última actualización")

    class Meta:
        verbose_name = "Rol"
        verbose_name_plural = "Roles"
        ordering = ['name']

    def __str__(self):
        return self.name


# =============================================================================
# MODELO DE USUARIO PERSONALIZADO
# =============================================================================
class CustomUser(AbstractUser):
    """
    Usuario personalizado que hereda de AbstractUser.
    El campo 'role' global se elimina; ahora los roles se asignan
    por Membresia (por Estok). Se agrega ultimo_estok_activo.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    description = models.TextField(
        blank=True,
        verbose_name="Descripción",
        help_text="Rol o parentesco dentro del sistema (ej: 'Hijo', 'Socio', 'Encargado de galpón')"
    )
    phone = models.CharField(max_length=20, blank=True, verbose_name="Teléfono")
    alias_por_estok = models.JSONField(
        default=dict, blank=True,
        verbose_name="Alias por Estok",
        help_text="Dict con {estok_id: 'alias'} para mostrar nombres diferentes según el Estok"
    )
    ultimo_estok_activo = models.ForeignKey(
        'Estok',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='usuarios_activos',
        verbose_name="Último Estok activo"
    )
    ultima_actividad = models.DateTimeField(
        null=True, blank=True,
        verbose_name="Última actividad",
        help_text="Timestamp del último ping/heartbeat del usuario"
    )

    class Meta:
        verbose_name = "Usuario"
        verbose_name_plural = "Usuarios"
        ordering = ['last_name', 'first_name']

    def __str__(self):
        return f"{self.get_full_name() or self.username}"


# =============================================================================
# MODELO ESTOK (Cuenta/Organización multi-usuario)
# =============================================================================
class Estok(models.Model):
    """
    Representa una cuenta de Estok: un inventario compartido entre usuarios.
    Cada usuario puede pertenecer a múltiples Estoks.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nombre = models.CharField(max_length=200, default='Mi Inventario', verbose_name="Nombre del Estok")
    descripcion = models.TextField(blank=True, verbose_name="Descripción")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de creación")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Última actualización")

    class Meta:
        verbose_name = "Estok"
        verbose_name_plural = "Estoks"
        ordering = ['nombre']

    def __str__(self):
        return self.nombre


class Membresia(models.Model):
    """
    Relación muchos-a-muchos entre Usuario y Estok con rol específico.
    El rol se asigna mediante FK a Role (RBAC dinámico).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    usuario = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name='membresias',
        verbose_name="Usuario"
    )
    estok = models.ForeignKey(
        Estok,
        on_delete=models.CASCADE,
        related_name='miembros',
        verbose_name="Estok"
    )
    role = models.ForeignKey(
        Role,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='membresias',
        verbose_name="Rol en el Estok"
    )
    privacidad = models.CharField(
        max_length=20,
        choices=[('compartido', 'Compartido'), ('privado', 'Privado')],
        default='compartido',
        verbose_name="Privacidad de la membresía",
        help_text="'compartido' = visible para el usuario, 'privado' = oculto (uso interno)"
    )
    joined_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de unión")

    class Meta:
        verbose_name = "Membresía"
        verbose_name_plural = "Membresías"
        unique_together = [('usuario', 'estok')]

    def __str__(self):
        return f"{self.usuario.username} → {self.estok.nombre} ({self.role.name if self.role else 'Sin rol'})"


class CodigoInvitacion(models.Model):
    """
    Código compartible para unirse a un Estok.
    Al usarlo, se crea una Membresia con el rol asociado al código.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    estok = models.ForeignKey(
        Estok,
        on_delete=models.CASCADE,
        related_name='codigos_invitacion',
        verbose_name="Estok"
    )
    role = models.ForeignKey(
        Role,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='codigos_invitacion',
        verbose_name="Rol a asignar"
    )
    codigo = models.CharField(
        max_length=20,
        unique=True,
        verbose_name="Código de invitación",
        help_text="Formato: EST-XXXXXXXX"
    )
    creado_por = models.ForeignKey(
        CustomUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='codigos_creados',
        verbose_name="Creado por"
    )
    activo = models.BooleanField(default=True, verbose_name="Activo")
    usos_maximos = models.PositiveIntegerField(default=0, verbose_name="Usos máximos (0 = sin límite)")
    usos_actuales = models.PositiveIntegerField(default=0, verbose_name="Usos actuales")
    fecha_expiracion = models.DateTimeField(null=True, blank=True, verbose_name="Fecha de expiración")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de creación")

    class Meta:
        verbose_name = "Código de invitación"
        verbose_name_plural = "Códigos de invitación"
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.codigo} → {self.estok.nombre}"

    @property
    def es_valido(self):
        """Verifica si el código sigue siendo usable."""
        if not self.activo:
            return False
        if self.fecha_expiracion and timezone.now() > self.fecha_expiracion:
            return False
        if self.usos_maximos > 0 and self.usos_actuales >= self.usos_maximos:
            return False
        return True

    def usar(self):
        """
        Incrementa usos_actuales de forma atómica.
        Retorna True si se pudo usar, False si ya no es válido.
        """
        if not self.es_valido:
            return False
        CodigoInvitacion.objects.filter(pk=self.pk).update(usos_actuales=F('usos_actuales') + 1)
        self.refresh_from_db()
        return True

    @staticmethod
    def generar_codigo():
        """Genera un código único formato EST-XXXXXXXX."""
        random_part = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
        return f"EST-{random_part}"

    def save(self, *args, **kwargs):
        if not self.codigo:
            self.codigo = self.generar_codigo()
        super().save(*args, **kwargs)


# =============================================================================
# ORGANIZACIÓN ESPACIAL
# =============================================================================
class Ubicacion(models.Model):
    """
    Representa una ubicación física general (ej: "Garaje", "Sótano", "Oficina").
    Pertenece a un Estok.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nombre = models.CharField(max_length=200, verbose_name="Nombre")
    descripcion = models.TextField(blank=True, verbose_name="Descripción")
    estok = models.ForeignKey(
        Estok,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='ubicaciones',
        verbose_name="Estok"
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
        Ubicacion,
        on_delete=models.CASCADE,
        related_name='contenedores',
        verbose_name="Ubicación"
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
        from .services.qr_service import QRService
        super().save(*args, **kwargs)  # Guardar primero para tener ID
        if not self.qr_code_image:
            qr_service = QRService()
            qr_path = qr_service.generar_qr(str(self.id), self.nombre)
            if qr_path:
                self.qr_code_image = qr_path
                super().save(update_fields=['qr_code_image'])


# =============================================================================
# MODELO BASE OBJETO (Multi-table Inheritance)
# =============================================================================
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
        Estok,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='objetos',
        verbose_name="Estok"
    )

    # Organización espacial
    ubicacion = models.ForeignKey(
        Ubicacion,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='objetos',
        verbose_name="Ubicación"
    )
    contenedor = models.ForeignKey(
        Contenedor,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='objetos',
        verbose_name="Contenedor"
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
        CustomUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='objetos_dueno',
        verbose_name="Dueño original"
    )
    beneficiario = models.ForeignKey(
        CustomUser,
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
        ('recuperar', 'Recuperar'),
        ('tirar', 'Tirar / Desechar'),
    ]
    owner_action = models.CharField(
        max_length=20,
        choices=OWNER_ACTION_CHOICES,
        null=True,
        blank=True,
        verbose_name="Acción del dueño original",
        help_text="Decisión del dueño original sobre qué hacer con el objeto: Vender, Recuperar o Tirar"
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


# =============================================================================
# MODELOS HIJOS (Herencia Multi-tabla)
# =============================================================================
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


# =============================================================================
# MULTIMEDIA - FOTOS DE OBJETOS
# =============================================================================
class FotoObjeto(models.Model):
    """
    Almacena múltiples imágenes por objeto.
    Esencial para informes de valoración para seguros.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    objeto = models.ForeignKey(
        Objeto,
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


# =============================================================================
# HISTORIAL DE PRECIOS (Plusvalía / Depreciación)
# =============================================================================
class HistorialPrecio(models.Model):
    """
    Registra cada cambio en el valor_estimado de un objeto.
    Permite calcular plusvalía/depreciación para informes de seguros.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    objeto = models.ForeignKey(
        Objeto,
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
        CustomUser,
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


# =============================================================================
# ALERTAS DE STOCK / REPOSICIÓN

# =============================================================================
class AlertaStock(models.Model):
    """
    Define niveles mínimos de reposición para objetos.
    Basado en conceptos de gestión de inventario (Smartsheet).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    objeto = models.OneToOneField(
        Objeto,
        on_delete=models.CASCADE,
        related_name='alerta_stock',
        verbose_name="Objeto"
    )
    nivel_minimo = models.PositiveIntegerField(
        default=1,
        verbose_name="Nivel mínimo",
        help_text="Cantidad mínima antes de generar alerta"
    )
    cantidad_actual = models.PositiveIntegerField(
        default=1,
        verbose_name="Cantidad actual"
    )
    activa = models.BooleanField(default=True, verbose_name="Alerta activa")
    ultima_verificacion = models.DateTimeField(
        auto_now=True,
        verbose_name="Última verificación"
    )
    creada_por = models.ForeignKey(
        CustomUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Creada por"
    )

    class Meta:
        verbose_name = "Alerta de stock"
        verbose_name_plural = "Alertas de stock"

    @property
    def necesita_reposicion(self):
        return self.activa and self.cantidad_actual <= self.nivel_minimo

    def __str__(self):
        estado = "⚠️ Reponer" if self.necesita_reposicion else "✅ OK"
        return f"{self.objeto.nombre}: {self.cantidad_actual}/{self.nivel_minimo} {estado}"


# =============================================================================
# CHAT INTERNO - Mensajes entre miembros de un Estok
# =============================================================================
class Mensaje(models.Model):
    """
    Mensaje de chat interno entre miembros de un Estok.
    Cada mensaje pertenece a un Estok y tiene un remitente.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    estok = models.ForeignKey(
        Estok,
        on_delete=models.CASCADE,
        related_name='mensajes',
        verbose_name="Estok"
    )
    remitente = models.ForeignKey(
        CustomUser,
        on_delete=models.SET_NULL,
        null=True,
        related_name='mensajes_enviados',
        verbose_name="Remitente"
    )
    contenido = models.TextField(verbose_name="Contenido del mensaje")
    leido = models.BooleanField(default=False, verbose_name="Leído")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de envío")

    class Meta:
        verbose_name = "Mensaje"
        verbose_name_plural = "Mensajes"
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.remitente.username if self.remitente else '?'}: {self.contenido[:50]}"
