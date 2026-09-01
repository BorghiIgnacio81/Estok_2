"""
Configuración de rutas para la API REST del sistema de inventario.

Registra todos los ViewSets con sus respectivos routers.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .viewsets import (
    RoleViewSet,
    UserViewSet,
    UbicacionViewSet,
    ContenedorViewSet,
    ObjetoViewSet,
    FotoObjetoViewSet,
    HistorialPrecioViewSet,
    AlertaStockViewSet,
    EstokViewSet,
    CodigoInvitacionViewSet,
    CambiarEstokActivoView,
    MensajeViewSet,
    VersionViewSet,
    CategoriaViewSet,
    MercadoLibreViewSet,
    SuperAdminUserViewSet,
    SuperAdminEstokViewSet,
    AiModelsView,
)

from .viewsets.mudanza import MudanzaView




# =============================================================================
# ROUTER PRINCIPAL
# =============================================================================
router = DefaultRouter()

# Registro de ViewSets
router.register(r'roles', RoleViewSet, basename='role')
router.register(r'usuarios', UserViewSet, basename='user')
router.register(r'ubicaciones', UbicacionViewSet, basename='ubicacion')
router.register(r'contenedores', ContenedorViewSet, basename='contenedor')
router.register(r'objetos', ObjetoViewSet, basename='objeto')
router.register(r'fotos', FotoObjetoViewSet, basename='foto')
router.register(r'historial-precios', HistorialPrecioViewSet, basename='historialprecio')
router.register(r'alertas-stock', AlertaStockViewSet, basename='alertastock')
router.register(r'estoks', EstokViewSet, basename='estok')
router.register(r'codigos-invitacion', CodigoInvitacionViewSet, basename='codigo-invitacion')
router.register(r'cambiar-estok-activo', CambiarEstokActivoView, basename='cambiar-estok-activo')
router.register(r'mensajes', MensajeViewSet, basename='mensaje')
router.register(r'version', VersionViewSet, basename='version')
router.register(r'categorias', CategoriaViewSet, basename='categoria')
router.register(r'mercadolibre', MercadoLibreViewSet, basename='mercadolibre')

# =============================================================================
# MODO DIOS (Super Admin) - Vista global de auditoría, SOLO 'ygumy44'
# IsYgumyMaster devuelve HTTP 403 para cualquier otro usuario.
# =============================================================================
router.register(r'admin/usuarios', SuperAdminUserViewSet, basename='admin-usuario')
router.register(r'admin/estoks', SuperAdminEstokViewSet, basename='admin-estok')

# =============================================================================

# URL PATTERNS
# =============================================================================
urlpatterns = [
    path('', include(router.urls)),
    # Catálogo simulado de modelos de IA (evita 404 de /api/ai/models/
    # cuando el servicio local LM Studio no está activo)
    path('ai/models/', AiModelsView.as_view(), name='ai-models'),
    # Mudanza Inter-Estok (transferencia hermética de contenedores/objetos)
    path('inventario/mudanza/', MudanzaView.as_view(), name='mudanza'),
    path('api-auth/', include('rest_framework.urls')),
]



