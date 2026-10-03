"""
Paquete de ViewSets de usuarios y roles.

Compone el controlador base (registro público, "olvidó su contraseña", perfil
propio, presencia online y access log) con el mixin de gestión de MIEMBROS del
Estok activo (acciones multi-tenant), y re-exporta los nombres públicos
EXACTOS que consume el enrutamiento:

    from inventario.api.viewsets.usuarios import RoleViewSet, UserViewSet

`UserViewSet` conserva la ruta `/api/usuarios/` con TODAS sus acciones, de modo
que `inventario/api/viewsets/__init__.py` y `inventario/api/urls.py` NO cambian.
"""

from .viewset_base import RoleViewSet, UsuarioViewSetBase
from .viewset_tenant import UsuarioTenantMixin


class UserViewSet(UsuarioViewSetBase, UsuarioTenantMixin):
    """
    ViewSet unificado de usuarios.

    Compone el base (autenticación/perfil/presencia) con el mixin de membresía
    del tenant. DRF recolecta los `@action` heredados, por lo que el router
    sigue registrando `/api/usuarios/` con todas sus acciones.
    """


__all__ = ['RoleViewSet', 'UserViewSet']
