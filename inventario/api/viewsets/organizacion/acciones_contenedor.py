"""
Acciones especializadas del `ContenedorViewSet` (mixin).

Agrupa los `@action` de Contenedor: motor de fusión de espacios en «L»
(`fusionar` / `separar` / `grupo`), árbol jerárquico de inventario (`arbol`) y el
ciclo de vida del código QR (`qr_code` / `regenerar_qr` / `escanear`). Se
compone con `ContenedorViewSet` en `contenedores.py`.
"""

import logging

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

from ....models import Contenedor, Objeto
from ...serializers import ObjetoListSerializer
from ....services.qr_service import QRService
from ....services.arbol_inventario_service import construir_arbol_estok
from ..fusion_espacial import editar_grupo, fusionar_espacios, separar_espacios

logger = logging.getLogger(__name__)


class AccionesContenedorMixin:
    # =====================================================================
    # MOTOR DE FUSIÓN DE ESPACIOS EN "L" (muebles/estantes) - misma lógica
    # genérica que Ubicación: permite unificar dos o más Contenedores en un
    # único rectángulo elástico con geometría irregular (fusion_grupo).
    # =====================================================================

    @action(detail=True, methods=['post'], url_path='fusionar')
    def fusionar(self, request, pk=None):
        """POST /api/contenedores/{id}/fusionar/ con {ubicacion_ids: [uuid, ...]}."""
        base = self.get_object()
        return Response(
            fusionar_espacios(
                Contenedor, base, request.data.get('ubicacion_ids') or [],
                lambda c: c.ubicacion.estok_id if c.ubicacion_id else None,
            )
        )

    @action(detail=True, methods=['post'], url_path='separar')
    def separar(self, request, pk=None):
        """POST /api/contenedores/{id}/separar/ → libera el grupo de fusión."""
        base = self.get_object()
        return Response(separar_espacios(Contenedor, base))

    @action(detail=True, methods=['put', 'patch'], url_path='grupo')
    def grupo(self, request, pk=None):
        """PUT /api/contenedores/{id}/grupo/ → nombre/geometría de todas las partes."""
        base = self.get_object()
        return Response(
            editar_grupo(
                Contenedor, base,
                request.data.get('nombre'), request.data.get('partes'),
            )
        )

    @action(detail=False, methods=['get'])
    def arbol(self, request):
        """
        ÁRBOL JERÁRQUICO DE INVENTARIO (listado de objetos en cascada).

        GET /api/contenedores/arbol/
          ?categoria=<uuid> & decision=vender|conservar|tirar|sin_decision
          & publicado_ml=publicado|no_publicado & search=<texto>

        Retorna SOLO la taxonomía válida del inventario con filtros ORM
        estrictos por tipo: `cajas` (tipo='CAJA', SECCIÓN 1), `estructuras`
        (muebles tipo='MUEBLE_MOVIL' mudables, SECCIÓN 3) y los objetos
        sueltos/sin ubicación en `sueltos` (SECCIÓN 2). Los `tipo='CONJUNTO'`
        (estructura interna del mueble) y los `tipo='MUEBLE_INMUEBLE'` (fijos)
        quedan estrictamente EXCLUIDOS de toda consulta y renderizado.

        Consulta optimizada para PostgreSQL: 1 query de contenedores
        (select_related) + 1 query de objetos (select_related + prefetch de
        fotos). Cero N+1; los árboles y agrupaciones se resuelven en memoria.
        """
        estok_id = (
            request.headers.get('X-Estok-Id')
            or request.query_params.get('estok_id')
        )
        if not estok_id:
            return Response({
                'estructuras': [],
                'cajas': [],
                'sueltos': [],
                'filtros_activos': False,
                'resumen': {
                    'contenedores': 0,
                    'objetos_ubicados': 0,
                    'objetos_sueltos': 0,
                },
            })

        payload = construir_arbol_estok(
            estok_id,
            request=request,
            categoria=request.query_params.get('categoria') or None,
            decision=request.query_params.get('decision') or None,
            publicado_ml=request.query_params.get('publicado_ml') or None,
            search=(request.query_params.get('search') or '').strip() or None,
        )
        return Response(payload)

    @action(detail=True, methods=['get'])
    def qr_code(self, request, pk=None):
        """
        Obtiene la URL del codigo QR del contenedor.
        """
        contenedor = self.get_object()
        qr_service = QRService()
        qr_url = qr_service.obtener_qr_url(contenedor)
        return Response({
            "contenedor_id": str(contenedor.id),
            "contenedor_nombre": contenedor.nombre,
            "qr_code_url": qr_url,
            "objetos_count": contenedor.objetos.count(),
        })

    @action(detail=True, methods=['post'])
    def regenerar_qr(self, request, pk=None):
        """
        Regenera el codigo QR del contenedor.
        """
        contenedor = self.get_object()
        qr_service = QRService()
        qr_path = qr_service.regenerar_qr(str(contenedor.id), contenedor.nombre)
        if qr_path:
            contenedor.qr_code_image = qr_path
            contenedor.save(update_fields=['qr_code_image'])
            return Response({
                "mensaje": "QR regenerado correctamente",
                "qr_code_url": qr_service.obtener_qr_url(contenedor),
            })
        return Response(
            {"error": "Error al regenerar el QR"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

    @action(detail=False, methods=['get'])
    def escanear(self, request):
        """
        Endpoint para escanear un QR de contenedor.
        Recibe el ID del contenedor (desde el QR escaneado) y
        retorna los objetos dentro de ese contenedor.
        """
        qr_data = request.query_params.get('qr_data')
        contenedor_id = request.query_params.get('contenedor_id')

        if qr_data:
            contenedor_id = QRService.decode_qr_data(qr_data)

        if not contenedor_id:
            return Response(
                {"error": "Debes proporcionar 'qr_data' o 'contenedor_id'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            contenedor = get_object_or_404(Contenedor, id=contenedor_id)
            objetos = Objeto.objects.filter(
                contenedor=contenedor,
                deleted_at__isnull=True
            ).select_related('ubicacion')

            serializer = ObjetoListSerializer(objetos, many=True, context={'request': request})

            return Response({
                "contenedor": {
                    "id": str(contenedor.id),
                    "nombre": contenedor.nombre,
                    "ubicacion": contenedor.ubicacion.nombre,
                    "qr_code_url": QRService().obtener_qr_url(contenedor),
                },
                "objetos": serializer.data,
                "total_objetos": len(serializer.data),
            })

        except Exception as e:
            logger.error("Error al escanear QR: %s", e)
            return Response(
                {"error": f"Error al procesar el QR: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST
            )
