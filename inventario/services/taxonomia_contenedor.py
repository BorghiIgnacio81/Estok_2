"""
TAXONOMÍA ESTRICTA DE CONTENEDORES (MUEBLE / CAJA / ESTANTE).

El listado de la pestaña de Objetos necesita separar sin ambigüedad tres
naturalezas físicas que antes se inferían en el cliente con heurísticas
frágiles (es_inmueble + conteo de hijos + patrón de nombre):

  - MUEBLE   → armario, cucheta, ropero, archivador: estructura GRANDE que
               aloja sub-divisiones u objetos. Se lista en la SECCIÓN 3
               (Muebles y Estructuras Móviles) y nunca en la SECCIÓN 1.
  - CAJA     → contenedor pequeño MÓVIL donde el operador mete objetos. Es el
               ÚNICO tipo admitido en la SECCIÓN 1 (Cajas e Inventario Interno).
  - ESTANTE  → sub-división interna / cajonera de un mueble (Nivel 3/4). Queda
               EXCLUIDA de cualquier listado de inventario independiente.

Este módulo es el ÚNICO origen de la clasificación automática: la usan el
modelo `Contenedor` (al crear desde cualquier modal/botonera/servicio) y la
migración de backfill de datos históricos. NO define ni importa modelos (así la
misma regla sirve para el modelo vivo y para el modelo histórico de la
migración, sin acoplamiento circular).
"""

import re

TIPO_MUEBLE = 'MUEBLE'
TIPO_CAJA = 'CAJA'
TIPO_ESTANTE = 'ESTANTE'

# Rótulos por defecto de las botoneras/motores de creación vigentes:
#   visorHabitacion  → "Mueble 1"
#   visorContenedor* → "Estante 1" / "Estante F2·C1"
#   wizard Mapa Estok→ "Mueble F1·C2" / "Estantería F2·C1"
#   almacenamiento   → "Mueble F1·C2" (mueble encastrado en la grilla)
RE_NOMBRE_MUEBLE = re.compile(r'^mueble(\s|$)', re.IGNORECASE)
RE_NOMBRE_ESTANTE = re.compile(
    r'^(estante|estanter[ií]a|cajonera|caj[oó]n)(\s|$)', re.IGNORECASE,
)


def es_nombre_de_mueble(nombre):
    """True si el rótulo es el de un mueble por defecto ("Mueble 1"/"Mueble F1·C2")."""
    return bool(RE_NOMBRE_MUEBLE.match(str(nombre or '').strip()))


def es_nombre_de_estante(nombre):
    """True si el rótulo es el de una sub-división ("Estante 1"/"Estantería F2·C1")."""
    return bool(RE_NOMBRE_ESTANTE.match(str(nombre or '').strip()))


def inferir_tipo_contenedor(
    contenedor, *, tipo_explicito=False, tiene_hijos=None, parent_es_raiz=None,
):
    """
    Resuelve el tipo taxonómico legítimo de un Contenedor.

    Reglas (en orden de prioridad):

      1. `tipo_explicito=True` → se respeta el valor enviado por el cliente.
      2. `es_inmueble=True`    → MUEBLE (mueble fijo adherido a la habitación).
      3. Tiene sub-contenedores → MUEBLE si es raíz, ESTANTE si es anidado.
      4. Nombre por defecto "Mueble ..." → MUEBLE.
      5. Nombre por defecto "Estante/Estantería/Cajonera/Cajón ..." → ESTANTE.
      6. `parent_contenedor` definido → ESTANTE (sub-división interna). El
         backfill histórico pasa `parent_es_raiz=True` para preservar las cajas
         reales que viven dentro de un mueble raíz (Nivel 3).
      7. Contenedor raíz encastrado en la grilla de la habitación
         (`parent_grid_row/col`) → MUEBLE.
      8. Resto → CAJA (contenedor pequeño móvil de objetos).

    `tiene_hijos` y `parent_es_raiz` son opcionales: al crear un contenedor
    todavía no existen hijos, por lo que el modelo los omite; la migración de
    backfill los calcula con los datos históricos.
    """
    if tipo_explicito and getattr(contenedor, 'tipo', None):
        return contenedor.tipo

    if getattr(contenedor, 'es_inmueble', False):
        return TIPO_MUEBLE

    if tiene_hijos:
        return TIPO_MUEBLE if not contenedor.parent_contenedor_id else TIPO_ESTANTE

    nombre = getattr(contenedor, 'nombre', '')
    if es_nombre_de_mueble(nombre):
        return TIPO_MUEBLE
    if es_nombre_de_estante(nombre):
        return TIPO_ESTANTE

    if contenedor.parent_contenedor_id:
        return TIPO_CAJA if parent_es_raiz is True else TIPO_ESTANTE

    if (
        contenedor.parent_grid_row is not None
        or contenedor.parent_grid_col is not None
    ):
        return TIPO_MUEBLE

    return TIPO_CAJA
