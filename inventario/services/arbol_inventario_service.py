"""
Servicio de construcción del ÁRBOL JERÁRQUICO DE INVENTARIO (Objetos).

Reúne en UNA sola respuesta la TAXONOMÍA VÁLIDA del Estok activo:

  - SECCIÓN 1 (`cajas`): Contenedores con `tipo='CAJA'` (cajas móviles de
    objetos), a cualquier nivel (raíz o dentro de un mueble), cada uno con sus
    Objetos físicos DIRECTOS. Filtro ORM ÚNICO Y EXCLUSIVO por `tipo='CAJA'`.
  - SECCIÓN 3 (`estructuras`): Muebles (`tipo='MUEBLE'`) RAÍZ mudables
    (`es_inmueble=False`), agrupados por Ubicación, cada uno con los Objetos
    físicos que aloja (incluidos los que cuelgan de sus estanterías).
  - SECCIÓN 2 (`sueltos`): Objetos sueltos o sin contenedor.

REGLA TAXONÓMICA ESTRICTA (pestaña de Objetos):
  Los `tipo='ESTANTE'` (sub-divisiones internas, estanterías o cajoneras de un
  mueble) quedan TERMINANTEMENTE EXCLUIDOS de TODA consulta y renderizado: el
  filtro se aplica en el ORM (`tipo`), nunca en memoria.

Optimización SQL/ORM en PostgreSQL:
  - 1 query para los MUEBLES raíz del Estok (select_related('ubicacion')).
  - 1 query para las CAJAS del Estok (select_related('ubicacion')).
  - 1 query liviana para el mapa de ancestros (id → parent_contenedor_id),
    usada para reasignar el inventario de una estantería a su mueble raíz.
  - 1 query para objetos del Estok (select_related + prefetch_related('fotos')).
  - Cero consultas N+1: los conteos y agrupaciones se resuelven en memoria.

REGLA DE DUALIDAD (Contenedor + Objeto): al crear un mueble/caja raíz mudable,
el backend inserta un registro ESPEJO en Objeto (mismo nombre, sin coordenadas
de casillero) para que el mueble sea 100% mudable en la Mudanza Inter-Estok.
Ese espejo se EXCLUYE del desglose interior para no autoduplicar la caja/armario
como objeto contenido en sí mismo.
"""

import re

from django.db.models import Q

from ..models import Contenedor, Objeto
from ..api.serializers import ObjetoListSerializer
from .taxonomia_contenedor import TIPO_CAJA, TIPO_MUEBLE

# ---------------------------------------------------------------------------
# Helpers de orden "natural" (Caja 1 < Caja 02 < Caja 03 < Caja 10)
# ---------------------------------------------------------------------------

_NUMERICO_RE = re.compile(r'(\d+)')


def _clave_orden_natural(nombre):
    """Clave de orden que respeta el valor numérico de los sufijos/nombres."""
    nombre = nombre or ''
    return [
        int(parte) if parte.isdigit() else parte.lower()
        for parte in _NUMERICO_RE.split(nombre)
    ]


# ---------------------------------------------------------------------------
# Regla de espejo (DUALIDAD Contenedor + Objeto)
# ---------------------------------------------------------------------------

def _es_registro_espejo(objeto_data, contenedor):
    """
    Detecta el registro ESPEJO que el backend crea automáticamente al crear un
    mueble/caja raíz mudable (Contenedor + Objeto con el mismo nombre).

    Solo puede existir espejo para contenedores RAÍZ (sin parent_contenedor) y
    MUDABLES (es_inmueble=False). El espejo tiene el MISMO nombre que el
    contenedor y NO posee coordenadas de casillero (parent_grid_row/col nulos).
    """
    if contenedor.es_inmueble or contenedor.parent_contenedor_id is not None:
        return False
    if (
        objeto_data.get('parent_grid_row') is not None
        or objeto_data.get('parent_grid_col') is not None
    ):
        return False
    return (objeto_data.get('nombre') or '') == (contenedor.nombre or '')


# ---------------------------------------------------------------------------
# Consulta de objetos (mismos filtros que el listado de /api/objetos/)
# ---------------------------------------------------------------------------

def _objetos_del_estok(
    estok_id,
    categoria=None,
    decision=None,
    publicado_ml=None,
    search=None,
):
    """Objetos activos del Estok con prefetch óptimo y filtros opcionales."""
    from ..api.viewsets.objetos.base import ObjetoViewSetBase  # evita ciclos

    qs = Objeto.objects.select_related(
        'ubicacion', 'contenedor', 'categoria', 'objeto_padre',
    ).prefetch_related('fotos')
    qs = qs.filter(estok_id=estok_id, deleted_at__isnull=True)

    if categoria:
        qs = qs.filter(categoria_id=categoria)

    if decision:
        decision = str(decision).strip().lower()
        if decision == 'sin_decision':
            qs = qs.filter(owner_action__isnull=True)
        elif decision in dict(Objeto.OWNER_ACTION_CHOICES):
            qs = qs.filter(owner_action=decision)

    if publicado_ml:
        publicado_ml = str(publicado_ml).strip().lower()
        if publicado_ml in ('true', '1', 'si', 'publicado'):
            qs = qs.filter(ObjetoViewSetBase._q_publicado_ml())
        elif publicado_ml in ('false', '0', 'no', 'no_publicado'):
            qs = qs.exclude(ObjetoViewSetBase._q_publicado_ml())

    if search:
        qs = qs.filter(
            Q(nombre__icontains=search) | Q(descripcion__icontains=search)
        )

    # Orden estable por defecto del modelo (más recientes primero).
    return qs.order_by('-fecha_registro')


# ---------------------------------------------------------------------------
# Construcción del payload jerárquico
# ---------------------------------------------------------------------------

def construir_arbol_estok(
    estok_id,
    request=None,
    categoria=None,
    decision=None,
    publicado_ml=None,
    search=None,
):
    """
    Retorna el payload del árbol jerárquico del Estok activo:

    {
      "estructuras": [ { ubicacion_id, ubicacion_nombre, contenedores: [Nodo] } ],
      "sueltos": [ ObjetoListSerializer ... ],
      "filtros_activos": bool,
      "resumen": { "contenedores": N, "objetos_ubicados": N, "objetos_sueltos": N }
    }

    Cada Nodo de contenedor (Mueble Mayor / Caja raíz) incluye "contenido":
    el desglose de sus Objetos físicos individuales. Las sub-divisiones
    internas/estanterías NO se incluyen nunca (filtro ORM estricto).
    """
    # ------------------------------------------------------------------
    # 1) MUEBLES del Estok (SECCIÓN 3 · filtro ORM estricto)
    #
    # REGLA TAXONÓMICA ESTRICTA DE LA PESTAÑA DE OBJETOS:
    #   - SECCIÓN 3 (Muebles y Estructuras Móviles): SOLO `tipo='MUEBLE'` y
    #     `es_inmueble=False`. Los muebles fijos quedan excluidos de forma
    #     absoluta.
    #   - Los `tipo='ESTANTE'` (sub-divisiones internas) NUNCA se consultan:
    #     son estructura interna del mueble, no ítems de inventario.
    #   El filtro es ORM (no en memoria) para que PostgreSQL jamás devuelva
    #   filas fuera de la taxonomía.
    # ------------------------------------------------------------------
    muebles = list(
        Contenedor.objects.select_related('ubicacion')
        .filter(
            ubicacion__estok_id=estok_id,
            parent_contenedor__isnull=True,
            tipo=TIPO_MUEBLE,
            es_inmueble=False,
        )
        .order_by('ubicacion__nombre', 'nombre')
    )
    contenedores_por_id = {str(c.id): c for c in muebles}

    # ------------------------------------------------------------------
    # 1bis) CAJAS del Estok (SECCIÓN 1 · filtro ORM ÚNICO Y EXCLUSIVO)
    #
    #   SOLO `tipo='CAJA'`, a cualquier nivel: raíz o guardada dentro de un
    #   ropero/archivador. Queda estrictamente prohibido devolver muebles o
    #   estanterías en este bloque.
    # ------------------------------------------------------------------
    cajas = list(
        Contenedor.objects.select_related('ubicacion')
        .filter(
            ubicacion__estok_id=estok_id,
            tipo=TIPO_CAJA,
        )
        .order_by('ubicacion__nombre', 'nombre')
    )
    cajas_por_id = {str(c.id): c for c in cajas}
    cajas.sort(
        key=lambda c: (
            c.ubicacion.nombre.lower() if c.ubicacion_id else '',
            _clave_orden_natural(c.nombre),
        )
    )

    # Mapa liviano de la jerarquía completa (id → parent_contenedor_id) del
    # Estok: permite subir por la cadena de ancestros SIN devolver las
    # sub-divisiones internas en el listado. Sirve para reasignar el inventario
    # de una caja que vive dentro de una estantería a su Mueble Mayor raíz.
    padres_por_id = {
        str(cid): pid
        for cid, pid in Contenedor.objects.filter(
            ubicacion__estok_id=estok_id,
        ).values_list('id', 'parent_contenedor_id')
    }

    # Cantidad REAL de sub-divisiones internas por Mueble Mayor (metadato de
    # ficha: NO se listan, sólo alimentan el conteo de la tarjeta del mueble).
    subcontenedores_por_padre = {}
    for cid, pid in padres_por_id.items():
        if pid is not None:
            clave_padre = str(pid)
            subcontenedores_por_padre[clave_padre] = (
                subcontenedores_por_padre.get(clave_padre, 0) + 1
            )

    def _raiz_de(contenedor_id):
        """
        Sube por la cadena de contenedores padre hasta el RAÍZ del Estok.

        Devuelve el id (str) del Mueble Mayor/Caja raíz, o None si el id no
        pertenece a ningún contenedor del Estok (registro fantasma/borrado).
        Se apoya en `padres_por_id` (una sola query) → cero N+1.
        """
        cursor = str(contenedor_id)
        visitados = set()
        while cursor is not None and cursor not in visitados:
            visitados.add(cursor)
            if cursor not in padres_por_id:
                return None
            padre = padres_por_id.get(cursor)
            if padre is None:
                return cursor
            cursor = str(padre)
        return None

    # ------------------------------------------------------------------
    # 2) Objetos del Estok (1 query con select_related + prefetch fotos)
    # ------------------------------------------------------------------
    objetos_qs = _objetos_del_estok(
        estok_id,
        categoria=categoria, decision=decision,
        publicado_ml=publicado_ml, search=search,
    )
    objetos_serializados = ObjetoListSerializer(
        objetos_qs, many=True, context={'request': request},
    ).data

    # ------------------------------------------------------------------
    # 3) Agrupación en memoria (cero N+1)
    # ------------------------------------------------------------------
    objetos_por_contenedor = {}          # mueble raíz → objetos (SECCIÓN 3)
    objetos_directos_por_caja = {}       # caja → objetos directos (SECCIÓN 1)
    objetos_sueltos = []
    for od in objetos_serializados:
        contenedor_id = od.get('contenedor')
        if not contenedor_id:
            objetos_sueltos.append(od)
            continue

        clave = str(contenedor_id)
        if clave not in padres_por_id:
            # Contenedor fantasma (borrado/migrado): el inventario jamás se pierde.
            od['contenedor_ausente'] = True
            objetos_sueltos.append(od)
            continue

        # SECCIÓN 1: contenido DIRECTO de cada caja del Estok.
        if clave in cajas_por_id:
            objetos_directos_por_caja.setdefault(clave, []).append(od)

        # SECCIÓN 3: los objetos que cuelgan de una sub-división interna
        # (estantería) se reasignan a su Mueble Mayor raíz. La pantalla sólo
        # estructura Muebles, Cajas y Objetos, jamás la estantería intermedia.
        raiz_id = _raiz_de(clave)
        if raiz_id is not None and raiz_id in contenedores_por_id:
            objetos_por_contenedor.setdefault(raiz_id, []).append(od)
        elif raiz_id is not None and raiz_id in cajas_por_id:
            # El objeto pertenece a una caja raíz: su hogar es la SECCIÓN 1.
            # No se duplica como contenido de mueble.
            continue
        else:
            od['contenedor_ausente'] = True
            objetos_sueltos.append(od)

    for lista in objetos_por_contenedor.values():
        lista.sort(key=lambda o: _clave_orden_natural(o.get('nombre') or ''))

    filtros_activos = bool(categoria or decision or publicado_ml or search)

    # ------------------------------------------------------------------
    # 4) Poda por filtros: solo contenedores con contenido que coincida
    #    (y sus ancestros). Sin filtros → se incluyen todos.
    # ------------------------------------------------------------------
    contenedores_incluidos = set()
    if filtros_activos:
        for cid, objetos in objetos_por_contenedor.items():
            contenedor = contenedores_por_id.get(cid)
            if contenedor is None:
                continue
            # Con el filtro ORM estricto TODA fila incluida es RAÍZ, por lo que
            # no hace falta subir por ancestros: basta con que tenga contenido.
            tiene_contenido_real = any(
                not _es_registro_espejo(o, contenedor) for o in objetos
            )
            if tiene_contenido_real:
                contenedores_incluidos.add(cid)
    else:
        contenedores_incluidos = set(contenedores_por_id.keys())

    # Poda equivalente para la SECCIÓN 1 (cajas): con filtros activos sólo se
    # devuelven las cajas con objetos directos REALES que coincidan.
    cajas_incluidas = set()
    if filtros_activos:
        for cid, objetos in objetos_directos_por_caja.items():
            caja = cajas_por_id.get(cid)
            if caja is None:
                continue
            if any(not _es_registro_espejo(o, caja) for o in objetos):
                cajas_incluidas.add(cid)
    else:
        cajas_incluidas = set(cajas_por_id.keys())

    # ------------------------------------------------------------------
    # 5) Nodo de contenedor RAÍZ (con su desglose "contenido")
    # ------------------------------------------------------------------
    def _nodo_contenedor(contenedor):
        objetos_directos = [
            od for od in objetos_por_contenedor.get(str(contenedor.id), [])
            if not _es_registro_espejo(od, contenedor)
        ]

        # La pantalla NO anida sub-contenedores: el "contenido" de un Mueble
        # Mayor/Caja raíz son exclusivamente sus Objetos físicos individuales.
        contenido = [{**od, 'tipo': 'objeto'} for od in objetos_directos]
        clave = str(contenedor.id)

        return {
            'tipo': 'contenedor',
            'tipo_contenedor': TIPO_MUEBLE,
            'id': clave,
            'nombre': contenedor.nombre,
            'descripcion': contenedor.descripcion or '',
            'ubicacion': (
                str(contenedor.ubicacion_id) if contenedor.ubicacion_id else None
            ),
            'ubicacion_nombre': (
                contenedor.ubicacion.nombre if contenedor.ubicacion_id else None
            ),
            'es_inmueble': bool(contenedor.es_inmueble),
            'material': contenedor.material or None,
            'grid_filas': contenedor.grid_filas,
            'grid_columnas': contenedor.grid_columnas,
            'grid_filas_config': contenedor.grid_filas_config,
            'parent_contenedor': None,
            # Metadato real de ficha: cuántas sub-divisiones internas tiene el
            # mueble (NO se listan: sólo caracterizan la tarjeta).
            'subcontenedores_count': subcontenedores_por_padre.get(clave, 0),
            'objetos_count': len(objetos_directos),
            'contenido': contenido,
        }

    def _nodo_caja(caja):
        """
        Nodo de CAJA para la SECCIÓN 1 (Cajas e Inventario Interno).

        Conserva los metadatos geográficos (ubicación, mueble padre y
        coordenadas de casillero) que el cliente necesita para dibujar la ruta
        de minimapas Piso → Habitación → Mueble, y expone SOLO sus Objetos
        físicos directos como contenido.
        """
        clave = str(caja.id)
        objetos_directos = [
            od for od in objetos_directos_por_caja.get(clave, [])
            if not _es_registro_espejo(od, caja)
        ]
        return {
            'tipo': 'contenedor',
            'tipo_contenedor': TIPO_CAJA,
            'id': clave,
            'nombre': caja.nombre,
            'descripcion': caja.descripcion or '',
            'ubicacion': str(caja.ubicacion_id) if caja.ubicacion_id else None,
            'ubicacion_nombre': (
                caja.ubicacion.nombre if caja.ubicacion_id else None
            ),
            'es_inmueble': False,
            'material': caja.material or None,
            'grid_filas': caja.grid_filas,
            'grid_columnas': caja.grid_columnas,
            'grid_filas_config': caja.grid_filas_config,
            'parent_contenedor': (
                str(caja.parent_contenedor_id) if caja.parent_contenedor_id else None
            ),
            'parent_grid_row': caja.parent_grid_row,
            'parent_grid_col': caja.parent_grid_col,
            'subcontenedores_count': subcontenedores_por_padre.get(clave, 0),
            'objetos_count': len(objetos_directos),
            'contenido': [{**od, 'tipo': 'objeto'} for od in objetos_directos],
        }

    # ------------------------------------------------------------------
    # 6) Raíces (contenedores sin padre o con padre fuera del Estok),
    #    agrupadas por Ubicación para el encabezado de cada espacio.
    # ------------------------------------------------------------------
    grupos = {}
    raices = [
        c for c in muebles
        if str(c.id) in contenedores_incluidos
    ]
    raices.sort(
        key=lambda c: (
            c.ubicacion.nombre.lower() if c.ubicacion_id else '',
            _clave_orden_natural(c.nombre),
        )
    )

    for c in raices:
        clave = str(c.ubicacion_id) if c.ubicacion_id else '__sin_ubicacion'
        grupo = grupos.get(clave)
        if grupo is None:
            grupo = grupos[clave] = {
                'ubicacion_id': (
                    str(c.ubicacion_id) if c.ubicacion_id else None
                ),
                'ubicacion_nombre': (
                    c.ubicacion.nombre if c.ubicacion_id else 'Sin ubicación'
                ),
                'contenedores': [],
            }
        grupo['contenedores'].append(_nodo_contenedor(c))

    # ------------------------------------------------------------------
    # 6bis) Nodos de CAJA (SECCIÓN 1 · Cajas e Inventario Interno)
    # ------------------------------------------------------------------
    cajas_nodos = [
        _nodo_caja(c) for c in cajas if str(c.id) in cajas_incluidas
    ]

    # ------------------------------------------------------------------
    # 7) Objetos sueltos (sección inferior, consistencia de inventario)
    # ------------------------------------------------------------------
    sueltos = sorted(
        objetos_sueltos,
        key=lambda o: (o.get('fecha_registro') or ''), reverse=True,
    )
    # Objetos realmente ubicados (containers existentes del Estok), sin contar
    # dos veces los que viven en una caja anidada dentro de un mueble.
    total_objetos_ubicados = sum(
        1 for od in objetos_serializados
        if od.get('contenedor') and str(od['contenedor']) in padres_por_id
    )

    return {
        'estructuras': list(grupos.values()),
        'cajas': cajas_nodos,
        'sueltos': sueltos,
        'filtros_activos': filtros_activos,
        'resumen': {
            'contenedores': len(contenedores_incluidos) + len(cajas_incluidas),
            'objetos_ubicados': total_objetos_ubicados,
            'objetos_sueltos': len(sueltos),
        },
    }

