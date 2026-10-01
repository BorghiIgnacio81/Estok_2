"""
«EN TRÁNSITO INTERNO»: escalón intermedio del Drop dentro de un mueble.

REGLA DE NEGOCIO (evento onDrop del backend):

  Cuando el operador suelta una CAJA o un OBJETO dentro de un MUEBLE_MOVIL o
  MUEBLE_INMUEBLE que POSEE sub-divisiones internas (CONJUNTOS: estantes,
  cajoneras, cajones) pero NO especifica un estante de destino concreto, el
  elemento queda almacenado con su `parent_contenedor` apuntando al MUEBLE
  RAÍZ y con el flag `en_transito_interno = True`.

  Lectura funcional: el elemento YA reside físicamente en ese mueble, pero
  está pendiente de que el usuario lo abra y lo ubique de forma fina en un
  estante definitivo (bandeja de pendientes del mueble).

  Si el Drop especifica un estante/casillero concreto (parent_contenedor =
  CONJUNTO, o coordenadas `parent_grid_row/col`), el flag se limpia: el
  elemento ya está ubicado de forma fina.

Este módulo concentra el sondeo de jerarquía contra la base (por eso SÍ importa
modelos) y lo consume el serializer de contenedores y de objetos. La
clasificación pura vive en `inventario/services/taxonomia_contenedor.py`.
"""

from ..models import Contenedor
from .taxonomia_contenedor import TIPO_CONJUNTO, TIPOS_MUEBLE


def tiene_divisiones_internas(mueble):
    """True si el mueble anfitrión aloja al menos una sub-división (CONJUNTO)."""
    if mueble is None or getattr(mueble, 'pk', None) is None:
        return False
    return Contenedor.objects.filter(
        parent_contenedor_id=mueble.pk,
        tipo=TIPO_CONJUNTO,
    ).exists()


def es_mueble_con_divisiones(destino):
    """
    True si el destino del Drop es un MUEBLE (móvil o inmueble) que además
    posee sub-divisiones internas propias.
    """
    if destino is None or getattr(destino, 'pk', None) is None:
        return False
    if getattr(destino, 'tipo', None) not in TIPOS_MUEBLE:
        return False
    return tiene_divisiones_internas(destino)


def esta_en_transito_interno(destino, parent_grid_row, parent_grid_col):
    """
    Resuelve el flag «En Tránsito Interno» de un elemento soltado en `destino`.

    Devuelve True SOLO cuando el destino es un mueble anfitrión con
    sub-divisiones internas y el Drop no indicó casillero concreto alguno. En
    cualquier otro caso el elemento está plenamente ubicado y devuelve False.
    """
    if not es_mueble_con_divisiones(destino):
        return False
    return parent_grid_row is None and parent_grid_col is None
