"""
Paquete modular del ViewSet de organización espacial (Ubicaciones y Contenedores).

Fragmenta el antiguo monolito `organizacion.py` en submódulos limpios y
re-expone los nombres públicos EXACTOS que consume el enrutamiento:

    from inventario.api.viewsets.organizacion import UbicacionViewSet, ContenedorViewSet

De este modo `inventario/api/viewsets/__init__.py` y `inventario/api/urls.py`
NO cambian.
"""

from .ubicaciones import UbicacionViewSet
from .contenedores import ContenedorViewSet

__all__ = ['UbicacionViewSet', 'ContenedorViewSet']

