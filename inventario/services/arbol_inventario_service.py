"""
Servicio de construcción del ÁRBOL JERÁRQUICO DE INVENTARIO (Objetos).

Reúne en UNA sola respuesta la estructura de almacenamiento del Estok activo:

  - Contenedores físicos (cajas, estantes, armarios, muebles) anidados por
    `parent_contenedor` (cascada recursiva de sub-contenedores).
  - El contenido de cada contenedor (`contenido`): desglose ordenado de todo lo
    que reside en su interior, primero sub-cajas (recursivo) y luego objetos
    individuales (FK `Objeto.contenedor`).
  - Objetos sueltos o sin ubicación (sección inferior del listado).

Optimización SQL/ORM en PostgreSQL:
  - 1 query para contenedores del Estok (select_related('ubicacion')).
  - 1 query para objetos del Estok (select_related + prefetch_related('fotos')).
  - Cero consultas N+1: los árboles, conteos y agrupaciones se resuelven en
    memoria a partir de los dos resultados prefetcheados.

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

    Cada Nodo de contenedor incluye "contenido": desglose ordenado de su
    interior (sub-contenedores recursivos primero, luego objetos individuales).
    """
    # ------------------------------------------------------------------
    # 1) Contenedores del Estok (1 query con select_related)
    # ------------------------------------------------------------------
    contenedores = list(
        Contenedor.objects.select_related('ubicacion')
        .filter(ubicacion__estok_id=estok_id)
        .order_by('ubicacion__nombre', 'nombre')
    )
    contenedores_por_id = {str(c.id): c for c in contenedores}

    # Hijos directos por contenedor padre (preservando el orden natural).
    hijos_por_padre = {}
    for c in contenedores:
        if c.parent_contenedor_id is not None:
            hijos_por_padre.setdefault(str(c.parent_contenedor_id), []).append(c)
    for lista in hijos_por_padre.values():
        lista.sort(key=lambda c: _clave_orden_natural(c.nombre))

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
    objetos_por_contenedor = {}
    objetos_sueltos = []
    for od in objetos_serializados:
        contenedor_id = od.get('contenedor')
        if not contenedor_id:
            objetos_sueltos.append(od)
        elif str(contenedor_id) in contenedores_por_id:
            objetos_por_contenedor.setdefault(str(contenedor_id), []).append(od)
        else:
            # Contenedor fantasma (borrado/migrado): el inventario jamás se pierde.
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
            tiene_contenido_real = any(
                not _es_registro_espejo(o, contenedor) for o in objetos
            )
            if not tiene_contenido_real:
                continue
            cursor = contenedor
            while cursor is not None:
                contenedores_incluidos.add(str(cursor.id))
                if (
                    cursor.parent_contenedor_id is not None
                    and str(cursor.parent_contenedor_id) in contenedores_por_id
                ):
                    cursor = contenedores_por_id[str(cursor.parent_contenedor_id)]
                else:
                    break
    else:
        contenedores_incluidos = set(contenedores_por_id.keys())

    # ------------------------------------------------------------------
    # 5) Nodo recursivo de contenedor (con su desglose "contenido")
    # ------------------------------------------------------------------
    def _nodo_contenedor(contenedor):
        hijos_incluidos = [
            h for h in hijos_por_padre.get(str(contenedor.id), [])
            if str(h.id) in contenedores_incluidos
        ]
        objetos_directos = [
            od for od in objetos_por_contenedor.get(str(contenedor.id), [])
            if not _es_registro_espejo(od, contenedor)
        ]

        contenido = []
        for hijo in hijos_incluidos:
            contenido.append(_nodo_contenedor(hijo))
        for od in objetos_directos:
            contenido.append({**od, 'tipo': 'objeto'})

        return {
            'tipo': 'contenedor',
            'id': str(contenedor.id),
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
            'parent_contenedor': (
                str(contenedor.parent_contenedor_id)
                if contenedor.parent_contenedor_id else None
            ),
            'subcontenedores_count': len(hijos_incluidos),
            'objetos_count': len(objetos_directos),
            'contenido': contenido,
        }

    # ------------------------------------------------------------------
    # 6) Raíces (contenedores sin padre o con padre fuera del Estok),
    #    agrupadas por Ubicación para el encabezado de cada espacio.
    # ------------------------------------------------------------------
    grupos = {}
    raices = [
        c for c in contenedores
        if str(c.id) in contenedores_incluidos
        and (
            c.parent_contenedor_id is None
            or str(c.parent_contenedor_id) not in contenedores_por_id
        )
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
    # 7) Objetos sueltos (sección inferior, consistencia de inventario)
    # ------------------------------------------------------------------
    sueltos = sorted(
        objetos_sueltos,
        key=lambda o: (o.get('fecha_registro') or ''), reverse=True,
    )
    total_objetos_ubicados = 0
    for lista in objetos_por_contenedor.values():
        total_objetos_ubicados += len(lista)

    return {
        'estructuras': list(grupos.values()),
        'sueltos': sueltos,
        'filtros_activos': filtros_activos,
        'resumen': {
            'contenedores': len(contenedores_incluidos),
            'objetos_ubicados': total_objetos_ubicados,
            'objetos_sueltos': len(sueltos),
        },
    }

