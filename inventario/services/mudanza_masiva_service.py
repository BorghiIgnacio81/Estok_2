"""
Migración MASIVA de stock entre Estoks («🚚 Mudar Todo el Stock»).

QUÉ HACE
  Transfiere EN BLOQUE todo el inventario MÓVIL del Estok origen —cajas móviles,
  muebles mudables y objetos individuales sueltos— hacia el Estok destino, dentro
  de UNA sola transacción.

ALCANCE: STOCK MÓVIL CON DISYUNTOR ESTRICTO (Lote 30)
  Viaja TODO el stock: las CAJAS TERMINALES (`tipo='CAJA'`, `es_inmueble=False`,
  sin sub-divisiones propias) declaradas o NO —es la liberación del inventario
  que quedaba escondido dentro de los espacios fijados—, las ESTRUCTURAS
  DECLARADAS (`declarado_movible=True` sobre un mueble o una pieza con
  sub-divisiones propias) y TODOS los objetos del origen.
  Queda INTACTA en el origen la ESTRUCTURA: el espacio base (raíz no declarada
  movible) y el mobiliario con sub-divisiones propias («Ropero Empotrado»,
  «Escritorio Pintura»…). El freno alcanza al NODO, nunca al stock que aloja: lo
  que vive adentro viaja en cascada. El resumen informa cuántas estructuras
  quedaron atrás (`arquitectura_intacta`).

LÓGICA «EN TRÁNSITO»
  Los elementos NO se anclan al plano del inquilinato destino: viajan sin
  coordenadas ni relaciones heredadas del origen y quedan pendientes de ubicar.
  El proyecto NO define una columna `en_transito`; el estado «en tránsito» es la
  FÍSICA de los datos:
    · OBJETOS      → `ubicacion = None` y `contenedor = None` (limbo del Estok
                     destino: bandeja «A primera vista · sin ubicación»).
    · CONTENEDORES → aterrizan en la habitación limbo «En Tránsito» del destino
                     (`Contenedor.ubicacion` es NOT NULL) con `parent_contenedor
                     = None` y casilleros reseteados.
  En ambos casos la bandera nativa `en_transito_interno` se APAGA (`False`):
  ningún elemento queda pendiente de un estante fino dentro de un mueble.

PURGA DE ESTRUCTURAS OBSOLETAS
  Los ids que llegan en `excluir_ids` —los ítems que el operador DESTILDÓ o marcó
  con «Eliminar de la mudanza» en el modal— NO viajan: se destruyen FÍSICAMENTE
  (`QuerySet.delete()`, que hace SQL DELETE y no el soft delete del modelo) para
  limpiar la basura arquitectónica de la Fase 3 («Espacio 1», «Estantería
  C1-A1», etc.). La purga se acota SIEMPRE al Estok origen (multi-tenant).

RE-VINCULACIÓN DE PROPIETARIOS
  Los objetos que cambian de inquilinato pueden quedar apuntando a dueños o
  beneficiarios que NO son miembros del Estok destino: al cerrar la migración se
  re-anclan a la cuenta homónima del destino (fuente única:
  `services/mudanza_propietarios.py`, compartida con la mudanza individual).
"""

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from ..models import Contenedor, Objeto
from .mudanza_propietarios import aviso_revinculacion, revincular_propietarios
from .mudanza_service import asegurar_ubicacion_limbo
from .stock_mudable import qe_stock_mudable


def _descendencia_contenedores(ids_raiz):
    """
    Ids de TODOS los contenedores del subárbol (raíces incluidas).

    La descendencia (estantes / divisiones internas) viaja en CASCADA con su
    mueble raíz. Se recorre por NIVELES (BFS) con una consulta por nivel, evitando
    el N+1 de un recorrido recursivo objeto por objeto. Todo se normaliza a
    `str` para comparar de forma homogénea entre niveles.
    """
    todos = {str(i) for i in ids_raiz}
    frontera = list(todos)
    while frontera:
        hijos = {
            str(i) for i in Contenedor.objects
            .filter(parent_contenedor_id__in=frontera)
            .values_list('id', flat=True)
        }
        frontera = list(hijos - todos)
        todos |= hijos
    return todos


class MudanzaMasivaService:
    """Migración en bloque del stock móvil entre dos Estoks (100% atómica)."""

    @staticmethod
    @transaction.atomic
    def mudar_todo(estok_origen, estok_destino, excluir_ids=None):
        """
        Mueve todo el inventario móvil del origen al destino «en tránsito» y
        purga físicamente los ids excluidos. Devuelve el resumen de la operación.

        `excluir_ids` acepta UUIDs o strings; se normalizan a `str` para
        compararlos con los ids de la base en todas las consultas.
        """
        excluidos = {str(i) for i in (excluir_ids or [])}
        ahora = timezone.now()
        ubicacion_limbo = asegurar_ubicacion_limbo(estok_destino)

        # ------------------------------------------------------------------
        # 1) CONJUNTOS A MOVER (lecturas ANTES de cualquier mutación)
        # ------------------------------------------------------------------
        # 🔓 LOTE 30 · DISYUNTOR ESTRICTO (Catálogo ↔ Mudanzas). Se recorre TODO
        # el Estok —no sólo las raíces— y se recoge el stock mudable esté al
        # nivel que esté: CAJAS TERMINALES (declaradas o no) y ESTRUCTURAS
        # DECLARADAS. La estructura del espacio (raíz no declarada) y el
        # mobiliario con sub-divisiones propias quedan intactos, pero su stock
        # interno VIAJA IGUAL en cascada: el inventario nunca se pierde.
        semillas = {
            str(i) for i in Contenedor.objects
            .filter(ubicacion__estok=estok_origen)
            .filter(qe_stock_mudable())
            .values_list('id', flat=True)
        }

        # CASCADA: cada semilla arrastra TODO su subárbol (estantes, divisiones y
        # los objetos de cada casillero) sin importar cómo esté armado adentro.
        arbol_cont = _descendencia_contenedores(semillas)
        # El subárbol de cada EXCLUSIÓN se retira en bloque: destildar un bulto en
        # el modal sigue excluyendo también su contenido interno.
        arbol_cont -= _descendencia_contenedores(excluidos)
        arbol_cont -= excluidos

        # RAÍCES DE TRASLADO: piezas que viajan y cuyo PADRE no viaja (o no
        # tiene). Son las ÚNICAS que se sueltan del plano de origen y resetean sus
        # casilleros. Sin este cálculo, una caja extraída de un espacio fijado
        # quedaría colgando de un padre que SE QUEDA en el origen (FK cruzada
        # entre Estoks). Reemplaza el `raices_cont` rígido del Lote 27.
        padres_movidos = {
            str(cid): (str(pid) if pid else None)
            for cid, pid in Contenedor.objects.filter(id__in=arbol_cont)
            .values_list('id', 'parent_contenedor_id')
        }
        raices_cont = {
            cid for cid, pid in padres_movidos.items()
            if pid is None or pid not in arbol_cont
        }

        # AUDITORÍA del freno: ESTRUCTURAS RAÍZ que quedaron intactas en el
        # origen (habitaciones, «Espacio N» y mobiliario fijo sin declarar). Su
        # stock interno SÍ viajó: la estructura se queda, el inventario no.
        arquitectura_intacta = (
            Contenedor.objects
            .filter(ubicacion__estok=estok_origen, parent_contenedor__isnull=True)
            .exclude(id__in=arbol_cont)
            .count()
        )

        # Objetos LIBERADOS del origen: TODO el stock de objetos activos que NO
        # cuelga de un contenedor que viaja —sueltos o anidados dentro de una
        # estructura fijada que se queda—. Se incluyen los huérfanos de FK `estok`
        # que sí cuelgan de una habitación del inquilinato. Los objetos que viven
        # dentro de una pieza que SÍ viaja se mueven con ella en cascada (paso 3).
        raices_obj = {
            str(i) for i in Objeto.objects.filter(
                Q(estok=estok_origen)
                | Q(estok__isnull=True, ubicacion__estok=estok_origen),
                deleted_at__isnull=True,
            ).exclude(contenedor_id__in=arbol_cont).values_list('id', flat=True)
        } - excluidos

        # ------------------------------------------------------------------
        # 2) OBJETOS LIBERADOS → limbo del destino (sin ubicación física)
        # ------------------------------------------------------------------
        # Sueltos, o sacados de una estructura que se queda: pierden TODO vínculo
        # con el origen y quedan pendientes de ubicar en el inquilinato destino.
        objetos_movidos = 0
        if raices_obj:
            objetos_movidos += Objeto.objects.filter(id__in=raices_obj).update(
                estok=estok_destino,
                ubicacion=None,
                contenedor=None,
                parent_grid_row=None,
                parent_grid_col=None,
                en_transito_interno=False,
                updated_at=ahora,
            )

        # ------------------------------------------------------------------
        # 3) CONTENEDORES → habitación limbo «En Tránsito» del destino
        # ------------------------------------------------------------------
        contenedores_movidos = 0
        ids_en_contenedores = set()
        if arbol_cont:
            contenedores_movidos = Contenedor.objects.filter(
                id__in=arbol_cont,
            ).update(
                ubicacion=ubicacion_limbo,
                en_transito_interno=False,
                updated_at=ahora,
            )
            # Sólo las RAÍCES se sueltan del plano de origen y resetean sus
            # casilleros; la descendencia conserva su jerarquía interna.
            if raices_cont:
                Contenedor.objects.filter(id__in=raices_cont).update(
                    parent_contenedor=None,
                    parent_grid_row=None,
                    parent_grid_col=None,
                    updated_at=ahora,
                )
            # El contenido de cada mueble viaja con él: cambia de tenant y
            # aterriza en la misma habitación limbo, conservando su casillero.
            ids_en_contenedores = {
                str(i) for i in Objeto.objects.filter(
                    contenedor_id__in=arbol_cont, deleted_at__isnull=True,
                ).values_list('id', flat=True)
            }
            objetos_movidos += Objeto.objects.filter(
                id__in=ids_en_contenedores,
            ).update(
                estok=estok_destino,
                ubicacion=ubicacion_limbo,
                en_transito_interno=False,
                updated_at=ahora,
            )

        # ------------------------------------------------------------------
        # 3 bis) RE-VINCULACIÓN de dueños/beneficiarios con el Estok destino
        # ------------------------------------------------------------------
        # Los objetos que cambian de inquilinato pueden quedar apuntando a
        # cuentas que no pertenecen al Estok destino: se re-anclan a la cuenta
        # homónima del destino (ver services/mudanza_propietarios.py).
        revinculacion = revincular_propietarios(
            estok_destino,
            Objeto.objects.filter(id__in=set(raices_obj) | ids_en_contenedores),
        )

        # ------------------------------------------------------------------
        # 4) PURGA FÍSICA de la basura arquitectónica (acotada al origen)
        # ------------------------------------------------------------------
        basura_objetos = Objeto.objects.filter(id__in=excluidos).filter(
            Q(estok=estok_origen) | Q(ubicacion__estok=estok_origen)
        )
        objetos_purgados = basura_objetos.count()
        basura_objetos.delete()  # QuerySet.delete → borrado FÍSICO real

        basura_contenedores = Contenedor.objects.filter(
            id__in=excluidos, ubicacion__estok=estok_origen,
        )
        contenedores_purgados = basura_contenedores.count()
        basura_contenedores.delete()

        total_purgado = objetos_purgados + contenedores_purgados
        if contenedores_movidos == 0 and objetos_movidos == 0 and total_purgado == 0:
            raise ValidationError(
                "El Estok origen no tiene inventario móvil para mudar."
            )

        sufijo = (
            f' Se purgaron además {total_purgado} registro(s) obsoleto(s) del origen.'
            if total_purgado else ''
        )
        aviso_arquitectura = (
            f' {arquitectura_intacta} estructura(s) del espacio quedaron '
            f'intactas en el origen: su stock interno viajó igual en cascada.'
            if arquitectura_intacta else ''
        )
        mensaje = (
            f'🚚 Mudanza general completada: {contenedores_movidos} contenedor(es) y '
            f'{objetos_movidos} objeto(s) viajaron EN TRÁNSITO a «{estok_destino.nombre}».'
            f'{aviso_arquitectura}{sufijo}{aviso_revinculacion(revinculacion)}'
        )

        return {
            'mensaje': mensaje,
            'estok_origen_id': str(estok_origen.id),
            'estok_destino_id': str(estok_destino.id),
            'estok_destino_nombre': estok_destino.nombre,
            'contenedores_movidos': contenedores_movidos,
            'objetos_movidos': objetos_movidos,
            'arquitectura_intacta': arquitectura_intacta,
            'objetos_purgados': objetos_purgados,
            'contenedores_purgados': contenedores_purgados,
            'total_purgado': total_purgado,
            'revinculacion': revinculacion,
        }

