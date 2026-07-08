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
)



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

# =============================================================================
# URL PATTERNS
# =============================================================================
urlpatterns = [
    path('', include(router.urls)),
    path('api-auth/', include('rest_framework.urls')),
]



