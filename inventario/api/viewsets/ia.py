"""
Catálogo simulado de modelos de IA.

Registra de forma SEGURA el endpoint GET /api/ai/models/ para que cualquier
llamada (externa o de frontend) a la lista de modelos de IA reciba HTTP 200
en lugar de 404 cuando el servicio local (LM Studio) no está activo.

El análisis de imágenes REAL se sigue consumiendo vía
ObjetoViewSet.analizar_imagen (inventario/api/viewsets/objetos.py); este
módulo SOLO expone el catálogo de modelos simulado y no ejecuta inferencia.
"""

from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

# Modelo de visión actualmente en uso (ver RESUMEN_TECNICO_GENERAL.md).
MODELOS_IA_SIMULADOS = [
    {
        "id": "qwen2.5-vl-7b-instruct",
        "nombre": "Qwen 2.5 VL 7B Instruct",
        "tipo": "vision",
        "proveedor": "LM Studio (local)",
        "activo": True,
    },
]


class AiModelsView(APIView):
    """
    GET/POST /api/ai/models/ → catálogo simulado de modelos de IA.

    Acceso PÚBLICO (AllowAny): el catálogo es un dato no sensible (nombre de
    modelos) y así cualquier llamada recibe HTTP 200, eliminando de forma
    definitiva los errores 404/401 de /api/ai/models/ sin depender de que
    LM Studio esté levantado.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return self._catalogo()

    def post(self, request):
        return self._catalogo()

    def _catalogo(self):
        return Response({
            "models": MODELOS_IA_SIMULADOS,
            "proveedor": "LM Studio (local)",
            "servicio_local": True,
            "simulado": True,
        })
