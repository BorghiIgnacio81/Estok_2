"""
Mixins de acciones de stock y valoración para ObjetoViewSet.
Contiene: actualizar_precio, historial_precios, plusvalia, crear_alerta_stock.
"""

import logging
from decimal import Decimal

from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status

from ....services.stock_service import StockValuationService
from ....models import AlertaStock


logger = logging.getLogger(__name__)


class StockActionsMixin:
    """
    Mixin que agrega endpoints de stock y valoración al ViewSet.
    Depende de que la clase combinada herede de ObjetoViewSetBase.
    """

    # =========================================================================
    # ACCIONES DE STOCK Y VALORACIÓN
    # =========================================================================
    @action(detail=True, methods=['post'])
    def actualizar_precio(self, request, pk=None):
        """Actualiza el valor_estimado y registra en el historial."""
        objeto = self.get_object()
        valor_nuevo = request.data.get('valor_nuevo')
        motivo = request.data.get('motivo', '')

        if not valor_nuevo:
            return Response(
                {"error": "Debes especificar 'valor_nuevo'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            valor_nuevo = Decimal(str(valor_nuevo))
        except (ValueError, TypeError):
            return Response(
                {"error": "valor_nuevo debe ser un número válido"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        service = StockValuationService()
        resultado = service.registrar_cambio_precio(
            objeto, valor_nuevo, motivo=motivo, registrado_por=request.user,
        )

        return Response(resultado.to_dict())

    @action(detail=True, methods=['get'])
    def historial_precios(self, request, pk=None):
        """Obtiene el historial de precios del objeto."""
        objeto = self.get_object()
        service = StockValuationService()
        return Response(service.obtener_historial_precios(objeto))

    @action(detail=True, methods=['get'])
    def plusvalia(self, request, pk=None):
        """Calcula la plusvalía/depreciación total del objeto."""
        objeto = self.get_object()
        service = StockValuationService()
        return Response(service.calcular_plusvalia_total(objeto))

    @action(detail=True, methods=['post'])
    def crear_alerta_stock(self, request, pk=None):
        """Crea una alerta de stock para el objeto."""
        objeto = self.get_object()
        nivel_minimo = request.data.get('nivel_minimo', 1)
        cantidad_actual = request.data.get('cantidad_actual', 1)

        service = StockValuationService()
        resultado = service.crear_alerta_stock(
            objeto,
            nivel_minimo=int(nivel_minimo),
            cantidad_actual=int(cantidad_actual),
            creada_por=request.user,
        )

        return Response({
            "mensaje": "Alerta de stock creada/actualizada",
            "alerta": {
                "objeto": resultado.objeto_nombre,
                "cantidad_actual": resultado.cantidad_actual,
                "nivel_minimo": resultado.nivel_minimo,
                "necesita_reposicion": resultado.necesita_reposicion,
            },
        })

    # =========================================================================
    # CONSULTAS DE ALERTAS DE STOCK
    # =========================================================================
    @action(detail=False, methods=['get'])
    def alertas_stock(self, request):
        """
        Lista todas las alertas de stock activas del Estok actual.
        GET /api/objetos/alertas_stock/
        """
        estok_id = (
            request.headers.get('X-Estok-Id')
            or request.query_params.get('estok_id')
        )

        alertas_qs = AlertaStock.objects.filter(
            activa=True
        ).select_related('objeto')

        if estok_id:
            alertas_qs = alertas_qs.filter(objeto__estok_id=estok_id)

        return Response([
            {
                "id": str(a.id),
                "objeto_id": str(a.objeto.id),
                "objeto_nombre": a.objeto.nombre,
                "cantidad_actual": a.cantidad_actual,
                "nivel_minimo": a.nivel_minimo,
                "necesita_reposicion": a.necesita_reposicion,
                "ultima_verificacion": a.ultima_verificacion.isoformat(),
            }
            for a in alertas_qs
        ])

    @action(detail=False, methods=['get'])
    def a_reponer(self, request):
        """
        Lista objetos que necesitan reposición (stock por debajo del mínimo).
        GET /api/objetos/a_reponer/
        """
        estok_id = (
            request.headers.get('X-Estok-Id')
            or request.query_params.get('estok_id')
        )

        service = StockValuationService()
        resultados = service.obtener_objetos_a_reponer()

        if estok_id:
            resultados = [
                r for r in resultados
                if r.get('objeto_estok_id') == estok_id
            ]

        return Response({
            "total": len(resultados),
            "objetos": resultados,
        })

    @action(detail=True, methods=['post'])
    def desactivar_alerta(self, request, pk=None):
        """
        Desactiva la alerta de stock para un objeto.
        POST /api/objetos/{id}/desactivar_alerta/
        """
        objeto = self.get_object()
        service = StockValuationService()
        desactivado = service.desactivar_alerta(objeto)

        if desactivado:
            return Response({
                "mensaje": "Alerta de stock desactivada correctamente",
            })
        return Response(
            {"error": "El objeto no tiene una alerta de stock activa"},
            status=status.HTTP_404_NOT_FOUND,
        )
