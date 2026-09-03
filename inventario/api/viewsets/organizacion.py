"""
ViewSets para organizacion espacial: Ubicaciones y Contenedores.
"""

import logging
from uuid import UUID

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from django.db import transaction
from django.shortcuts import get_object_or_404

from ...models import Ubicacion, Contenedor, Objeto, Membresia
from ..serializers import UbicacionSerializer, ContenedorSerializer, ObjetoListSerializer
from ...services.qr_service import QRService
from .base import HasRolePermission

logger = logging.getLogger(__name__)


class EstokPaginacion(PageNumberPagination):
    """
    Paginación que respeta ?page_size=N (máx 1000).
    Sin el parámetro, conserva el PAGE_SIZE global (25).
    """
    page_size_query_param = 'page_size'
    max_page_size = 1000


def _validar_membresia(user, estok_id):
    """Valida que el usuario tenga membresía activa en el Estok destino."""
    if user.is_superuser:
        return
    if not Membresia.objects.filter(usuario=user, estok_id=estok_id).exists():
        raise PermissionDenied("No tienes membresia en el Estok destino.")


class UbicacionViewSet(viewsets.ModelViewSet):
    queryset = Ubicacion.objects.all()
    serializer_class = UbicacionSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]
    pagination_class = EstokPaginacion

    def get_permissions(self):
        if self.action == 'create':
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        """
        Listado estricto multi-tenant para la columna derecha (minimapas de
        las plantas / Visor de Habitación): filtra SIEMPRE por el UUID único
        del Estok activo (X-Estok-Id / estok_id).

        - Sin tenant explícito NO se lista nada (qs.none()): evita exponer
          registros huérfanos (estok nulo) o filas de otros Estoks que se
          renderizarían como tarjetas fantasma duplicadas en el frontend.
        - .distinct(): red de seguridad relacional para no repetir filas
          lógicas residuales al paginar el listado.
        """
        qs = super().get_queryset().select_related('estok')
        estok_id = self.request.headers.get('X-Estok-Id') or self.request.query_params.get('estok_id')
        if estok_id:
            qs = qs.filter(estok_id=estok_id)
        else:
            qs = qs.none()
        return qs.distinct()

    def update(self, request, *args, **kwargs):
        """
        PUT con soporte de actualización parcial: permite que el Drag & Drop
        del Mapa Espacial envíe únicamente las coordenadas de cuadrante
        (parent_grid_row / parent_grid_col), el piso, el nombre o la escala
        sin requerir el resto de los campos obligatorios del modelo
        (antes esto producía HTTP 400 "nombre: Este campo es obligatorio").
        """
        partial = True
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        if getattr(instance, '_prefetched_objects_cache', None):
            instance._prefetched_objects_cache = {}
        return Response(serializer.data)

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
            _validar_membresia(self.request.user, estok_id)
            serializer.save(estok_id=estok_id)
        else:
            serializer.save()

    def destroy(self, request, *args, **kwargs):
        """
        Borrado FÍSICO en caliente con protección hermética de huérfanos
        (regla de negocio de Almacenamiento):

          1. Antes de borrar la fila se liberan TODOS los objetos vinculados a
             la estructura (directos o en cascada dentro de sus contenedores):
             contenedor=None y parent_grid_row/col=None. Así los objetos
             sobreviven al DELETE y caen directo a la bandeja inferior de
             «por ubicar» (el inventario jamás se pierde).
          2. Las sub-ubicaciones (habitaciones encastradas de una división /
             planta) se eliminan físicamente junto con la raíz: los
             Contenedores se borran en cascada por FK (ubicacion) y los
             Objetos ya fueron resguardados en el paso 1.
        """
        instance = self.get_object()

        # 1) Sub-árbol completo de Ubicaciones que cuelgan del nodo borrado.
        ids_ubicaciones = [str(instance.id)] + [
            str(hijo) for hijo in self._ids_ubicaciones_descendientes(instance.id)
        ]

        # 2) Contenedores (de cualquier nivel) alojados en esa estructura.
        ids_contenedores = list(
            Contenedor.objects.filter(ubicacion_id__in=ids_ubicaciones)
            .values_list('id', flat=True)
        )

        if ids_contenedores:
            # Objetos guardados dentro de esos contenedores → liberar el vínculo
            # y las coordenadas de casillero (viajan a la bandeja disponibles).
            Objeto.objects.filter(contenedor_id__in=ids_contenedores).update(
                contenedor=None,
                parent_grid_row=None,
                parent_grid_col=None,
            )

        # Objetos sueltos en celdas de la estructura (sin contenedor) → se
        # limpian las coordenadas de cuadrante para que no queden huérfanos
        # con un posicionamiento fantasma dentro de una grilla inexistente.
        Objeto.objects.filter(
            ubicacion_id__in=ids_ubicaciones,
            contenedor__isnull=True,
        ).update(
            parent_grid_row=None,
            parent_grid_col=None,
        )

        # 3) Eliminación física de la fila + toda su descendencia de Ubicaciones.
        Ubicacion.objects.filter(id__in=ids_ubicaciones).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @staticmethod
    def _ids_ubicaciones_descendientes(ubicacion_id):
        """UUIDs de TODAS las sub-ubicaciones (BFS por parent_ubicacion)."""
        encontrados = []
        cola = [ubicacion_id]
        while cola:
            padre = cola.pop()
            hijos = list(
                Ubicacion.objects.filter(parent_ubicacion_id=padre)
                .values_list('id', flat=True)
            )
            for hijo in hijos:
                encontrados.append(hijo)
                cola.append(hijo)
        return encontrados


class ContenedorViewSet(viewsets.ModelViewSet):
    queryset = Contenedor.objects.all()
    serializer_class = ContenedorSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]
    pagination_class = EstokPaginacion

    def get_permissions(self):
        if self.action == 'create':
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset().select_related('ubicacion', 'parent_contenedor')
        ubicacion_id = self.request.query_params.get('ubicacion')
        if ubicacion_id:
            qs = qs.filter(ubicacion_id=ubicacion_id)
        # Sub-contenedores directos de un padre puntual
        padre_id = self.request.query_params.get('padre')
        if padre_id:
            qs = qs.filter(parent_contenedor_id=padre_id)
        # Solo contenedores raíz (sin padre jerárquico)
        raiz = self.request.query_params.get('raiz')
        if raiz and raiz.lower() in ('true', '1', 'yes'):
            qs = qs.filter(parent_contenedor__isnull=True)
        # Filtrar por estok via ubicacion.estok
        estok_id = self.request.headers.get('X-Estok-Id') or self.request.query_params.get('estok_id')
        if estok_id:
            qs = qs.filter(ubicacion__estok_id=estok_id)
        return qs

    def update(self, request, *args, **kwargs):
        """
        PUT con soporte de actualización parcial: permite que el Drag & Drop
        envíe únicamente las relaciones (ubicacion / parent_contenedor).
        """
        partial = True
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        if getattr(instance, '_prefetched_objects_cache', None):
            instance._prefetched_objects_cache = {}
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        """
        Borrado FÍSICO en caliente con protección de huérfanos:

          - Los Objetos alojados DIRECTAMENTE en este contenedor se liberan:
            contenedor=None y parent_grid_row/col=None → viajan a la bandeja
            inferior de «por ubicar» (hermético: el inventario jamás se pierde).
          - Los sub-contenedores DIRECTOS se desacoplan del padre eliminado:
            parent_contenedor, parent_grid_row y parent_grid_col quedan en None
            (pasan a nivel raíz, disponibles y sin coordenadas fantasma).
          - Un mueble inmueble fijo (es_inmueble=True) no puede eliminarse.
        """
        instance = self.get_object()

        # Aislamiento multi-tenant explícito (misma regla que perform_update):
        # la operación debe pertenecer al Estok activo del header X-Estok-Id.
        estok_id = (
            self.request.headers.get('X-Estok-Id')
            or self.request.query_params.get('estok_id')
        )
        if not estok_id:
            raise ValidationError(
                "Falta el header X-Estok-Id. La operación pertenece a un Estok activo."
            )
        try:
            estok_id_uuid = UUID(str(estok_id))
        except (TypeError, ValueError):
            raise ValidationError("El Estok activo especificado no es un UUID válido.")
        if instance.ubicacion_id is None or instance.ubicacion.estok_id != estok_id_uuid:
            raise PermissionDenied("El contenedor no pertenece al Estok activo.")

        if instance.es_inmueble:
            raise PermissionDenied(
                "El mueble es inmueble fijo (es_inmueble) y no puede eliminarse."
            )

        # 1) Objetos guardados directamente en este contenedor → liberar.
        Objeto.objects.filter(contenedor_id=instance.id).update(
            contenedor=None,
            parent_grid_row=None,
            parent_grid_col=None,
        )

        # 2) Sub-contenedores directos → a nivel raíz, sin coordenadas huérfanas
        #    (su contenido interno queda intacto y disponible en el Estok).
        Contenedor.objects.filter(parent_contenedor_id=instance.id).update(
            parent_contenedor=None,
            parent_grid_row=None,
            parent_grid_col=None,
        )

        # 3) Eliminación física de la fila en PostgreSQL.
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @transaction.atomic
    def perform_create(self, serializer):
        """
        Asigna automaticamente la ubicacion y valida membresia al Estok.
        Si el body incluye parent_contenedor, la ubicacion se resuelve desde el padre.
        """
        parent_id = self.request.data.get('parent_contenedor')
        if parent_id:
            try:
                parent = Contenedor.objects.select_related('ubicacion').get(id=parent_id)
            except (Contenedor.DoesNotExist, ValueError, ValidationError):
                raise ValidationError("El contenedor padre especificado no existe.")
            _validar_membresia(self.request.user, parent.ubicacion.estok_id)
            contenedor = serializer.save(ubicacion=parent.ubicacion, parent_contenedor=parent)
            self._crear_registro_espejo_mudable(contenedor)
            return

        ubicacion_id = (
            self.request.data.get('ubicacion')
            or self.request.query_params.get('ubicacion')
        )
        if ubicacion_id:
            try:
                ubicacion = Ubicacion.objects.select_related('estok').get(id=ubicacion_id)
            except (Ubicacion.DoesNotExist, ValueError, ValidationError):
                raise ValidationError("La ubicacion especificada no existe.")
            _validar_membresia(self.request.user, ubicacion.estok_id)
            contenedor = serializer.save(ubicacion_id=ubicacion_id)
        else:
            contenedor = serializer.save()
        self._crear_registro_espejo_mudable(contenedor)

    def _crear_registro_espejo_mudable(self, contenedor):
        """
        REGLA DE DUALIDAD (Contenedor + Objeto) al crear un mueble mudable.

        Si el operador crea el contenedor con el checkbox de "Mueble Inmueble"
        DESMARCADO (es_inmueble=False), el backend inserta de forma obligatoria:

          1. El registro principal en Contenedor (espacio de almacenamiento:
             conserva su grilla interna y su capacidad de contener estantes,
             cajones y objetos).
          2. Un registro ESPEJO en Objeto (ítem de stock / activo físico):
             vinculado por `contenedor` y SIN coordenadas de casillero para no
             duplicar presencia en los visores espaciales. De este modo el
             mueble queda 100% mudable en el módulo de Mudanza Inter-Estok.

        El espejo NO se crea para muebles inmuebles fijos (es_inmueble=True),
        que están adheridos permanentemente a la habitación, NI para
        sub-divisiones internas (estantes/cajones con parent_contenedor):
        son parte estructural del mueble, se mudan en cascada con él y no
        generan ítems de stock propios.
        """
        if getattr(contenedor, 'es_inmueble', False):
            return

        if contenedor.parent_contenedor_id is not None:
            return

        estok_id = self.request.headers.get('X-Estok-Id')
        if not estok_id and contenedor.ubicacion_id:
            estok_id = contenedor.ubicacion.estok_id

        # Idempotencia: si el espejo (mismo contenedor y sin coordenadas) ya
        # existe, no duplicar el ítem de stock (reintentos/retries seguros).
        espejo_existente = Objeto.objects.filter(
            contenedor_id=contenedor.id,
            parent_grid_row__isnull=True,
            parent_grid_col__isnull=True,
        ).exclude(deleted_at__isnull=False).exists()
        if espejo_existente:
            return

        Objeto.objects.create(
            nombre=contenedor.nombre,
            descripcion=contenedor.descripcion or '',
            estok_id=estok_id,
            ubicacion=contenedor.ubicacion if contenedor.ubicacion_id else None,
            contenedor=contenedor,
            parent_grid_row=None,
            parent_grid_col=None,
            estado_conservacion='bueno',
            estado_carga='completo',
            campos_pendientes=[],
            material=contenedor.material or '',
            largo=contenedor.largo,
            ancho=contenedor.ancho,
            alto=contenedor.alto,
        )

    def perform_update(self, serializer):
        """
        Validación herméticamente ligada al X-Estok-Id activo:
          - El contenedor a mover debe pertenecer al Estok activo.
          - El destino (ubicacion o contenedor padre) debe pertenecer al mismo Estok.
          - No se permiten ciclos jerárquicos (padre == sí mismo o descendiente).
          - Si hay padre, la ubicacion se resuelve desde el padre.
          - El cambio de ubicacion se propaga en cascada a los sub-contenedores.
        """
        contenedor = self.get_object()
        estok_id = (
            self.request.headers.get('X-Estok-Id')
            or self.request.query_params.get('estok_id')
            or self.request.data.get('estok')
        )
        if not estok_id:
            raise ValidationError("Falta el header X-Estok-Id. La operación pertenece a un Estok activo.")
        # Normaliza el estok_id (string del header/body) a uuid.UUID para comparar
        # de forma type-safe contra los UUID del ORM (evita falsos 403).
        try:
            estok_id_uuid = UUID(str(estok_id))
        except (TypeError, ValueError):
            raise ValidationError("El Estok activo especificado no es un UUID válido.")
        if contenedor.ubicacion.estok_id != estok_id_uuid:
            raise PermissionDenied("El contenedor no pertenece al Estok activo.")

        data = self.request.data
        parent_id = data.get('parent_contenedor')
        ubicacion_id = data.get('ubicacion')

        # Operación 1: soltar dentro de OTRO contenedor (sub-nivel jerárquico)
        if parent_id not in (None, '', 'null'):
            try:
                parent = Contenedor.objects.select_related('ubicacion').get(id=parent_id)
            except (Contenedor.DoesNotExist, ValueError, ValidationError):
                raise ValidationError("El contenedor padre especificado no existe.")

            if parent.ubicacion.estok_id != estok_id_uuid:
                raise PermissionDenied("El contenedor padre no pertenece al Estok activo.")
            if str(parent.id) == str(contenedor.id):
                raise ValidationError("Un contenedor no puede ser su propio contenedor padre.")
            self._rechazar_ciclo(contenedor, parent)

            serializer.save(ubicacion=parent.ubicacion, parent_contenedor=parent)
            self._propagar_ubicacion(contenedor)
            return

        # Operación 2: soltar dentro de una UBICACION (contenedor raíz de esa ubicación)
        if ubicacion_id not in (None, ''):
            try:
                ubicacion = Ubicacion.objects.select_related('estok').get(id=ubicacion_id)
            except (Ubicacion.DoesNotExist, ValueError, ValidationError):
                raise ValidationError("La ubicación destino no existe.")
            if ubicacion.estok_id != estok_id_uuid:
                raise PermissionDenied("La ubicación destino no pertenece al Estok activo.")

            serializer.save(ubicacion=ubicacion, parent_contenedor=None)
            self._propagar_ubicacion(contenedor)
            return

        # Sin relaciones nuevas: guardado normal (PUT parcial sin tocar vínculos)
        serializer.save()

    def _rechazar_ciclo(self, contenedor, nuevo_padre):
        """Evita que un contenedor quede dentro de su propia descendencia."""
        cursor = nuevo_padre.parent_contenedor
        visitados = set()
        while cursor is not None:
            if str(cursor.id) == str(contenedor.id):
                raise ValidationError("No se puede crear un ciclo jerárquico entre contenedores.")
            if cursor.id in visitados:
                break
            visitados.add(cursor.id)
            cursor = cursor.parent_contenedor

    def _propagar_ubicacion(self, contenedor):
        """Propaga en cascada la ubicacion actual a todos los sub-contenedores."""
        for sub in contenedor.subcontenedores.all():
            if sub.ubicacion_id != contenedor.ubicacion_id:
                sub.ubicacion_id = contenedor.ubicacion_id
                sub.save(update_fields=['ubicacion'])
            self._propagar_ubicacion(sub)

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