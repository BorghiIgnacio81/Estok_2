"""
ViewSet para obtener la versión actual del deploy.
Devuelve el commit hash y timestamp del deploy.
"""

import json
import os

from rest_framework import viewsets, permissions
from rest_framework.response import Response


# version.py está en inventario/api/viewsets/version.py
# Necesitamos subir 4 niveles para llegar a la raíz del proyecto (/app)
VERSION_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), 'version.json')


class VersionViewSet(viewsets.ViewSet):
    """
    GET /api/version/ → devuelve { commit, deploy_timestamp, version }
    No requiere autenticación.
    """
    permission_classes = [permissions.AllowAny]

    def list(self, request):
        version_data = {
            "commit": "unknown",
            "deploy_timestamp": None,
            "version": "0.0.0",
        }
        if os.path.exists(VERSION_FILE):
            try:
                with open(VERSION_FILE, 'r') as f:
                    version_data.update(json.load(f))
            except (json.JSONDecodeError, IOError):
                pass
        return Response(version_data)
