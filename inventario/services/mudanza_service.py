"""
Servicio de Mudanza Inter-Estok (transferencia hermética entre inquilinatos).

QUÉ SE MUEVE
  Un elemento MÓVIL del inventario (caja, mueble grande o ítem suelto) desde
  el Estok de origen hacia una HABITACIÓN elegida del Estok destino. Los
  espacios fijos (muebles inmuebles, `es_inmueble=True`) NO son mudables: son
  parte estructural de la habitación y nunca entran en la operación.

ZONA «EN TRÁNSITO» (`en_transito=True`)
  El elemento también puede soltarse en el limbo del inquilinato destino: viaja
  al nuevo Estok SIN ubicación física. Los objetos quedan huérfanos
  (`ubicacion=None`, `contenedor=None`) y se resuelven desde la bandeja de
  elementos por ubicar del visor ordinario; los contenedores aterrizan en la
  habitación limbo «En Tránsito» porque `Contenedor.ubicacion` es NOT NULL.

MUTACIÓN ATÓMICA (PostgreSQL)
  La API pública corre dentro de un único `transaction.atomic`: si algo falla
  a mitad de camino, PostgreSQL revierte el bloque completo y ningún Estok
  queda con el inventario partido.

  - CONTENEDOR (mueble grande, archivador o caja móvil):
      1. El NODO RAÍZ se re-ancla al Estok destino: `ubicacion` = habitación
         destino y `parent_contenedor` = contenedor destino (None cuando se
         suelta directamente sobre la habitación). Sus coordenadas de casillero
         se resetean porque eran relativas al plano de ORIGEN.
      2. Toda la descendencia viaja EN BLOQUE Y EN CASCADA: sub-estantes,
         sub-cajas y los objetos de cada casillero conservan su jerarquía
         interna y las coordenadas que ocupaban (la grilla interior del mueble
         viaja tal como estaba armada).
      3. El ESPEJO de dualidad (Contenedor + Objeto) viaja junto al contenedor:
         ambos registros cambian de tenant a la vez.

  - OBJETO:
      1. El nodo raíz pasa al Estok destino con su nueva ubicación/contenedor.
      2. Sus objetos contenidos (`objeto_padre`) viajan con él sin perder el
         vínculo de contención.
      3. PRESERVACIÓN DE LA CAJA DE ORIGEN: si venía dentro de una caja móvil
         («Caja 01»), esa caja se busca o se recrea en el espacio elegido del
         Estok destino y el objeto queda dentro de ella; si la caja es
         arquitectura fija o el objeto viaja en tránsito, su nombre se anota en
         la descripción (services/mudanza_contenedores.py).
      4. RE-VINCULACIÓN DE PROPIETARIOS: dueños/beneficiarios que no son
         miembros del Estok destino se re-anclan a la cuenta homónima del
         inquilinato receptor (services/mudanza_propietarios.py).
"""

from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import ValidationError

from ..models import Contenedor, Objeto, Ubicacion
from .mudanza_contenedores import aviso_preservacion, preservar_contenedor_de_origen
from .mudanza_propietarios import aviso_revinculacion, revincular_propietarios
from .taxonomia_contenedor import es_movible

# Habitación «limbo» del Estok: receptora estática de los elementos que viajan
# SIN ubicación física real (zona «En Tránsito» del tablero de mudanzas).
NOMBRE_LIMBO = 'En Tránsito'
# Nombre histórico del mismo limbo (compatibilidad: no duplicar habitaciones).
NOMBRE_LIMBO_LEGACY = 'Zona de Mudanza'
# Los dos nombres vigentes en un único iterable: lo consumen las consultas ORM
# que necesitan reconocer «esta pieza viajó SIN ubicación física» (canasta de
# «Elementos por ubicar» y árbol de Objetos, Lotes 27/28). Fuente única del
# concepto, junto con su espejo ORM `q_limbo_de_mudanza`.
NOMBRES_LIMBO = (NOMBRE_LIMBO, NOMBRE_LIMBO_LEGACY)


def q_limbo_de_mudanza(estok_id, *, exigir_raiz=True):
    """
    Q ORM de «el CONTENEDOR quedó en el LIMBO de mudanza» (Lote 28).

    Una caja mudada entre Estoks aterriza en la habitación limbo «En Tránsito»
    (o «Zona de Mudanza») con `parent_contenedor` nulo, porque
    `Contenedor.ubicacion` es NOT NULL y la zona de tránsito es un espacio
    VIRTUAL del tablero, no una habitación física del plano. También cubre el
    caso de un contenedor con `ubicacion` nula (registro huérfano del limbo).

    `exigir_raiz=True` (default) exige `parent_contenedor` nulo: es la muda
    RAÍZ suelta que dejó la mudanza. `exigir_raiz=False` reconoce el limbo a
    CUALQUIER nivel de la jerarquía: lo usa el mapa de ancestros del árbol, que
    necesita también la descendencia de una caja mudada.

    AISLAMIENTO MULTI-TENANT: el nombre del limbo solo se acepta si la
    habitación pertenece al Estok activo (limbo real de ese inquilinato) o si
    NO declara Estok (limbo histórico huérfano). El limbo de OTRO Estok jamás
    se filtra con este predicado.

    Es la fuente ÚNICA del concepto en el backend: la consumen el árbol de
    inventario (pestaña Objetos) y el filtro de la canasta de «Elementos por
    ubicar» (`api/viewsets/organizacion/filtros_bandeja.py`).
    """
    en_limbo = Q(
        Q(ubicacion__estok_id=estok_id) | Q(ubicacion__estok__isnull=True),
        ubicacion__nombre__in=NOMBRES_LIMBO,
    )
    if exigir_raiz:
        en_limbo &= Q(parent_contenedor__isnull=True)
    return Q(ubicacion__isnull=True) | en_limbo


def asegurar_ubicacion_limbo(estok_destino):
    """
    Habitación limbo «En Tránsito» del Estok indicado (la crea si no existe).

    Fuente ÚNICA del concepto en el backend: la usan la mudanza individual (un
    elemento) y la migración masiva («Mudar Todo el Stock»). Se reutiliza la
    ubicación ya existente —incluida la histórica «Zona de Mudanza»— para no
    acumular limbos duplicados en el inquilinato.
    """
    ubicacion = Ubicacion.objects.filter(
        nombre=NOMBRE_LIMBO, estok=estok_destino,
    ).first()
    if ubicacion is None:
        ubicacion = Ubicacion.objects.filter(
            nombre=NOMBRE_LIMBO_LEGACY, estok=estok_destino,
        ).first()
    if ubicacion is None:
        ubicacion = Ubicacion.objects.create(
            nombre=NOMBRE_LIMBO,
            estok=estok_destino,
            piso='PLANTA_BAJA',
            grid_filas=1,
            grid_columnas=1,
            grid_colspan=1,
            grid_rowspan=1,
        )
    return ubicacion


def _estok_de_contenedor(contenedor):
    """Estok (tenant) REAL donde vive hoy el contenedor: `ubicacion.estok`."""
    ubicacion = contenedor.ubicacion
    if ubicacion is None or ubicacion.estok_id is None:
        raise ValidationError(
            "El contenedor no tiene un Estok asignado y no se puede mudar."
        )
    return ubicacion.estok


def _rechazar_ciclo(contenedor, nuevo_padre):
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


def _mover_contenedor_recursivo(
    contenedor, estok_destino, ubicacion_destino, nuevo_padre, *,
    es_raiz=False, ids_objetos=None,
):
    """
    Mueve un contenedor y TODA su descendencia al Estok destino.

    Solo el nodo RAÍZ re-ancla su `parent_contenedor` y sus coordenadas de
    grilla (apuntaban al espacio físico de origen). Los descendientes conservan
    el vínculo jerárquico y los casilleros que ocupaban dentro del mueble.

    `ids_objetos` (opcional) acumula los ids de los Objetos transferidos: lo usa
    la mudanza para re-vincular después sus dueños/beneficiarios con cuentas del
    Estok destino.

    Devuelve la cantidad de Objetos transferidos (incluido el espejo).
    """
    contenedor.ubicacion = ubicacion_destino
    if es_raiz:
        contenedor.parent_contenedor = nuevo_padre
        contenedor.parent_grid_row = None
        contenedor.parent_grid_col = None
        campos = [
            'ubicacion', 'parent_contenedor',
            'parent_grid_row', 'parent_grid_col', 'updated_at',
        ]
    else:
        campos = ['ubicacion', 'updated_at']
    contenedor.save(update_fields=campos)

    # Objetos alojados en este contenedor (incluye el espejo de dualidad
    # Contenedor+Objeto): cambian de tenant y de habitación, pero CONSERVAN su
    # casillero interior, porque la grilla interna viaja con el contenedor.
    objetos_alojados = contenedor.objetos.filter(deleted_at__isnull=True)
    objetos_movidos = objetos_alojados.update(
        estok=estok_destino,
        ubicacion=ubicacion_destino,
    )
    if ids_objetos is not None:
        ids_objetos.extend(objetos_alojados.values_list('id', flat=True))

    for sub in contenedor.subcontenedores.all():
        objetos_movidos += _mover_contenedor_recursivo(
            sub, estok_destino, ubicacion_destino, None, es_raiz=False,
            ids_objetos=ids_objetos,
        )

    return objetos_movidos


def _mover_objeto_recursivo(
    objeto, estok_destino, ubicacion_destino, contenedor_destino, *,
    es_raiz=False, en_transito=False, ids_objetos=None,
):
    """
    Mueve un Objeto y sus objetos contenidos (`objeto_padre`) al Estok destino.

    Solo el nodo RAÍZ re-ancla su contenedor/ubicación y resetea sus
    coordenadas de casillero; los hijos conservan su vínculo de contención.

    Con `en_transito=True` (suelta en la zona «En Tránsito») NINGÚN nodo
    conserva ubicación física: `ubicacion=None` y `contenedor=None`. El objeto
    entra al limbo del inquilinato destino (bandeja «A primera vista · sin
    ubicación» del visor ordinario) hasta que el usuario decida dónde encajarlo.

    `ids_objetos` (opcional) acumula los ids transferidos para la re-vinculación
    de dueños/beneficiarios que corre al cierre de la mudanza.

    Devuelve la cantidad de Objetos transferidos (raíz incluida).
    """
    objeto.estok = estok_destino
    objeto.ubicacion = None if en_transito else ubicacion_destino
    campos = ['estok', 'ubicacion', 'updated_at']
    if es_raiz:
        objeto.contenedor = None if en_transito else contenedor_destino
        objeto.parent_grid_row = None
        objeto.parent_grid_col = None
        campos += ['contenedor', 'parent_grid_row', 'parent_grid_col']
    objeto.save(update_fields=campos)

    total = 1
    if ids_objetos is not None:
        ids_objetos.append(objeto.id)
    for hijo in objeto.objetos_contenidos.filter(deleted_at__isnull=True):
        total += _mover_objeto_recursivo(
            hijo, estok_destino, ubicacion_destino, None,
            es_raiz=False, en_transito=en_transito, ids_objetos=ids_objetos,
        )
    return total

class MudanzaService:
    """API pública del servicio de mudanza (las validaciones de membresía
    y pertenencia de los destinos al Estok destino corren en la vista)."""

    @staticmethod
    @transaction.atomic
    def transferir_contenedor(
        contenedor, estok_destino, ubicacion_destino, contenedor_destino=None,
        *, en_transito=False,
    ):
        """
        Transfiere un elemento móvil de tipo contenedor (mueble grande,
        archivador o caja) junto con TODO su contenido, en cascada y dentro de
        una sola transacción. La habitación destino reemplaza al espacio de
        origen como nodo padre (`ubicacion`) y el `parent_contenedor` se
        re-ancla al contenedor destino cuando se suelta dentro de otro mueble.

        Con `en_transito=True` el contenedor queda en el limbo del Estok
        destino: `parent_contenedor=None` (raíz suelta) dentro de la habitación
        limbo «En Tránsito» recibida como `ubicacion_destino`, porque
        `Contenedor.ubicacion` es NOT NULL (un contenedor SIEMPRE pertenece a un
        espacio del inquilinato). Su contenido interno viaja intacto.

        REGLA DE FÍSICA: la mudanza cruzada admite EXCLUSIVAMENTE elementos
        movibles (CAJA, OBJETO, MUEBLE_MOVIL). Los tipos ANCLADOS (CONJUNTO,
        MUEBLE_INMUEBLE) se rechazan con HTTP 400: son estructura de su cuarto
        de origen.
        """
        if not es_movible(contenedor):
            raise ValidationError(
                "«%s» no es un elemento movible (tipo %s): la mudanza entre "
                "Estoks sólo admite CAJA, OBJETO y MUEBLE_MOVIL."
                % (contenedor.nombre, contenedor.tipo)
            )

        estok_origen = _estok_de_contenedor(contenedor)
        if str(estok_origen.id) == str(estok_destino.id):
            raise ValidationError("El contenedor ya pertenece al Estok destino.")

        if contenedor_destino is not None:
            if str(contenedor_destino.id) == str(contenedor.id):
                raise ValidationError("Un contenedor no puede ser su propio contenedor padre.")
            _rechazar_ciclo(contenedor, contenedor_destino)

        ids_movidos = []
        objetos_movidos = _mover_contenedor_recursivo(
            contenedor, estok_destino, ubicacion_destino,
            contenedor_destino, es_raiz=True, ids_objetos=ids_movidos,
        )
        # Re-vinculación: los dueños/beneficiarios que no pertenecen al Estok
        # destino se re-anclan a la cuenta homónima del inquilinato receptor.
        revinculacion = revincular_propietarios(
            estok_destino, Objeto.objects.filter(id__in=ids_movidos),
        )

        if en_transito:
            mensaje = (
                f'«{contenedor.nombre}» quedó EN TRÁNSITO en «{estok_destino.nombre}» '
                f'(habitación limbo «{ubicacion_destino.nombre}»): su contenido viaja intacto.'
            )
        else:
            mensaje = f'«{contenedor.nombre}» y su contenido migraron a «{estok_destino.nombre}».'
        mensaje += aviso_revinculacion(revinculacion)

        return {
            'mensaje': mensaje,
            'tipo': 'contenedor',
            'contenedor_id': str(contenedor.id),
            'contenedor_nombre': contenedor.nombre,
            'estok_origen_id': str(estok_origen.id),
            'estok_destino_id': str(estok_destino.id),
            'estok_destino_nombre': estok_destino.nombre,
            'objetos_movidos': objetos_movidos,
            'revinculacion': revinculacion,
            'en_transito': bool(en_transito),
        }

    @staticmethod
    @transaction.atomic
    def transferir_objeto(
        objeto, estok_destino, ubicacion_destino=None, contenedor_destino=None,
        *, en_transito=False,
    ):
        """
        Transfiere un objeto móvil (suelto o con objetos dentro) al Estok
        destino, re-anclando su ubicación/contenedor a la habitación elegida.

        Con `en_transito=True` el objeto viaja al Estok destino SIN ubicación
        física (`ubicacion=None`, `contenedor=None`): queda huérfano en el limbo
        del nuevo inquilinato y se gestiona desde la bandeja de elementos por
        ubicar del visor ordinario.

        PRESERVACIÓN DEL CONTENEDOR DE ORIGEN («Caja 01»): si el objeto venía
        dentro de una caja móvil, esa caja se busca o se recrea en el espacio
        elegido del Estok destino y el objeto queda dentro de ella. Cuando la
        caja es arquitectura fija del Estok de origen —o el objeto viaja en
        tránsito— su nombre se anota en la descripción del objeto para no perder
        la referencia (ver services/mudanza_contenedores.py).
        """
        if objeto.estok_id and str(objeto.estok_id) == str(estok_destino.id):
            raise ValidationError("El objeto ya pertenece al Estok destino.")

        # Contexto de ORIGEN (lecturas ANTES de cualquier mutación): la caja que
        # alojaba el objeto y el nombre del Estok del que sale.
        contenedor_origen = objeto.contenedor if objeto.contenedor_id else None
        estok_origen = objeto.estok or (
            objeto.ubicacion.estok if objeto.ubicacion_id else None
        )
        estok_origen_nombre = estok_origen.nombre if estok_origen else ''

        ids_movidos = []
        total_movidos = _mover_objeto_recursivo(
            objeto, estok_destino, ubicacion_destino,
            contenedor_destino, es_raiz=True, en_transito=en_transito,
            ids_objetos=ids_movidos,
        )

        preservacion = preservar_contenedor_de_origen(
            objeto, contenedor_origen, estok_destino, ubicacion_destino,
            contenedor_destino, en_transito=en_transito,
            estok_origen_nombre=estok_origen_nombre,
        )
        revinculacion = revincular_propietarios(
            estok_destino, Objeto.objects.filter(id__in=ids_movidos),
        )

        if en_transito:
            mensaje = (
                f'«{objeto.nombre}» quedó EN TRÁNSITO dentro de «{estok_destino.nombre}»: '
                'sin ubicación física, listo para ubicar desde Almacenamiento.'
            )
        else:
            mensaje = f'«{objeto.nombre}» migró a «{estok_destino.nombre}».'
        mensaje += aviso_preservacion(preservacion) + aviso_revinculacion(revinculacion)

        return {
            'mensaje': mensaje,
            'tipo': 'objeto',
            'objeto_id': str(objeto.id),
            'objeto_nombre': objeto.nombre,
            'estok_destino_id': str(estok_destino.id),
            'estok_destino_nombre': estok_destino.nombre,
            'objetos_movidos': total_movidos,
            'contenedor_origen': preservacion,
            'revinculacion': revinculacion,
            'en_transito': bool(en_transito),
        }

