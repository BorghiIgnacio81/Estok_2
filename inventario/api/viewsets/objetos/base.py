"""
ViewSet base de Objetos — CRUD estándar y filtros básicos.
"""

import logging

from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from django.db.models import Q

from ....models import Objeto
from ...serializers import (
    ObjetoListSerializer, ObjetoDetailSerializer, ObjetoCreateSerializer,
)
from ..base import HasRolePermission


logger = logging.getLogger(__name__)


class ObjetoViewSetBase(viewsets.ModelViewSet):
    """
    ViewSet base para objetos del inventario.
    Contiene únicamente el CRUD estándar y el filtrado por query params.
    """
    queryset = Objeto.objects.all()
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_serializer_class(self):
        if self.action == 'list':
            return ObjetoListSerializer
        elif self.action in ('update', 'partial_update'):
            return ObjetoCreateSerializer
        return ObjetoDetailSerializer

    def create(self, request, *args, **kwargs):
        """
        Crea un objeto usando ObjetoCreateSerializer para validar/crear,
        pero retorna la respuesta usando ObjetoDetailSerializer para
        que incluya correctamente el tipo y datos específicos.
        """
        create_serializer = ObjetoCreateSerializer(
            data=request.data, context={'request': request}
        )
        create_serializer.is_valid(raise_exception=True)
        objeto = create_serializer.save()

        objeto.refresh_from_db()

        detail_serializer = ObjetoDetailSerializer(
            objeto, context={'request': request}
        )
        headers = self.get_success_headers(detail_serializer.data)
        return Response(
            detail_serializer.data,
            status=status.HTTP_201_CREATED,
            headers=headers,
        )

    def get_queryset(self):
        qs = Objeto.objects.all()

        # Filtrar por estok
        estok_id = (
            self.request.headers.get('X-Estok-Id')
            or self.request.query_params.get('estok_id')
        )
        if estok_id:
            qs = qs.filter(estok_id=estok_id)

        tipo = self.request.query_params.get('tipo')
        if tipo:
            if tipo == 'libro':
                qs = qs.filter(librorevista__isnull=False)
            elif tipo == 'tecnologia':
                qs = qs.filter(tecnologia__isnull=False)
            elif tipo == 'mueble':
                qs = qs.filter(mueblearte__isnull=False)
            elif tipo == 'ropa':
                qs = qs.filter(ropa__isnull=False)

        ubicacion = self.request.query_params.get('ubicacion')
        if ubicacion:
            qs = qs.filter(ubicacion_id=ubicacion)

        contenedor = self.request.query_params.get('contenedor')
        if contenedor:
            qs = qs.filter(contenedor_id=contenedor)

        categoria = self.request.query_params.get('categoria')
        if categoria:
            qs = qs.filter(categoria_id=categoria)

        es_contenedor = self.request.query_params.get('es_contenedor')
        if es_contenedor is not None:
            if es_contenedor.lower() in ('true', '1', 'yes'):
                qs = qs.filter(es_contenedor=True)
            elif es_contenedor.lower() in ('false', '0', 'no'):
                qs = qs.filter(es_contenedor=False)

        objeto_padre = self.request.query_params.get('objeto_padre')
        if objeto_padre:
            qs = qs.filter(objeto_padre_id=objeto_padre)

        estado = self.request.query_params.get('estado')
        if estado:
            qs = qs.filter(estado_conservacion=estado)

        estado_carga = self.request.query_params.get('estado_carga')
        if estado_carga:
            qs = qs.filter(estado_carga=estado_carga)

        dueno = self.request.query_params.get('dueno_original')
        if dueno:
            qs = qs.filter(dueno_original_id=dueno)

        beneficiario = self.request.query_params.get('beneficiario')
        if beneficiario:
            qs = qs.filter(beneficiario_id=beneficiario)

        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(
                Q(nombre__icontains=search) |
                Q(descripcion__icontains=search)
            )

        incluir_eliminados = self.request.query_params.get('incluir_eliminados')
        if not incluir_eliminados:
            qs = qs.filter(deleted_at__isnull=True)

        return qs.select_related('ubicacion', 'contenedor').prefetch_related('fotos')

    # ------------------------------------------------------------------
    # Helpers compartidos
    # ------------------------------------------------------------------
    @staticmethod
    def _get_tipo(obj):
        """Retorna el tipo legible de un objeto según su subtipo."""
        if hasattr(obj, 'librorevista'):
            return 'libro'
        elif hasattr(obj, 'tecnologia'):
            return 'tecnologia'
        elif hasattr(obj, 'mueblearte'):
            return 'mueble'
        elif hasattr(obj, 'ropa'):
            return 'ropa'
        return 'objeto'
