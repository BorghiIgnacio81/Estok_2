"""
ViewSets para organizacion espacial: Ubicaciones y Contenedores.
"""

import logging

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

from ...models import Ubicacion, Contenedor, Objeto, Membresia
from ..serializers import UbicacionSerializer, ContenedorSerializer, ObjetoListSerializer
from ...services.qr_service import QRService
from .base import HasRolePermission

logger = logging.getLogger(__name__)


class UbicacionViewSet(viewsets.ModelViewSet):
    queryset = Ubicacion.objects.all()
    serializer_class = UbicacionSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_permissions(self):
        if self.action == 'create':
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset()
        estok_id = self.request.headers.get('X-Estok-Id') or self.request.query_params.get('estok_id')
        if estok_id:
            qs = qs.filter(estok_id=estok_id)
        return qs

    def perform_create(self, serializer):
        """
        Asigna automaticamente el estok_id al crear una ubicacion.
        El estok_id se obtiene del header X-Estok-Id, query param, o body.
        Valida que el usuario tenga membresia en el Estok destino.
        """
        estok_id = (
            self.request.headers.get('X-Estok-Id')
            or self.request.query_params.get('estok_id')
            or self.request.data.get('estok_id')
        )
        if estok_id:
            # Validar membresia (seguridad sin depender de HasRolePermission)
            if not self.request.user.is_superuser:
                if not Membresia.objects.filter(
                    usuario=self.request.user,
                    estok_id=estok_id
                ).exists():
                    from rest_framework.exceptions import PermissionDenied
                    raise PermissionDenied("No tienes membresia en este Estok.")
            serializer.save(estok_id=estok_id)
        else:
            serializer.save()


class ContenedorViewSet(viewsets.ModelViewSet):
    queryset = Contenedor.objects.all()
    serializer_class = ContenedorSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_permissions(self):
        if self.action == 'create':
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset()
        ubicacion_id = self.request.query_params.get('ubicacion')
        if ubicacion_id:
            qs = qs.filter(ubicacion_id=ubicacion_id)
        # Filtrar por estok via ubicacion.estok
        estok_id = self.request.headers.get('X-Estok-Id') or self.request.query_params.get('estok_id')
        if estok_id:
            qs = qs.filter(ubicacion__estok_id=estok_id)
        return qs

    def perform_create(self, serializer):
        """
        Asigna automaticamente la ubicacion y valida membresia al Estok.
        El estok_id se resuelve desde la ubicacion enviada en el body.
        """
        ubicacion_id = (
            self.request.data.get('ubicacion')
            or self.request.query_params.get('ubicacion')
        )
        if ubicacion_id:
            try:
                ubicacion = Ubicacion.objects.select_related('estok').get(id=ubicacion_id)
            except Ubicacion.DoesNotExist:
                from rest_framework.exceptions import ValidationError
                raise ValidationError("La ubicacion especificada no existe.")

            # Validar membresia (seguridad sin depender de HasRolePermission)
            if not self.request.user.is_superuser:
                if not Membresia.objects.filter(
                    usuario=self.request.user,
                    estok_id=ubicacion.estok_id
                ).exists():
                    from rest_framework.exceptions import PermissionDenied
                    raise PermissionDenied("No tienes membresia en el Estok de esta ubicacion.")

            serializer.save(ubicacion_id=ubicacion_id)
        else:
            serializer.save()

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