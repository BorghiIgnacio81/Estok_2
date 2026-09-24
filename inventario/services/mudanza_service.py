"""
Servicio de Mudanza Inter-Estok (transferencia hermética entre inquilinatos).

QUÉ SE MUEVE
  Un elemento MÓVIL del inventario (caja, mueble grande o ítem suelto) desde
  el Estok de origen hacia una HABITACIÓN elegida del Estok destino. Los
  espacios fijos (muebles inmuebles, `es_inmueble=True`) NO son mudables: son
  parte estructural de la habitación y nunca entran en la operación.

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
"""

from django.db import transaction
from rest_framework.exceptions import ValidationError

from ..models import Contenedor, Objeto


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


def _mover_contenedor_recursivo(contenedor, estok_destino, ubicacion_destino, nuevo_padre, *, es_raiz=False):
    """
    Mueve un contenedor y TODA su descendencia al Estok destino.

    Solo el nodo RAÍZ re-ancla su `parent_contenedor` y sus coordenadas de
    grilla (apuntaban al espacio físico de origen). Los descendientes conservan
    el vínculo jerárquico y los casilleros que ocupaban dentro del mueble.

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
    objetos_movidos = contenedor.objetos.filter(deleted_at__isnull=True).update(
        estok=estok_destino,
        ubicacion=ubicacion_destino,
    )

    for sub in contenedor.subcontenedores.all():
        objetos_movidos += _mover_contenedor_recursivo(
            sub, estok_destino, ubicacion_destino, None, es_raiz=False,
        )

    return objetos_movidos


def _mover_objeto_recursivo(objeto, estok_destino, ubicacion_destino, contenedor_destino, *, es_raiz=False):
    """
    Mueve un Objeto y sus objetos contenidos (`objeto_padre`) al Estok destino.

    Solo el nodo RAÍZ re-ancla su contenedor/ubicación y resetea sus
    coordenadas de casillero; los hijos conservan su vínculo de contención.

    Devuelve la cantidad de Objetos transferidos (raíz incluida).
    """
    objeto.estok = estok_destino
    objeto.ubicacion = ubicacion_destino
    campos = ['estok', 'ubicacion', 'updated_at']
    if es_raiz:
        objeto.contenedor = contenedor_destino
        objeto.parent_grid_row = None
        objeto.parent_grid_col = None
        campos += ['contenedor', 'parent_grid_row', 'parent_grid_col']
    objeto.save(update_fields=campos)

    total = 1
    for hijo in objeto.objetos_contenidos.filter(deleted_at__isnull=True):
        total += _mover_objeto_recursivo(
            hijo, estok_destino, ubicacion_destino, None, es_raiz=False,
        )
    return total

class MudanzaService:
    """API pública del servicio de mudanza (las validaciones de membresía
    y pertenencia de los destinos al Estok destino corren en la vista)."""

    @staticmethod
    @transaction.atomic
    def transferir_contenedor(contenedor, estok_destino, ubicacion_destino, contenedor_destino=None):
        """
        Transfiere un elemento móvil de tipo contenedor (mueble grande,
        archivador o caja) junto con TODO su contenido, en cascada y dentro de
        una sola transacción. La habitación destino reemplaza al espacio de
        origen como nodo padre (`ubicacion`) y el `parent_contenedor` se
        re-ancla al contenedor destino cuando se suelta dentro de otro mueble.
        """
        estok_origen = _estok_de_contenedor(contenedor)
        if str(estok_origen.id) == str(estok_destino.id):
            raise ValidationError("El contenedor ya pertenece al Estok destino.")

        if contenedor_destino is not None:
            if str(contenedor_destino.id) == str(contenedor.id):
                raise ValidationError("Un contenedor no puede ser su propio contenedor padre.")
            _rechazar_ciclo(contenedor, contenedor_destino)

        objetos_movidos = _mover_contenedor_recursivo(
            contenedor, estok_destino, ubicacion_destino,
            contenedor_destino, es_raiz=True,
        )

        return {
            'mensaje': f'«{contenedor.nombre}» y su contenido migraron a «{estok_destino.nombre}».',
            'tipo': 'contenedor',
            'contenedor_id': str(contenedor.id),
            'contenedor_nombre': contenedor.nombre,
            'estok_origen_id': str(estok_origen.id),
            'estok_destino_id': str(estok_destino.id),
            'estok_destino_nombre': estok_destino.nombre,
            'objetos_movidos': objetos_movidos,
        }

    @staticmethod
    @transaction.atomic
    def transferir_objeto(objeto, estok_destino, ubicacion_destino, contenedor_destino=None):
        """
        Transfiere un objeto móvil (suelto o con objetos dentro) al Estok
        destino, re-anclando su ubicación/contenedor a la habitación elegida.
        """
        if objeto.estok_id and str(objeto.estok_id) == str(estok_destino.id):
            raise ValidationError("El objeto ya pertenece al Estok destino.")

        total_movidos = _mover_objeto_recursivo(
            objeto, estok_destino, ubicacion_destino,
            contenedor_destino, es_raiz=True,
        )

        return {
            'mensaje': f'«{objeto.nombre}» migró a «{estok_destino.nombre}».',
            'tipo': 'objeto',
            'objeto_id': str(objeto.id),
            'objeto_nombre': objeto.nombre,
            'estok_destino_id': str(estok_destino.id),
            'estok_destino_nombre': estok_destino.nombre,
            'objetos_movidos': total_movidos,
        }

