"""
Usuarios, roles y membresías: Role, CustomUser, Membresia, CodigoInvitacion.

Parte del paquete inventario/models/ (monolito modularizado).
"""
from .base import (
    models,
    uuid,
    secrets,
    string,
    F,
    timezone,
    AbstractUser,
)

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
        'inventario.Estok',
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
    tiene_clave_temporal = models.BooleanField(
        default=False,
        verbose_name="Tiene clave temporal",
        help_text=(
            "True si el usuario está usando una contraseña temporal "
            "(flujo 'Olvidó su contraseña'). El frontend fuerza la "
            "redirección a /perfil hasta que defina una clave nueva."
        )
    )
    login_count = models.IntegerField(
        default=0,
        verbose_name="Inicios de sesión",
        help_text=(
            "Contador total de autenticaciones exitosas del usuario. "
            "Lo incrementa la señal user_logged_in (ver inventario/signals.py) "
            "en el login JWT y en el admin de Django. Control de adopción en lanzamiento."
        ),
    )

    class Meta:
        verbose_name = "Usuario"
        verbose_name_plural = "Usuarios"
        ordering = ['last_name', 'first_name']

    def __str__(self):
        return f"{self.get_full_name() or self.username}"
class Membresia(models.Model):
    """
    Relación muchos-a-muchos entre Usuario y Estok con rol específico.
    El rol se asigna mediante FK a Role (RBAC dinámico).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    usuario = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.CASCADE,
        related_name='membresias',
        verbose_name="Usuario"
    )
    estok = models.ForeignKey(
        'inventario.Estok',
        on_delete=models.CASCADE,
        related_name='miembros',
        verbose_name="Estok"
    )
    role = models.ForeignKey(
        'inventario.Role',
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
    login_count = models.IntegerField(
        default=0,
        verbose_name="Accesos a este Estok",
        help_text=(
            "Contador de veces que el usuario cargó o conmutó a este Estok "
            "(sincronización de inquilinato activo vía /api/cambiar-estok-activo/). "
            "Control analítico de accesos por Estok conectado."
        ),
    )

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
        'inventario.Estok',
        on_delete=models.CASCADE,
        related_name='codigos_invitacion',
        verbose_name="Estok"
    )
    role = models.ForeignKey(
        'inventario.Role',
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
        'inventario.CustomUser',
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
