"""
Paquete modular de ObjetoViewSet.

Combina el CRUD base con todos los mixins de acciones especializadas
para formar el ObjetoViewSet completo. Se re-exporta como 'ObjetoViewSet'
para mantener compatibilidad total con config/urls.py y viewsets/__init__.py.
"""

from .base import ObjetoViewSetBase
from .ia_actions import IAActionsMixin
from .stock_actions import StockActionsMixin
from .marketing_actions import MarketingActionsMixin
from .utils_actions import UtilsActionsMixin


class ObjetoViewSet(
    IAActionsMixin,
    StockActionsMixin,
    MarketingActionsMixin,
    UtilsActionsMixin,
    ObjetoViewSetBase,
):
    """
    ViewSet completo de Objetos.
    Hereda del CRUD base y de todos los mixins de acciones especializadas.
    El orden de herencia es importante: los mixins van primero para que
    sus @action decorators se registren antes que los métodos del base.
    """
    pass


__all__ = ['ObjetoViewSet']
