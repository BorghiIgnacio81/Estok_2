"""
ViewSet de Ubicaciones (Plantas y Habitaciones).

Conserva el contrato exacto del antiguo monolito `organizacion.py`: consultas
multi-tenant por `X-Estok-Id`, borrado físico con protección de huérfanos y el
motor de fusión de espacios en «L» (`fusionar` / `separar` / `grupo`). Los
métodos auxiliares viven en `helpers_organizacion.py`.
"""

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from ....models import Ubicacion, Contenedor, Objeto
from ...paginacion import EstokPaginacion
from ...serializers import UbicacionSerializer
from ..base import HasRolePermission
from ..fusion_espacial import (
    editar_grupo,
    fusionar_espacios,
    ids_del_grupo,
    representantes_de_grupo,
    separar_espacios,
)
from .helpers_organizacion import OrganizacionHelpersMixin, _validar_membresia


class UbicacionViewSet(OrganizacionHelpersMixin, viewsets.ModelViewSet):
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
        qs = qs.distinct()
        # Selectores/desplegables (Paso 3 del Onboarding): colapsan el espacio
        # fusionado en «L» a UNA sola opción. El lienzo 2D NUNCA pide este flag,
        # por lo que sus tiles y la silueta en «L» quedan intactos.
        if self.action == 'list' and self._deduplicar_grupos():
            qs = representantes_de_grupo(qs)
        return qs

    def _deduplicar_grupos(self):
        """True si el cliente pide colapsar cada `fusion_grupo` a una sola fila
        (desplegables/selectores): `?deduplicar_grupos=1`."""
        valor = self.request.query_params.get('deduplicar_grupos')
        return str(valor).lower() in ('1', 'true', 'yes', 'si', 'sí')

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

        # 1) MACRO-ESPACIO COMPLETO: el nodo borrado + TODAS las partes de su
        #    grupo de fusión (una vez unidos, los cuadrantes son un solo espacio
        #    indestructible: NO existe separación) + el sub-árbol de Ubicaciones
        #    que cuelga de cada una de esas raíces. El set evita duplicados si
        #    una parte del grupo fuese a su vez descendiente de otra.
        ids_ubicaciones = set()
        for raiz in ids_del_grupo(Ubicacion, instance):
            ids_ubicaciones.add(str(raiz.id))
            ids_ubicaciones.update(
                str(hijo) for hijo in self._ids_ubicaciones_descendientes(raiz.id)
            )
        ids_ubicaciones = list(ids_ubicaciones)

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


    # =====================================================================
    # MOTOR DE FUSIÓN DE ESPACIOS EN "L" (pasillos / habitaciones irregulares)
    # ---------------------------------------------------------------------
    # Unifica dos o más espacios (Ubicaciones) bajo un MISMO ID relacional
    # (fusion_grupo, UUID) en PostgreSQL. El frontend agrupa por ese ID y
    # renderiza el conjunto como UN único espacio receptor Drag & Drop con
    # geometría irregular (la unión elástica de sus rectángulos), removiendo
    # las fronteras visuales internas.
    # =====================================================================

    @action(detail=True, methods=['post'], url_path='fusionar')
    def fusionar(self, request, pk=None):
        """
        POST /api/ubicaciones/{id}/fusionar/  con {ubicacion_ids: [uuid, ...]}

        Delega en el motor genérico `fusion_espacial`: la Ubicación del path es
        la BASE del grupo. Si ya pertenecía a un fusion_grupo, se reutiliza ese
        ID (permite fusionar en cadena sin romper grupos existentes).
        """
        base = self.get_object()
        return Response(
            fusionar_espacios(
                Ubicacion, base, request.data.get('ubicacion_ids') or [],
                lambda u: u.estok_id,
            )
        )

    @action(detail=True, methods=['post'], url_path='separar')
    def separar(self, request, pk=None):
        """
        POST /api/ubicaciones/{id}/separar/

        Disuelve la fusión: libera a TODOS los espacios del grupo
        (fusion_grupo=None) para que vuelvan a renderizarse como rectángulos
        independientes. Delegado en el motor genérico `fusion_espacial`.
        """
        base = self.get_object()
        return Response(separar_espacios(Ubicacion, base))

    @action(detail=True, methods=['put', 'patch'], url_path='grupo')
    def grupo(self, request, pk=None):
        """
        PUT /api/ubicaciones/{id}/grupo/

        Edición CONSOLIDADA del espacio fusionado en UNA sola transacción
        hermética: un único request impacta a TODAS las partes de la
        macro-estructura. Delegado en el motor genérico `fusion_espacial`.
        """
        base = self.get_object()
        return Response(
            editar_grupo(
                Ubicacion, base,
                request.data.get('nombre'), request.data.get('partes'),
            )
        )
