"""
Capa de DATOS del ÁRBOL DE INVENTARIO (pestaña Objetos).

Separa el ACCESO A POSTGRESQL del ensamblado en memoria
(`arbol_inventario_service.py`). Concentra en UN único lugar la TAXONOMÍA
ESTRICTA que alimenta `GET /api/contenedores/arbol/` (vista `/objetos`):

  - `muebles_raiz_del_estok` (SECCIÓN 3): SOLO `tipo='MUEBLE_MOVIL'` RAÍZ, con
    `es_inmueble=False` y `declarado_movible=True`.
  - `cajas_del_estok` (SECCIÓN 1): SOLO `tipo='CAJA'`, con `es_inmueble=False`
    y `declarado_movible=True`.
  - `mapa_padres_del_estok`: 1 query liviana (id → parent_contenedor_id).
  - `objetos_del_estok`: 1 query de objetos activos con prefetch de fotos.

DECLARACIÓN EXPLÍCITA DE MOVILIDAD (`declarado_movible`, Lote 22): es el
checkbox «Declarar como Mueble Móvil / Objeto» del modal de edición. Destildado
(False) la pieza es ARQUITECTURA del espacio (ej. «Ropero Empotrado», «PC
Setup») y queda EXPULSADA DE RAÍZ de la pantalla de objetos, aunque su `tipo`
inferido sea CAJA o MUEBLE_MOVIL. La vista `/objetos` lista SOLO bultos reales
declarados movibles; los espacios fijos deben ser expulsados de raíz.
"""

import re

from django.db.models import Q

from ..models import Contenedor, Objeto
from .taxonomia_contenedor import TIPO_CAJA, TIPO_MUEBLE_MOVIL

# ---------------------------------------------------------------------------
# Utilidades puras de serialización
# ---------------------------------------------------------------------------

_NUMERICO_RE = re.compile(r'(\d+)')


def clave_orden_natural(nombre):
    """Clave de orden que respeta el valor numérico de los sufijos/nombres."""
    nombre = nombre or ''
    return [
        int(parte) if parte.isdigit() else parte.lower()
        for parte in _NUMERICO_RE.split(nombre)
    ]


def decimal_a_float(valor):
    """Decimal → float serializable a JSON (o None si el campo está vacío)."""
    return float(valor) if valor is not None else None


def foto_url(instancia, request):
    """
    URL absoluta de la FOTO FÍSICA de un contenedor (o None si no tiene).

    La ficha técnica del frontend (modal «Editar» de las tarjetas) la usa para
    previsualizar la fotografía actual antes de reemplazarla por multipart.
    """
    archivo = getattr(instancia, 'foto', None)
    if not archivo:
        return None
    try:
        url = archivo.url
    except ValueError:
        return None
    if request is not None:
        return request.build_absolute_uri(url)
    return url


def es_registro_espejo(objeto_data, contenedor):
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
# Consultas ORM con TAXONOMÍA ESTRICTA (pestaña Objetos)
# ---------------------------------------------------------------------------

def muebles_raiz_del_estok(estok_id):
    """
    Muebles RAÍZ mudables del Estok (SECCIÓN 3 · filtro ORM estricto).

    SOLO `tipo='MUEBLE_MOVIL'` con `es_inmueble=False` y `declarado_movible=True`.
    Los `tipo='CONJUNTO'` (estructura interna del mueble) y los
    `tipo='MUEBLE_INMUEBLE'` (muebles fijos del cuarto) NUNCA se consultan: el
    filtro es ORM (no en memoria) para que PostgreSQL jamás devuelva filas
    fuera de la taxonomía.
    """
    return (
        Contenedor.objects.select_related('ubicacion')
        .filter(
            ubicacion__estok_id=estok_id,
            parent_contenedor__isnull=True,
            tipo=TIPO_MUEBLE_MOVIL,
            es_inmueble=False,
            # DECLARACIÓN EXPLÍCITA DEL OPERADOR: destildar «Declarar como Mueble
            # Móvil / Objeto» expulsa la pieza de la pantalla de objetos aunque
            # su tipo inferido sea MUEBLE_MOVIL.
            declarado_movible=True,
        )
        .order_by('ubicacion__nombre', 'nombre')
    )


def cajas_del_estok(estok_id):
    """
    Cajas del Estok (SECCIÓN 1 · filtro ORM ÚNICO Y EXCLUSIVO).

    SOLO `tipo='CAJA'` MÓVILES (`es_inmueble=False`) y DECLARADAS movibles
    (`declarado_movible=True`), a cualquier nivel (raíz o guardada dentro de un
    ropero/archivador). NUNCA se devuelven muebles, estanterías ni piezas con
    flag de inmueble fijo (armario empotrado, PC Setup, etc.).
    """
    return (
        Contenedor.objects.select_related('ubicacion')
        .filter(
            ubicacion__estok_id=estok_id,
            tipo=TIPO_CAJA,
            es_inmueble=False,
            # DECLARACIÓN EXPLÍCITA: excluye de raíz la arquitectura del espacio
            # (ej. «Ropero Empotrado») aunque su tipo inferido sea CAJA.
            declarado_movible=True,
        )
        .order_by('ubicacion__nombre', 'nombre')
    )


def mapa_padres_del_estok(estok_id):
    """
    Mapa liviano de la jerarquía completa (id → parent_contenedor_id) del Estok:
    permite subir por la cadena de ancestros SIN devolver las sub-divisiones
    internas en el listado. Sirve para reasignar el inventario de una caja que
    vive dentro de una estantería a su Mueble Mayor raíz.
    """
    return {
        str(cid): pid
        for cid, pid in Contenedor.objects.filter(
            ubicacion__estok_id=estok_id,
        ).values_list('id', 'parent_contenedor_id')
    }


def objetos_del_estok(
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

