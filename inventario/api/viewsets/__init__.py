"""
Módulo de ViewSets modularizados.
Re-exporta todos los ViewSets para mantener compatibilidad con urls.py.
"""

from .base import HasRolePermission, EsAdminDelEstok
from .usuarios import RoleViewSet, UserViewSet
from .organizacion import UbicacionViewSet, ContenedorViewSet
from .objetos import ObjetoViewSet
from .multimedia import FotoObjetoViewSet
from .historial import HistorialPrecioViewSet, AlertaStockViewSet
from .estok import EstokViewSet, CodigoInvitacionViewSet, CambiarEstokActivoView

__all__ = [
    'HasRolePermission',
    'EsAdminDelEstok',
    'RoleViewSet',
    'UserViewSet',
    'UbicacionViewSet',
    'ContenedorViewSet',
    'ObjetoViewSet',
    'FotoObjetoViewSet',
    'HistorialPrecioViewSet',
    'AlertaStockViewSet',
    'EstokViewSet',
    'CodigoInvitacionViewSet',
    'CambiarEstokActivoView',
]



