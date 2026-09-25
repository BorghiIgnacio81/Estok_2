"""
Catálogo simulado de modelos de IA.

Registra de forma SEGURA el endpoint GET /api/ai/models/ para que cualquier
llamada (externa o de frontend) a la lista de modelos de IA reciba HTTP 200
en lugar de 404.

El análisis de imágenes REAL se sigue consumiendo vía
ObjetoViewSet.analizar_imagen (inventario/api/viewsets/objetos/ia_actions.py);
este módulo SOLO expone el catálogo de modelos simulado y no ejecuta inferencia.
No existe integración de IA local.
"""

from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

# Modelo de visión actualmente en uso (motor en la NUBE: Google Gemini).
MODELOS_IA_SIMULADOS = [
    {
        "id": "gemini-2.5-flash-lite",
        "nombre": "Gemini 2.5 Flash-Lite",
        "tipo": "vision",
        "proveedor": "Google Gemini (nube)",
        "activo": True,
    },
]


class AiModelsView(APIView):
    """
    GET/POST /api/ai/models/ → catálogo simulado de modelos de IA.

    Acceso PÚBLICO (AllowAny): el catálogo es un dato no sensible (nombre de
    modelos) y así cualquier llamada recibe HTTP 200, eliminando de forma
    definitiva los errores 404/401 de /api/ai/models/.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return self._catalogo()

    def post(self, request):
        return self._catalogo()

    def _catalogo(self):
        return Response({
            "models": MODELOS_IA_SIMULADOS,
            "proveedor": "Google Gemini (nube)",
            "servicio_local": False,
            "simulado": True,
        })

