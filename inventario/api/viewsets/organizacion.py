"""
ViewSets para organización espacial: Ubicaciones y Contenedores.
"""

import logging

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

from ...models import Ubicacion, Contenedor, Objeto
from ..serializers import UbicacionSerializer, ContenedorSerializer, ObjetoListSerializer
from ..services.qr_service import QRService
from .base import HasRolePermission

logger = logging.getLogger(__name__)


class UbicacionViewSet(viewsets.ModelViewSet):
    queryset = Ubicacion.objects.all()
    serializer_class = UbicacionSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]


class ContenedorViewSet(viewsets.ModelViewSet):
    queryset = Contenedor.objects.all()
    serializer_class = ContenedorSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_queryset(self):
        qs = super().get_queryset()
        ubicacion_id = self.request.query_params.get('ubicacion')
        if ubicacion_id:
            qs = qs.filter(ubicacion_id=ubicacion_id)
        return qs

    @action(detail=True, methods=['get'])
    def qr_code(self, request, pk=None):
        """
        Obtiene la URL del código QR del contenedor.
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
        Regenera el código QR del contenedor.
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
