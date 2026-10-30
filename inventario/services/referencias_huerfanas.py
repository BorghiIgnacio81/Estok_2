"""
REFERENCIAS HUÉRFANAS ENTRE ESTOKS (objetos que apuntan a cajas inexistentes).

CONTEXTO (mudanza entre Estoks)
  `Objeto.contenedor` es un FK con `on_delete=SET_NULL`, así que borrar una caja
  nunca deja una referencia rota. El problema aparece con la MUDANZA: un objeto
  puede quedar con `estok` del inquilinato DESTINO y `contenedor_id` apuntando a
  una pieza que vive en el árbol del Estok ORIGEN (o en una habitación que ya no
  pertenece al inquilinato). Esa caja existe en PostgreSQL pero es INALCANZABLE
  desde el Estok activo:

    · `Contenedor` no tiene FK propia a Estok: pertenece al inquilinato vía
      `ubicacion.estok` (y, jerárquicamente, vía `parent_contenedor`).
    · Por eso un objeto así no aparece en el árbol de Almacenamiento, tampoco
      dentro de ninguna caja, y la canasta lo ignora porque su `ubicacion` no es
      nula: queda invisible, imposible de reubicar (p. ej. los 4 libros
      «Anne…» después de la mudanza).

REGLA ÚNICA
  Un objeto está HUÉRFANO POR CONTENEDOR cuando su caja no es ALCANZABLE dentro
  del Estok de referencia (el de `objeto.estok`; si faltara, el de su ubicación):

    `contenedor.ubicacion.estok` nulo  → NO se juzga (legacy sin tenant).
    `contenedor.ubicacion.estok` ajeno → huérfano.
    padre jerárquico ajeno            → huérfano (el subárbol no se dibuja).

  El consumidor es la canasta «🧺 Elementos por ubicar» (`?bandeja=true`), que
  suma estos objetos a los recuperables para que el operador los vea y los pueda
  arrastrar a una caja/espacio activo. `sanear_referencias_huerfanas` limpia la
  referencia en la base (y el casillero fino) cuando además se quiere persistir la
  corrección.
"""

from django.db.models import Q

from ..models import Objeto
from .mudanza_service import NOMBRES_LIMBO


def q_contenedor_ajeno_al_estok(estok_id):
    """
    Q ORM: el Objeto cuelga de un Contenedor INALCANZABLE en el Estok indicado.

    Se usa SELECT_related-friendly (sin subqueries) para poder combinarse con el
    resto de los filtros de `?bandeja=true`. Sin `estok_id` devuelve un Q vacío:
    jamás se marca un huérfano sin tenant de referencia.
    """
    if not estok_id:
        return Q(pk__in=[])
    return Q(contenedor__isnull=False) & (
        (
            Q(contenedor__ubicacion__estok__isnull=False)
            & ~Q(contenedor__ubicacion__estok_id=estok_id)
        )
        | (
            Q(contenedor__parent_contenedor__isnull=False)
            & Q(contenedor__parent_contenedor__ubicacion__estok__isnull=False)
            & ~Q(contenedor__parent_contenedor__ubicacion__estok_id=estok_id)
        )
    )


def q_objetos_en_contenedor_limbo(estok_id):
    """
    Q ORM: el Objeto vive dentro de una CAJA que está en el LIMBO de mudanza.

    La caja existe y sigue siendo válida, pero el limbo («En Tránsito» / «Zona de
    Mudanza») es un espacio VIRTUAL de sistema que el motor de portales NO dibuja:
    ninguna habitación del plano la lista, así que su contenido queda inalcanzable
    para el operador hasta que la caja se reubique. Con este canal los objetos
    vuelven a la canasta para poder asignarlos a la «Caja 01» nueva o a cualquier
    espacio activo. Acotado al Estok activo (limbo del inquilinato o legado sin
    tenant) para no filtrar el limbo de otro Estok.
    """
    if not estok_id:
        return Q(pk__in=[])
    return (
        Q(contenedor__isnull=False)
        & Q(contenedor__ubicacion__nombre__in=NOMBRES_LIMBO)
        & (
            Q(contenedor__ubicacion__estok_id=estok_id)
            | Q(contenedor__ubicacion__estok__isnull=True)
        )
    )


def _estok_de_referencia(objeto):
    """Estok con el que se juzga la referencia espacial de un objeto."""
    if objeto.estok_id:
        return objeto.estok_id
    if objeto.ubicacion_id:
        return objeto.ubicacion.estok_id
    return None


def _contenedor_alcanzable(contenedor, estok_id, profundidad=0):
    """
    ¿La caja se dibuja dentro del árbol del Estok indicado?

    Primero su propia habitación (el árbol se filtra por `ubicacion__estok_id`) y
    después la cadena de padres jerárquicos: una sub-caja cuelga de un mueble y
    hereda su espacio. Tope de profundidad 10 contra ciclos corruptos.
    """
    if contenedor is None or not estok_id:
        return False
    if contenedor.ubicacion_id and contenedor.ubicacion.estok_id != estok_id:
        return False
    if not contenedor.ubicacion_id:
        return False
    padre = contenedor.parent_contenedor
    if padre is None:
        return True
    if profundidad >= 10:
        return False
    return _contenedor_alcanzable(padre, estok_id, profundidad + 1)


def objetos_con_contenedor_ajeno(estok_id=None):
    """
    QuerySet de objetos cuya caja pertenece a otro inquilinato (o a ninguno).

    `estok_id` opcional acota el barrido a un Estok; sin él se revisan todos los
    objetos y cada uno se juzga contra SU propio Estok (uso del management
    command de saneamiento).
    """
    qs = (
        Objeto.objects.filter(contenedor__isnull=False)
        .select_related('contenedor', 'contenedor__ubicacion', 'contenedor__parent_contenedor', 'ubicacion')
        .order_by('estok_id', 'nombre')
    )
    if estok_id:
        qs = qs.filter(estok_id=estok_id)
    for objeto in qs.iterator():
        referencia = estok_id or _estok_de_referencia(objeto)
        if not referencia:
            continue
        if objeto.contenedor.ubicacion.estok_id is None:
            # Pieza legacy sin tenant: no se puede juzgar (no se toca).
            continue
        if not _contenedor_alcanzable(objeto.contenedor, referencia):
            yield objeto


def sanear_referencias_huerfanas(*, estok_id=None, dry_run=True):
    """
    Limpia `contenedor` (+ casillero fino) de los objetos huérfanos por mudanza.

    Devuelve el reporte `[{'id', 'nombre', 'contenedor_id', 'contenedor_nombre',
    'estok_id'}]` con lo que se limpió (o se limpiaría, en `dry_run`). NO borra
    objetos ni contenedores: sólo libera la referencia inalcanzable para que el
    bulto vuelva a la bandeja de «Objetos huérfanos a reubicar».
    """
    reporte = []
    for objeto in objetos_con_contenedor_ajeno(estok_id):
        reporte.append({
            'id': str(objeto.id),
            'nombre': objeto.nombre,
            'contenedor_id': str(objeto.contenedor_id),
            'contenedor_nombre': objeto.contenedor.nombre,
            'estok_id': str(objeto.estok_id) if objeto.estok_id else None,
        })
        if dry_run:
            continue
        Objeto.objects.filter(pk=objeto.pk).update(
            contenedor=None,
            parent_grid_row=None,
            parent_grid_col=None,
        )
    return reporte
