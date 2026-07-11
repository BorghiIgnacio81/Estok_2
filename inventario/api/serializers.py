"""
Shim de compatibilidad — serializers.py ahora es un paquete en serializers/

Todos los serializers se importan desde inventario.api.serializers (el paquete).
Este archivo existe solo para mantener compatibilidad con imports existentes.
"""

from .serializers import *  # noqa: F401, F403
