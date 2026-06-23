from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import (
    Role, CustomUser, Ubicacion, Contenedor,
    Objeto, LibroRevista, Tecnologia, MuebleArte, Ropa,
    FotoObjeto
)


# =============================================================================
# ADMIN: ROLES
# =============================================================================
@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ['name', 'can_read', 'can_write', 'can_edit', 'can_delete']
    list_filter = ['can_read', 'can_write', 'can_edit', 'can_delete']
    search_fields = ['name', 'description']


# =============================================================================
# ADMIN: USUARIO PERSONALIZADO
# =============================================================================
@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    list_display = ['username', 'email', 'role', 'get_full_name', 'is_active']
    list_filter = ['role', 'is_active', 'is_staff']
    search_fields = ['username', 'email', 'first_name', 'last_name']

    fieldsets = UserAdmin.fieldsets + (
        ('Información adicional', {
            'fields': ('role', 'description', 'phone'),
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
# ADMIN: MODELOS HIJOS
# =============================================================================
@admin.register(LibroRevista)
class LibroRevistaAdmin(admin.ModelAdmin):
    list_display = ['nombre', 'autor', 'edicion', 'anio', 'isbn_issn']
    search_fields = ['nombre', 'autor', 'isbn_issn']


@admin.register(Tecnologia)
class TecnologiaAdmin(admin.ModelAdmin):
    list_display = ['nombre', 'marca', 'modelo', 'numero_serie', 'peso']
    search_fields = ['nombre', 'marca', 'modelo', 'numero_serie']


@admin.register(MuebleArte)
class MuebleArteAdmin(admin.ModelAdmin):
    list_display = ['nombre', 'material', 'artista_fabricante', 'largo', 'ancho', 'alto']
    search_fields = ['nombre', 'artista_fabricante', 'material']


@admin.register(Ropa)
class RopaAdmin(admin.ModelAdmin):
    list_display = ['nombre', 'tamano']
    search_fields = ['nombre', 'tamano']


# =============================================================================
# ADMIN: FOTOS
# =============================================================================
@admin.register(FotoObjeto)
class FotoObjetoAdmin(admin.ModelAdmin):
    list_display = ['objeto', 'es_principal', 'fecha_subida']
    list_filter = ['es_principal']
    search_fields = ['objeto__nombre', 'descripcion']
