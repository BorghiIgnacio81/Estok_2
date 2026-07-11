"""
Serializers para la API REST del sistema de inventario.

Re-exporta todos los serializers desde sus módulos individuales.
Mantiene compatibilidad con imports existentes.
"""

from .usuarios import RoleSerializer, UserSerializer, UserCreateSerializer
from .organizacion import UbicacionSerializer, ContenedorSerializer
from .objetos import (
    ObjetoListSerializer, ObjetoDetailSerializer, ObjetoCreateSerializer,
)
from .estok import (
    MembresiaSerializer, EstokSerializer, EstokCreateSerializer,
    CodigoInvitacionSerializer, UnirseConCodigoSerializer,
    CambiarEstokActivoSerializer,
)
from .historial import HistorialPrecioSerializer, AlertaStockSerializer
from .multimedia import FotoObjetoSerializer, FotoObjetoUploadSerializer
from .chat import MensajeSerializer, MensajeCreateSerializer

__all__ = [
    'RoleSerializer', 'UserSerializer', 'UserCreateSerializer',
    'UbicacionSerializer', 'ContenedorSerializer',
    'ObjetoListSerializer', 'ObjetoDetailSerializer', 'ObjetoCreateSerializer',
    'MembresiaSerializer', 'EstokSerializer', 'EstokCreateSerializer',
    'CodigoInvitacionSerializer', 'UnirseConCodigoSerializer',
    'CambiarEstokActivoSerializer',
    'HistorialPrecioSerializer', 'AlertaStockSerializer',
    'FotoObjetoSerializer', 'FotoObjetoUploadSerializer',
    'MensajeSerializer', 'MensajeCreateSerializer',
]
