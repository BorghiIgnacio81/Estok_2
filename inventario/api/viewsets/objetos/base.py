"""
ViewSet base de Objetos — CRUD estándar y filtros básicos.
"""

import logging
import os

from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from django.db.models import Q

from ....models import Objeto, FotoObjeto
from ....services.mudanza_service import NOMBRES_LIMBO
from ....services.taxonomia_contenedor import (
    qe_categoria_de_caja,
    qe_nombre_de_caja,
)
from ...paginacion import EstokPaginacion
from ...serializers import (
    ObjetoListSerializer, ObjetoDetailSerializer, ObjetoCreateSerializer,
)
from ....services.clasificacion_contenedor_objeto import (
    asegurar_clasificacion_contenedor,
)
from ...plan_acceso import exigir_cupo_objetos
from ..base import HasRolePermission


logger = logging.getLogger(__name__)


class ObjetoViewSetBase(viewsets.ModelViewSet):
    """
    ViewSet base para objetos del inventario.
    Contiene únicamente el CRUD estándar y el filtrado por query params.

    PAGINACIÓN: usa la clase compartida `EstokPaginacion` (respeta
    `?page_size=N`, máx 1000). Es IMPRESCINDIBLE para los listados que
    necesitan el inventario COMPLETO del Estok (Mudanza Inter-Estok, bandejas
    de organización y visores espaciales): con la paginación global de DRF
    (25 filas, sin `page_size`) los objetos de las páginas 2+ nunca llegaban al
    frontend y desaparecían de los tableros.
    """
    queryset = Objeto.objects.all()
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]
    pagination_class = EstokPaginacion

    def get_serializer_class(self):
        if self.action == 'list':
            return ObjetoListSerializer
        elif self.action in ('update', 'partial_update'):
            return ObjetoCreateSerializer
        return ObjetoDetailSerializer

    def update(self, request, *args, **kwargs):
        """
        PUT con soporte de actualización parcial: permite que el Lienzo de
        Mapeo Espacial envíe únicamente { contenedor, parent_grid_row,
        parent_grid_col } cuando un objeto individual se suelta en un
        casillero de la grilla de un contenedor.

        COHERENCIA DE CAJA: tras guardar se re-verifica que un objeto
        declarado caja/contenedor conserve su flag y su categoría «Cajas y
        Contenedores» (services/clasificacion_contenedor_objeto). El arrastre
        desde la bandeja flotante sólo envía la jerarquía espacial, así que la
        clasificación se garantiza ACÁ y no en el cliente.
        """
        partial = True
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        asegurar_clasificacion_contenedor(instance)
        if getattr(instance, '_prefetched_objects_cache', None):
            instance._prefetched_objects_cache = {}
        data = serializer.data
        # ¿El precio se empujó a la publicación de Mercado Libre? (ver
        # ObjetoCreateSerializer.update → services/mercadolibre_estado).
        # Se informa para que la UI pueda confirmarlo; el contrato del objeto
        # queda intacto (clave extra, nunca reemplaza un campo del modelo).
        sincronizado = getattr(instance, '_ml_precio_sincronizado', None)
        if sincronizado is not None:
            data['ml_precio_sincronizado'] = bool(sincronizado)
        return Response(data)

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

        CONTROL DE FUNCIONALIDADES / PLAN: antes de crear se verifica la cuota
        de objetos del plan (100 en el plan gratuito; ilimitada en Pro). El
        bloqueo es un HTTP 403 con `codigo: "limite_objetos_alcanzado"` y el
        estado completo de la cuota, para que el frontend muestre el aviso de
        upgrade (ver inventario/services/suscripcion.py).
        """
        bloqueo = exigir_cupo_objetos(request)
        if bloqueo is not None:
            return bloqueo

        create_serializer = ObjetoCreateSerializer(
            data=request.data, context={'request': request}
        )
        create_serializer.is_valid(raise_exception=True)
        objeto = create_serializer.save()

        self._guardar_fotos_multiple(objeto, request)

        # COHERENCIA DE CAJA en el alta: un objeto creado como caja/contenedor
        # (marca, categoría «Cajas y Contenedores» o rótulo «Caja 0N») queda con
        # su flag y su categoría persistidos desde el primer guardado.
        asegurar_clasificacion_contenedor(objeto)

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
        # `?incluir_sin_estok=true` (opt-in, default = comportamiento histórico):
        # incluye además los objetos FÍSICAMENTE presentes en el Estok activo
        # cuya FK `estok` quedó nula (huérfanos de carga/legacy) pero que sí
        # cuelgan de una ubicación del inquilinato. Lo usa el listado asíncrono
        # de la Mudanza Inter-Estok para no perder ningún objeto suelto.
        incluir_sin_estok = (
            self.request.query_params.get('incluir_sin_estok') or ''
        ).strip().lower() in ('true', '1', 'si', 'yes')
        if estok_id:
            if incluir_sin_estok:
                qs = qs.filter(
                    Q(estok_id=estok_id)
                    | Q(estok__isnull=True, ubicacion__estok_id=estok_id)
                )
            else:
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

        # ------------------------------------------------------------------
        # FILTRO ORM DE LA CANASTA «🧺 ELEMENTOS POR UBICAR» (`?bandeja=true`)
        # ------------------------------------------------------------------
        # La canasta tiene CUATRO pestañas con filtros EXACTOS. Este endpoint
        # devuelve el UNIVERSO que esas pestañas necesitan; el reparto final lo
        # hace `bandejaSinUbicar.ts` (que además re-verifica en profundidad):
        #
        #   Pestaña 1 · Objetos sueltos    → contenedor IS NULL y (en tránsito o
        #                                    sin ubicación).
        #   Pestaña 3 · Objetos a reubicar → contenedor IS NULL y ubicación
        #                                    IS NULL.
        #
        # Ambas condiciones se unen en `sueltos`: un objeto con `contenedor`
        # asignado NUNCA se lista en estas pestañas —su ubicación física depende
        # exclusivamente de la caja que lo aloja y el bulto recuperable es el
        # chip de ESA caja—, así que se excluye de raíz en el ORM.
        #
        #   Pestaña 2 · Cajas sueltas      → cajas / Objetos-caja SIN espacio.
        #   Pestaña 4 · Cajas a reubicar   → cajas / Objetos-caja CON espacio.
        #
        # Las cajas registradas como `Objeto` (Cajas 02…05: marca
        # `es_contenedor`, categoría «Cajas y Contenedores» o rótulo numerado)
        # viajan también, estén o no dentro de otra caja, porque la pestaña 4
        # lista TODAS las que tienen espacio físico y deben poder arrastrarse.
        # Los espejos de dualidad Contenedor⇄Objeto quedan fuera: su caja real
        # ya es un chip propio y se duplicaría.
        # ------------------------------------------------------------------
        bandeja = self.request.query_params.get('bandeja')
        if bandeja and bandeja.lower() in ('true', '1', 'yes'):
            limbo = Q(ubicacion__nombre__in=NOMBRES_LIMBO)
            if estok_id:
                limbo = Q(
                    Q(ubicacion__estok_id=estok_id) | Q(ubicacion__estok__isnull=True),
                    ubicacion__nombre__in=NOMBRES_LIMBO,
                )
            # Pestañas 1 y 3 · sin contenedor, en tránsito o sin espacio físico.
            sueltos = Q(contenedor__isnull=True) & (Q(ubicacion__isnull=True) | limbo)
            # Pestañas 2 y 4 · Objetos declarados CAJA / CONTENEDOR.
            # El guardia del espejo se escribe con `has_key` para que la clave
            # AUSENTE (caso normal) no propague NULL y descarte la fila: sin
            # esto, `NOT (especificaciones -> 'es_espejo_contenedor' = true)`
            # evalúa NULL para todo objeto sin la marca.
            es_espejo = (
                Q(especificaciones__has_key='es_espejo_contenedor')
                & Q(especificaciones__es_espejo_contenedor=True)
            )
            cajas_objeto = (
                Q(es_contenedor=True)
                | qe_categoria_de_caja()
                | qe_nombre_de_caja()
            ) & ~es_espejo
            qs = qs.filter(sueltos | cajas_objeto)

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

        return qs.select_related(
            'ubicacion', 'contenedor', 'contenedor__parent_contenedor',
            'categoria', 'objeto_padre',
        ).prefetch_related('fotos')

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


