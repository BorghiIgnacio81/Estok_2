"""
Capa de DATOS del ÁRBOL DE INVENTARIO (pestaña Objetos).

Separa el ACCESO A POSTGRESQL del ensamblado en memoria
(`arbol_inventario_service.py`). Concentra en UN único lugar la TAXONOMÍA
ESTRICTA que alimenta `GET /api/contenedores/arbol/` (vista `/objetos`):

  - `muebles_raiz_del_estok` (SECCIÓN 3): piezas RAÍZ con `es_inmueble=False` y
    `declarado_movible=True` que son MUEBLES MÓVILES (`tipo='MUEBLE_MOVIL'`) O
    ESPACIOS CONTENEDORES INTERMEDIOS que actúan como mueble (alojan
    sub-divisiones propias: «Baúl», «Cama Cucheta»), aunque su tipo sea CAJA.
  - `cajas_del_estok` (SECCIÓN 1): bultos chicos TERMINALES (`tipo='CAJA'`,
    `es_inmueble=False`, `declarado_movible=True` y SIN sub-divisiones propias),
    a cualquier nivel, MÁS el 🔓 RESCATE de emergencia de las cajas RAÍZ que
    quedaron sueltas en el limbo de mudanza (Lote 28: sin declaración ni
    terminalidad, para que el operador pueda verlas y recuperarlas).
  - `mapa_padres_del_estok`: 1 query liviana (id → parent_contenedor_id).
  - `objetos_del_estok`: 1 query de objetos activos con prefetch de fotos.

DECLARACIÓN EXPLÍCITA DE MOVILIDAD (`declarado_movible`, Lotes 22/24/25): es el
checkbox «Declarar como Mueble / Objeto» del editor de espacios.

  REGLA A · NO-True → ARQUITECTURA del espacio (ej. «Escritorio Pintura»,
  «Ropero Empotrado», «Baúl», «Cama Cucheta»): EXCLUIDA DE RAÍZ de toda la
  pantalla de objetos, sin importar su `tipo`. Desde el Lote 25 el default del
  modelo es `False`: NADA se lista si el flag no es explícitamente `True`.

  REGLA B · `True` → declarada movible; se BIFURCA por naturaleza: las CAJAS
  terminales (sin sub-divisiones) van a la SECCIÓN 1 y los MUEBLES MÓVILES /
  espacios contenedores intermedios van a la SECCIÓN 3.
"""

import re

from django.db.models import Q

from ..models import Contenedor, Objeto
from .mudanza_service import q_limbo_de_mudanza
# Predicados ORM del disyuntor de stock: fuente ÚNICA compartida con la mudanza
# masiva (Lote 30). El helper de sub-divisiones se importa con su nombre privado
# histórico para no tocar los sitios de llamada ya existentes del árbol.
from .stock_mudable import (
    qe_estructura_del_espacio,
    qe_tiene_subdivisiones as _tiene_subdivisiones,
)
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

    La MARCA `es_espejo_contenedor` (espejos nuevos) tiene prioridad: sigue
    identificando la dualidad aunque el Contenedor se renombre o el operador
    asigne una Categoría al objeto declarado.
    """
    if objeto_data.get('es_espejo_contenedor'):
        return True
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
    ESTRUCTURAS MÓVILES RAÍZ del Estok (SECCIÓN 3 · filtro ORM estricto).

    Lista SOLO piezas RAÍZ con `es_inmueble=False` que además están DECLARADAS
    movibles por el operador (REGLA A/B del Lote 24) —salvo el RESCATE de
    emergencia del limbo (Lote 28), explicado más abajo— y que son:
      - MUEBLES MÓVILES por tipo (`tipo='MUEBLE_MOVIL'`), o
      - ESPACIOS CONTENEDORES INTERMEDIOS que actúan como mueble: piezas que
        alojan sub-divisiones propias (ej. «Baúl», «Cama Cucheta») aunque su
        tipo inferido sea CAJA.

    Los `tipo='CONJUNTO'` (estructura interna) y `tipo='MUEBLE_INMUEBLE'`
    (muebles fijos) quedan excluidos de raíz (por `parent_contenedor`/fijo).
    El filtro es ORM (no en memoria): PostgreSQL nunca devuelve filas fuera de
    la taxonomía.

    🔒 LOTE 28 · VISIBILIDAD DEL LIMBO. Una estructura mudada entre Estoks
    aterriza RAÍZ SUELTA en la habitación limbo «En Tránsito» (espacio VIRTUAL
    del tablero de mudanzas, NO una habitación del plano). La tenencia se
    resuelve con `q_limbo_de_mudanza` y se agrega el canal de RESCATE: una pieza
    raíz en el limbo se lista aunque NO esté declarada movible, para que el
    operador pueda verla y devolverle el flag. Su contraparte TERMINAL se
    rescata en la SECCIÓN 1 (`cajas_del_estok`): las secciones nunca se
    superponen.
    """
    # TENENCIA: habitación física del Estok activo o limbo de mudanza (raíz).
    tenencia = Q(ubicacion__estok_id=estok_id) | q_limbo_de_mudanza(estok_id)
    # CANAL 1 · declaración explícita del operador (REGLA A).
    declarada = Q(declarado_movible=True) & tenencia
    # CANAL 2 · RESCATE: pieza RAÍZ suelta en el limbo (aunque no se declaró).
    rescate = q_limbo_de_mudanza(estok_id)
    return (
        Contenedor.objects.select_related('ubicacion')
        .filter(parent_contenedor__isnull=True, es_inmueble=False)
        .filter(declarada | rescate)
        # REGLA B: mueble por tipo O espacio contenedor intermedio (con hijos).
        .filter(Q(tipo=TIPO_MUEBLE_MOVIL) | Q(_tiene_subdivisiones()))
        .order_by('ubicacion__nombre', 'nombre')
    )


def cajas_del_estok(estok_id):
    """
    CAJAS DEL ESTOK (SECCIÓN 1 · filtro ORM ÚNICO Y EXCLUSIVO).

    Bultos chicos arrastrables: `tipo='CAJA'`, `es_inmueble=False`,
    `declarado_movible=True` y SIN sub-divisiones propias. A cualquier nivel:
    raíz o guardada dentro de un ropero/archivador.

    🔒 LOTE 28 · VISIBILIDAD DEL LIMBO. Una caja MUDADA entre Estoks aterriza en
    la habitación limbo «En Tránsito» del inquilinato destino (o queda con
    `ubicacion` nula) porque `Contenedor.ubicacion` es NOT NULL, y ese limbo es
    un espacio VIRTUAL del tablero de mudanzas: NO es una habitación física del
    plano. Al resolver la tenencia SOLO por `ubicacion__estok_id`, la pieza
    quedaba fuera del listado —limbo invisible— y era imposible abrir su modal
    de edición para recuperarla. El listado resuelve ahora DOS canales ORM:

      CANAL 1 · caja móvil TERMINAL con tenencia resuelta: habitación física del
      Estok activo o limbo (la definición del limbo vive en
      `mudanza_service.q_limbo_de_mudanza`). Desde el Lote 30 viaja DECLARADA o
      NO —es la liberación del stock interno que quedaba escondido dentro de los
      espacios fijados—; se mantiene la exigencia de bulto TERMINAL (una caja con
      sub-divisiones propias es ESTRUCTURA, no bulto) y se frena la ARQUITECTURA
      DEL ESPACIO (raíz no declarada movible), espejo de `qe_stock_mudable`.

      CANAL 2 · 🔓 RESCATE DE EMERGENCIA: caja RAÍZ suelta y TERMINAL en el
      limbo (`parent_contenedor` nulo, sin sub-divisiones). Entra SIN exigir la
      declaración de movilidad, porque es la ÚNICA vía para que el operador
      vuelva a VERLA y le devuelva el flag `declarado_movible=True` de forma
      voluntaria. Rompe el limbo de invisibilidad que dejó la mudanza (masiva o
      individual): la mudanza valida la whitelist física `es_movible`, no el
      disyuntor de arquitectura, así que una pieza NO declarada también puede
      viajar. Las piezas CON sub-divisiones se rescatan en la SECCIÓN 3
      (`muebles_raiz_del_estok`) para que ninguna sección se superponga.
    """
    # TENENCIA: habitación física del Estok activo o limbo de mudanza (raíz).
    tenencia = Q(ubicacion__estok_id=estok_id) | q_limbo_de_mudanza(estok_id)
    # CANAL 1 · bulto de STOCK TERMINAL con tenencia resuelta (Lote 30): viaja
    # DECLARADO o NO —el operador quiere LIBERAR el stock interno que quedaba
    # escondido dentro de los espacios fijados—, siempre que no sea la
    # ARQUITECTURA DEL ESPACIO (raíz no declarada movible) ni una estructura
    # (una pieza con sub-divisiones propias es mobiliario, no bulto).
    declarada = ~Q(_tiene_subdivisiones()) & tenencia & ~qe_estructura_del_espacio()
    # CANAL 2 · 🔓 RESCATE: caja RAÍZ TERMINAL en el limbo (aunque no se declaró).
    rescate = q_limbo_de_mudanza(estok_id) & ~Q(_tiene_subdivisiones())
    return (
        Contenedor.objects.select_related('ubicacion')
        .filter(tipo=TIPO_CAJA, es_inmueble=False)
        .filter(declarada | rescate)
        .order_by('ubicacion__nombre', 'nombre')
    )


def mapa_padres_del_estok(estok_id):
    """
    Mapa liviano de la jerarquía completa (id → parent_contenedor_id) del Estok:
    permite subir por la cadena de ancestros SIN devolver las sub-divisiones
    internas en el listado. Sirve para reasignar el inventario de una caja que
    vive dentro de una estantería a su Mueble Mayor raíz.

    🔒 Lote 28: la tenencia incluye el LIMBO a cualquier nivel (`exigir_raiz
    =False`), para que los objetos que viajaron DENTRO de una caja mudada
    encuentren su contenedor en el mapa y NO se reporten como «contenedor
    ausente» en la bandeja de sueltos.
    """
    return {
        str(cid): pid
        for cid, pid in Contenedor.objects.filter(
            Q(ubicacion__estok_id=estok_id)
            | q_limbo_de_mudanza(estok_id, exigir_raiz=False),
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

