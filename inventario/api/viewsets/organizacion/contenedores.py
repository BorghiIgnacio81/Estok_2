"""
ViewSet de Contenedores (Espacios, Divisiones y Estanterías).

Núcleo CRUD del contenedor: consultas multi-tenant, filtros ORM por taxonomía
física (`tipo` / `movibles`), anotación de conteos por página, creación con
registro espejo mudable y reubicación hermética con rechazo de ciclos
jerárquicos. Las acciones especializadas viven en `acciones_contenedor.py` y los
métodos auxiliares en `helpers_organizacion.py`.
"""

from uuid import UUID

from rest_framework import viewsets, permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from django.db import transaction
from django.db.models import Count, Q

from ....models import Ubicacion, Contenedor, Objeto
from ...paginacion import EstokPaginacion
from ...serializers import ContenedorSerializer
from ....services.taxonomia_contenedor import (
    TIPO_CAJA,
    TIPO_MUEBLE_MOVIL,
    TIPOS,
    es_anclado,
    es_caja_movil,
    es_pieza_estructural,
)
from ..base import HasRolePermission
from ..fusion_espacial import ids_del_grupo
from .acciones_contenedor import AccionesContenedorMixin
from .helpers_organizacion import OrganizacionHelpersMixin, _validar_membresia


class ContenedorViewSet(AccionesContenedorMixin, OrganizacionHelpersMixin, viewsets.ModelViewSet):
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

        # FILTRO ORM POR TAXONOMÍA FÍSICA (`?tipo=CAJA` o lista `?tipo=CAJA,OBJETO`).
        # Lo consume la BANDEJA INFERIOR de «Elementos por ubicar» de Almacenamiento:
        # al pedir SOLO `tipo=CAJA`, las estructuras fijas (CONJUNTO / MUEBLE_INMUEBLE)
        # y los muebles (MUEBLE_MOVIL) quedan excluidos DE RAÍZ en la consulta a
        # PostgreSQL, sin listarse jamás como objeto suelto por ubicar. Los tipos
        # desconocidos se descartan; una lista sin ningún tipo válido no lista nada.
        tipos_pedidos = self.request.query_params.get('tipo')
        if tipos_pedidos:
            tipos = [t.strip().upper() for t in tipos_pedidos.split(',') if t.strip()]
            validos = [t for t in tipos if t in TIPOS]
            qs = qs.filter(tipo__in=validos) if validos else qs.none()

        # Filtro ORM de física de traslado (`?movibles=true`): whitelist positiva
        # de CAJA y MUEBLE_MOVIL no inmuebles. Excluye todo lo anclado.
        moviles = self.request.query_params.get('movibles')
        if moviles and moviles.lower() in ('true', '1', 'yes'):
            qs = qs.filter(es_inmueble=False, tipo__in=(TIPO_CAJA, TIPO_MUEBLE_MOVIL))

        # Optimización de payload: en el listado, los conteos de sub-contenedores
        # y objetos activos se resuelven con UN solo COUNT agrupado por página
        # (anotación) en lugar de 2 queries N+1 por fila.
        if self.action == 'list':
            qs = qs.annotate(
                _objetos_activos_total=Count(
                    'objetos',
                    filter=Q(objetos__deleted_at__isnull=True),
                    distinct=True,
                ),
                _subcontenedores_total=Count('subcontenedores', distinct=True),
            )
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

          - Los Objetos alojados en este contenedor Y en TODOS sus
            sub-contenedores se liberan RECURSIVAMENTE: contenedor=None y
            parent_grid_row/col=None → viajan a la bandeja inferior de «por
            ubicar» (hermético: el inventario jamás se pierde).
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

        # 0) MACRO-ESPACIO: el contenedor del path + TODAS las partes de su grupo
        #    de fusión (el bloque unificado es una unidad indestructible, no se
        #    separa). Si CUALQUIERA de las partes es inmueble fijo, se protege la
        #    estructura completa.
        partes = ids_del_grupo(Contenedor, instance)
        ids_grupo = [parte.id for parte in partes]
        if Contenedor.objects.filter(id__in=ids_grupo, es_inmueble=True).exists():
            raise PermissionDenied(
                "El mueble es inmueble fijo (es_inmueble) y no puede eliminarse."
            )

        # 1) Objetos guardados en estas partes Y en TODO su subárbol →
        #    liberar de forma RECURSIVA hacia la bandeja de huérfanos.
        #    Se actualiza (jamás DELETE): los ítems físicos permanecen intactos
        #    en PostgreSQL y reaparecen en «Objetos Sueltos o sin Caja».
        ids_subarbol = set()
        for parte in partes:
            ids_subarbol.update(self._ids_subarbol(parte))
        Objeto.objects.filter(contenedor_id__in=list(ids_subarbol)).update(
            contenedor=None,
            parent_grid_row=None,
            parent_grid_col=None,
        )

        # 2) Sub-contenedores directos de CUALQUIER parte del grupo → a nivel
        #    raíz, sin coordenadas huérfanas (su contenido interno queda intacto
        #    y disponible en el Estok). Se excluyen las propias partes borradas.
        #    TAXONOMÍA: al desacoplarse del mueble eliminado, un estante hoja
        #    pasa a ser CAJA móvil; si a su vez contiene sub-divisiones, pasa a
        #    MUEBLE. Así ninguna pieza queda huérfana de los listados.
        hijos = Contenedor.objects.filter(parent_contenedor_id__in=ids_grupo).exclude(
            id__in=ids_grupo
        )
        con_hijos = hijos.filter(subcontenedores__isnull=False).distinct()
        hijos.exclude(pk__in=con_hijos.values('pk')).update(
            parent_contenedor=None,
            parent_grid_row=None,
            parent_grid_col=None,
            tipo=TIPO_CAJA,
        )
        con_hijos.update(
            parent_contenedor=None,
            parent_grid_row=None,
            parent_grid_col=None,
            tipo=TIPO_MUEBLE_MOVIL,
        )

        # 3) Eliminación física de TODAS las partes del macro-espacio.
        Contenedor.objects.filter(id__in=ids_grupo).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @transaction.atomic
    def perform_create(self, serializer):
        """
        Asigna automaticamente la ubicacion y valida membresia al Estok.
        Si el body incluye parent_contenedor, la ubicacion se resuelve desde el padre.
        """
        crear_espejo = self._flag_crear_espejo()
        parent_id = self.request.data.get('parent_contenedor')
        if parent_id:
            try:
                parent = Contenedor.objects.select_related('ubicacion').get(id=parent_id)
            except (Contenedor.DoesNotExist, ValueError, ValidationError):
                raise ValidationError("El contenedor padre especificado no existe.")
            _validar_membresia(self.request.user, parent.ubicacion.estok_id)
            contenedor = serializer.save(ubicacion=parent.ubicacion, parent_contenedor=parent)
            self._crear_registro_espejo_mudable(contenedor, crear_espejo)
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
        self._crear_registro_espejo_mudable(contenedor, crear_espejo)


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

        # ==============================================================
        # REGLA DE FÍSICA: el anclaje al cuarto de origen es INVIOLABLE.
        # Un CONJUNTO (estructura interna del mueble) o un MUEBLE_INMUEBLE
        # (mueble fijo del cuarto) no puede arrastrarse a otro contenedor ni
        # cambiar de habitación: su lugar es su cuarto de origen.
        # ==============================================================
        if es_anclado(contenedor):
            padre_actual = contenedor.parent_contenedor_id
            padre_nuevo = (
                None if parent_id in (None, '', 'null') else str(parent_id)
            )
            if padre_nuevo is not None and padre_nuevo != str(padre_actual):
                raise PermissionDenied(
                    "«%s» está anclado a su cuarto de origen (tipo %s): no puede "
                    "arrastrarse fuera de él." % (contenedor.nombre, contenedor.tipo)
                )
            if (
                ubicacion_id not in (None, '')
                and str(ubicacion_id) != str(contenedor.ubicacion_id)
            ):
                raise PermissionDenied(
                    "«%s» está anclado a su cuarto de origen (tipo %s): no puede "
                    "cambiar de habitación." % (contenedor.nombre, contenedor.tipo)
                )

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

            # ==============================================================
            # REGLA DE EXCLUSIVIDAD DE DIVISIONES (CAJA móvil ≠ división)
            # ==============================================================
            # Las divisiones/estantes internos de un mueble son PURAS Y
            # EXCLUSIVAS de ese mueble: su cuadrícula (parent_grid_row/col) es
            # la que mapea coordenadas y decide qué sección del minimapa se
            # resalta en naranja. NINGÚN evento Drop puede agregar una CAJA
            # móvil como una división más de esa cuadrícula.
            #
            # Si lo soltado es una CAJA móvil y el destino es una pieza
            # estructural (mueble o una de sus divisiones/estantes), se
            # DESCARTAN taxativamente las coordenadas de casillero: la caja se
            # registra única y exclusivamente como CONTENIDO hijo dentro de la
            # división/estante seleccionado, sin tocar la estructura del
            # mueble. La caja conserva tipo='CAJA' y es_inmueble=False; el
            # serializer rechaza cualquier intento de reversión de esos flags.
            # ==============================================================
            if es_caja_movil(contenedor) and es_pieza_estructural(parent):
                serializer.save(
                    ubicacion=parent.ubicacion,
                    parent_contenedor=parent,
                    parent_grid_row=None,
                    parent_grid_col=None,
                )
                self._propagar_ubicacion(contenedor)
                return

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
