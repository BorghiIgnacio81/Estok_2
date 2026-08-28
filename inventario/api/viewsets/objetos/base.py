"""
ViewSet base de Objetos — CRUD estándar y filtros básicos.
"""

import logging
import os

from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from django.db.models import Q

from ....models import Objeto, FotoObjeto
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

        Soporta multipart/form-data con MÚLTIPLES imágenes: los archivos
        enviados bajo la clave 'fotos' (o 'imagenes', o la única 'foto'/
        'imagen') se persisten en la tabla relacional FotoObjeto de forma
        hermética para el Estok activo (el objeto se crea con el estok del
        header X-Estok-Id y las fotos quedan vinculadas a ese objeto).
        """
        create_serializer = ObjetoCreateSerializer(
            data=request.data, context={'request': request}
        )
        create_serializer.is_valid(raise_exception=True)
        objeto = create_serializer.save()

        self._guardar_fotos_multiple(objeto, request)

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

    def _guardar_fotos_multiple(self, objeto, request):
        """
        Persiste múltiples archivos de imagen del multipart en FotoObjeto.

        Claves aceptadas (por prioridad):
          - 'fotos'      → lista de archivos (flujo multi-foto del frontend)
          - 'imagenes'   → alias de 'fotos'
          - 'foto'/'imagen' → archivo único (compatibilidad con flujo previo)

        Hermeticidad multi-tenant: el objeto fue creado con el estok_id del
        header X-Estok-Id, por lo que las fotos quedan privadas del Estok
        activo vía la FK objeto. Si el header no coincide con el estok del
        objeto, se descarta el guardado por seguridad.
        """
        archivos = (
            request.FILES.getlist('fotos')
            or request.FILES.getlist('imagenes')
        )
        if not archivos:
            for clave in ('foto', 'imagen'):
                archivo = request.FILES.get(clave)
                if archivo:
                    archivos = [archivo]
                    break
        if not archivos:
            return

        estok_id = request.headers.get('X-Estok-Id')
        if estok_id and objeto.estok_id and str(objeto.estok_id) != str(estok_id):
            logger.error(
                'SEGURIDAD: intento de asociar fotos a un objeto de otro '
                'Estok. objeto=%s estok_objeto=%s header=%s',
                objeto.id, objeto.estok_id, estok_id,
            )
            return

        allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        max_size = 10 * 1024 * 1024  # 10 MB, igual que FotoObjetoUploadSerializer
        creadas = 0
        for idx, archivo in enumerate(archivos):
            content_type = getattr(archivo, 'content_type', None)
            if content_type and content_type not in allowed_types:
                logger.warning(
                    'Foto ignorada (tipo no soportado): %s', content_type
                )
                continue
            if not archivo.size or archivo.size > max_size:
                logger.warning(
                    'Foto ignorada (tamaño inválido): %s bytes', archivo.size
                )
                continue
            foto = FotoObjeto.objects.create(
                objeto=objeto,
                imagen=archivo,
                descripcion='Foto principal' if idx == 0 else 'Foto de carga',
                es_principal=(idx == 0),
            )
            creadas += 1
            try:
                if foto.imagen and foto.imagen.path and not os.path.exists(foto.imagen.path):
                    logger.error(
                        'INTEGRIDAD FALLIDA: la foto se guardó en BD pero no '
                        'en disco: %s',
                        foto.imagen.path,
                    )
            except Exception as e:  # noqa: BLE001
                logger.warning('No se pudo verificar integridad del archivo: %s', e)

        logger.info(
            'Objeto %s creado con %s foto(s) de %s archivo(s) recibidos',
            objeto.id, creadas, len(archivos),
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

        # Nota: el parámetro 'tipo' (herencia multi-tabla) ya no existe.
        # La clasificación se hace exclusivamente por 'categoria'.

        ubicacion = self.request.query_params.get('ubicacion')

        if ubicacion:
            qs = qs.filter(ubicacion_id=ubicacion)

        contenedor = self.request.query_params.get('contenedor')
        if contenedor:
            qs = qs.filter(contenedor_id=contenedor)

        categoria = self.request.query_params.get('categoria')
        if categoria:
            qs = qs.filter(categoria_id=categoria)

        decision = self.request.query_params.get('decision')
        if decision:
            decision = decision.strip().lower()
            if decision == 'sin_decision':
                qs = qs.filter(owner_action__isnull=True)
            elif decision in dict(Objeto.OWNER_ACTION_CHOICES):
                qs = qs.filter(owner_action=decision)

        publicado_ml = self.request.query_params.get('publicado_ml')
        if publicado_ml:
            publicado_ml = publicado_ml.strip().lower()
            if publicado_ml in ('true', '1', 'si', 'publicado'):
                qs = qs.filter(self._q_publicado_ml())
            elif publicado_ml in ('false', '0', 'no', 'no_publicado'):
                qs = qs.exclude(self._q_publicado_ml())

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
        """
        Retorna el tipo legible de un objeto según su categoría oficial.

        Ya NO se usa herencia multi-tabla: el "tipo" es un derivado de
        `categoria` (una de las 11 categorías oficiales de Mercado Libre).
        Se conserva por compatibilidad con las respuestas del frontend.
        """
        categoria_nombre = obj.categoria.nombre if obj.categoria else ''
        mapping = {
            'Muebles': 'mueble',
            'Arte': 'mueble',
            'Coleccionables': 'objeto',
            'Antigüedades': 'objeto',
            'Jardín': 'objeto',
            'Computación': 'tecnologia',
            'Electrónica': 'tecnologia',
            'Cocina': 'objeto',
            'Hogar': 'objeto',
            'Herramientas': 'objeto',
            'Materiales': 'objeto',
        }
        return mapping.get(categoria_nombre, 'objeto')

    @staticmethod
    def _q_publicado_ml():
        """
        Q de objetos publicados en Mercado Libre (robusto en todos los esquemas).

        Un objeto está publicado en ML si 'mercadolibre' figura en
        `plataformas_publicadas` (campo presente en TODOS los esquemas) o si el
        campo `meli_id` (presente SOLO en producción) tiene un valor no nulo y
        no vacío. La detección dinámica del campo evita FieldError en el
        esquema local, que no tiene `meli_id`.
        """
        q = Q(plataformas_publicadas__contains=['mercadolibre'])
        try:
            Objeto._meta.get_field('meli_id')
        except Exception:
            pass
        else:
            q = q | (Q(meli_id__isnull=False) & ~Q(meli_id__regex=r'^\s*$'))
        return q


