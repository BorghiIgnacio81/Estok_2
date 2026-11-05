from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import (
    Role, CustomUser, Estok, Membresia, CodigoInvitacion,
    Ubicacion, Contenedor,
    Objeto,
    FotoObjeto,
    FeatureFlag
)


# =============================================================================
# ADMIN: FEATURE FLAGS (CONTROL DE FUNCIONALIDADES)
# =============================================================================
@admin.register(FeatureFlag)
class FeatureFlagAdmin(admin.ModelAdmin):
    """
    Switch EN CALIENTE de las funciones Premium.

    `list_editable` permite encender/apagar `activo_global` y
    `modo_promocional` desde la propia lista (un click) y guardar con el botón
    «Guardar» del final de la tabla, sin abrir el detalle de cada fila.
    Los cambios se aplican en la siguiente petición de la API: no hace falta
    redeployar.
    """

    list_display = ['nombre', 'clave', 'activo_global', 'modo_promocional',
                    'estado_visible', 'updated_at']
    list_editable = ['activo_global', 'modo_promocional']
    list_filter = ['activo_global', 'modo_promocional']
    search_fields = ['nombre', 'clave', 'descripcion']
    ordering = ['nombre']
    readonly_fields = ['created_at', 'updated_at']
    actions = [
        'activar_funcionalidad',
        'desactivar_funcionalidad',
        'activar_promocion',
        'desactivar_promocion',
    ]

    @admin.display(description="Disponible para")
    def estado_visible(self, obj):
        """Resumen legible del estado del switch."""
        if not obj.activo_global:
            return "🚫 Apagada (nadie)"
        if obj.modo_promocional:
            return "🎁 Todos (promocional)"
        return "⭐ Sólo plan Pro"

    @admin.action(description="Encender el interruptor maestro (activo_global)")
    def activar_funcionalidad(self, request, queryset):
        actualizados = queryset.update(activo_global=True)
        self.message_user(
            request,
            f"{actualizados} funcionalidad(es) encendida(s) globalmente.",
        )

    @admin.action(description="Apagar el interruptor maestro (activo_global)")
    def desactivar_funcionalidad(self, request, queryset):
        actualizados = queryset.update(activo_global=False)
        self.message_user(
            request,
            f"{actualizados} funcionalidad(es) apagada(s) para todos los planes.",
        )

    @admin.action(description="Activar modo promocional (liberar para todos)")
    def activar_promocion(self, request, queryset):
        actualizados = queryset.update(modo_promocional=True)
        self.message_user(
            request,
            f"{actualizados} funcionalidad(es) liberada(s) para el plan gratuito.",
        )

    @admin.action(description="Desactivar modo promocional (sólo plan Pro)")
    def desactivar_promocion(self, request, queryset):
        actualizados = queryset.update(modo_promocional=False)
        self.message_user(
            request,
            f"{actualizados} funcionalidad(es) restringida(s) al plan Pro.",
        )



# =============================================================================
# ADMIN: ROLES
# =============================================================================
@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ['name', 'can_read', 'can_write', 'can_edit', 'can_delete',
                    'es_administrador_fisico']
    list_filter = ['can_read', 'can_write', 'can_edit', 'can_delete',
                   'es_administrador_fisico']
    search_fields = ['name', 'description']


# =============================================================================
# ADMIN: USUARIO PERSONALIZADO
# =============================================================================
@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    list_display = ['username', 'email', 'get_full_name', 'is_active',
                    'es_premium', 'plan_suscripcion', 'ocultar_publicidad']
    list_filter = ['is_active', 'is_staff', 'es_premium', 'plan_suscripcion']
    search_fields = ['username', 'email', 'first_name', 'last_name']

    fieldsets = UserAdmin.fieldsets + (
        ('Información adicional', {
            'fields': ('description', 'phone'),
        }),
        ('Plan y monetización', {
            'fields': ('es_premium', 'plan_suscripcion', 'limite_objetos',
                       'ocultar_publicidad'),
            'description': (
                'Plan Pro: sin publicidad y sin límite de objetos. Si el usuario '
                'es CREADOR de un Estok/Hogar, sus miembros heredan '
                'automáticamente «Ocultar publicidad».'
            ),
        }),
    )


# =============================================================================
# ADMIN: ORGANIZACIÓN ESPACIAL
# =============================================================================
@admin.register(Ubicacion)
class UbicacionAdmin(admin.ModelAdmin):
    list_display = ['nombre', 'descripcion']
    search_fields = ['nombre']


@admin.register(Contenedor)
class ContenedorAdmin(admin.ModelAdmin):
    list_display = ['nombre', 'ubicacion', 'qr_code_image']
    list_filter = ['ubicacion']
    search_fields = ['nombre']
    readonly_fields = ['qr_code_image']


# =============================================================================
# ADMIN: OBJETO BASE
# =============================================================================
class FotoObjetoInline(admin.TabularInline):
    model = FotoObjeto
    extra = 1
    fields = ['imagen', 'descripcion', 'es_principal']


@admin.register(Objeto)
class ObjetoAdmin(admin.ModelAdmin):
    list_display = ['nombre', 'ubicacion', 'contenedor', 'estado_conservacion',
                    'valor_estimado', 'deleted_at']
    list_filter = ['estado_conservacion', 'ubicacion', 'deleted_at']
    search_fields = ['nombre', 'descripcion']
    inlines = [FotoObjetoInline]

    def get_queryset(self, request):
        """Por defecto, mostrar solo objetos no eliminados."""
        qs = super().get_queryset(request)
        if request.GET.get('deleted'):
            return qs
        return qs.filter(deleted_at__isnull=True)


# =============================================================================
# ADMIN: FOTOS
# =============================================================================
@admin.register(FotoObjeto)

class FotoObjetoAdmin(admin.ModelAdmin):
    list_display = ['objeto', 'es_principal', 'fecha_subida']
    list_filter = ['es_principal']
    search_fields = ['objeto__nombre', 'descripcion']


# =============================================================================
# ADMIN: ESTOK / MEMBRESIA / CODIGO INVITACION
# =============================================================================
@admin.register(Estok)
class EstokAdmin(admin.ModelAdmin):
    list_display = ['nombre', 'creador', 'es_premium', 'plan_suscripcion',
                    'limite_objetos', 'ocultar_publicidad', 'created_at']
    list_filter = ['es_premium', 'plan_suscripcion']
    search_fields = ['nombre', 'creador__username']
    fieldsets = [
        ('Datos del hogar', {
            'fields': ('nombre', 'descripcion'),
        }),
        ('Layout del mapa espacial', {
            'fields': ('tipo_layout', 'cantidad_pisos', 'grid_filas',
                       'grid_columnas', 'grid_filas_config'),
        }),
        ('Plan y monetización', {
            'fields': ('creador', 'es_premium', 'plan_suscripcion',
                       'limite_objetos', 'ocultar_publicidad'),
            'description': (
                'Si el hogar o su CREADOR es premium, todos los miembros heredan '
                '«Ocultar publicidad» (ver services/suscripcion.py).'
            ),
        }),
    ]


@admin.register(Membresia)
class MembresiaAdmin(admin.ModelAdmin):
    list_display = ['usuario', 'estok', 'role', 'joined_at']
    list_filter = ['role', 'estok']
    search_fields = ['usuario__username', 'estok__nombre']


@admin.register(CodigoInvitacion)
class CodigoInvitacionAdmin(admin.ModelAdmin):
    list_display = ['codigo', 'estok', 'role', 'activo', 'usos_actuales', 'usos_maximos', 'fecha_expiracion']
    list_filter = ['activo', 'estok']
    search_fields = ['codigo', 'estok__nombre']
