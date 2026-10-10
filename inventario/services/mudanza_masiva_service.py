"""
Migración MASIVA de stock entre Estoks («🚚 Mudar Todo el Stock»).

QUÉ HACE
  Transfiere EN BLOQUE todo el inventario MÓVIL del Estok origen —cajas móviles,
  muebles mudables y objetos individuales sueltos— hacia el Estok destino, dentro
  de UNA sola transacción.

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
"""

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from ..models import Contenedor, Objeto
from .mudanza_service import asegurar_ubicacion_limbo
from .taxonomia_contenedor import TIPO_CAJA, TIPO_MUEBLE_MOVIL

# Tipos de contenedor que entran en la migración masiva: cajas móviles y muebles
# mudables. Los anclados (CONJUNTO, MUEBLE_INMUEBLE) NUNCA se mudan solos: su
# descendencia viaja en cascada con el mueble raíz que los aloja.
TIPOS_MUDABLES = (TIPO_CAJA, TIPO_MUEBLE_MOVIL)


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


def _descendencia_objetos(ids_raiz):
    """Ids de los objetos RAÍZ más todos sus objetos contenidos (BFS por nivel)."""
    todos = {str(i) for i in ids_raiz}
    frontera = list(todos)
    while frontera:
        hijos = {
            str(i) for i in Objeto.objects
            .filter(objeto_padre_id__in=frontera)
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
        # Contenedores RAÍZ móviles del origen + su descendencia en cascada.
        raices_cont = {
            str(i) for i in Contenedor.objects.filter(
                ubicacion__estok=estok_origen,
                parent_contenedor__isnull=True,
                es_inmueble=False,
                tipo__in=TIPOS_MUDABLES,
            ).values_list('id', flat=True)
        } - excluidos
        arbol_cont = _descendencia_contenedores(raices_cont) - excluidos

        # Objetos SUELTOS del origen (sin caja y sin objeto padre). Se incluyen
        # los huérfanos de FK `estok` que sí cuelgan de una habitación del
        # inquilinato: son los mismos que lista la columna Origen del tablero.
        raices_obj = {
            str(i) for i in Objeto.objects.filter(
                Q(estok=estok_origen)
                | Q(estok__isnull=True, ubicacion__estok=estok_origen),
                deleted_at__isnull=True,
                contenedor__isnull=True,
                objeto_padre__isnull=True,
            ).values_list('id', flat=True)
        } - excluidos
        arbol_obj = _descendencia_objetos(raices_obj) - excluidos

        # ------------------------------------------------------------------
        # 2) OBJETOS SUELTOS → limbo del destino (sin ubicación física)
        # ------------------------------------------------------------------
        objetos_movidos = 0
        if arbol_obj:
            objetos_movidos += Objeto.objects.filter(id__in=arbol_obj).update(
                estok=estok_destino,
                ubicacion=None,
                en_transito_interno=False,
                updated_at=ahora,
            )
        if raices_obj:
            Objeto.objects.filter(id__in=raices_obj).update(
                contenedor=None,
                parent_grid_row=None,
                parent_grid_col=None,
                updated_at=ahora,
            )

        # ------------------------------------------------------------------
        # 3) CONTENEDORES → habitación limbo «En Tránsito» del destino
        # ------------------------------------------------------------------
        contenedores_movidos = 0
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
            objetos_movidos += Objeto.objects.filter(
                contenedor_id__in=arbol_cont, deleted_at__isnull=True,
            ).update(
                estok=estok_destino,
                ubicacion=ubicacion_limbo,
                en_transito_interno=False,
                updated_at=ahora,
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
        mensaje = (
            f'🚚 Mudanza general completada: {contenedores_movidos} contenedor(es) y '
            f'{objetos_movidos} objeto(s) viajaron EN TRÁNSITO a «{estok_destino.nombre}».'
            f'{sufijo}'
        )

        return {
            'mensaje': mensaje,
            'estok_origen_id': str(estok_origen.id),
            'estok_destino_id': str(estok_destino.id),
            'estok_destino_nombre': estok_destino.nombre,
            'contenedores_movidos': contenedores_movidos,
            'objetos_movidos': objetos_movidos,
            'objetos_purgados': objetos_purgados,
            'contenedores_purgados': contenedores_purgados,
            'total_purgado': total_purgado,
        }

