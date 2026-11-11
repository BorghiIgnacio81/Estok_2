"""
SECCIÓN «🗄 MUEBLES Y ESTRUCTURAS MÓVILES» · OBJETOS de categoría «Muebles».

CONTEXTO
    La sección «Muebles y Estructuras Móviles» del listado `/objetos` agrupa
    dos naturalezas distintas:

      1. Los `Contenedor` mueble (`tipo='MUEBLE_MOVIL'`, `es_inmueble=False`),
         resueltos en la SECCIÓN 3 del árbol (`estructuras`).
      2. Los OBJETOS físicos cuyo único vínculo con el inventario es su
         categoría «Muebles»: una mesa, una silla o un sillón guardado como
         Objeto (no como Contenedor) es mobiliario del Estok y su lugar es esa
         sección, NO la bandeja de huérfanos.

REGLA (fuente ÚNICA)
    `es_objeto_mueble(objeto_data)` es True cuando:

      · el Objeto NO es caja/contenedor declarado
        (`es_objeto_contenedor` = False, es decir `es_contenedor = False` y
        tampoco lo declaran su categoría ni su rótulo «Caja 0N»), Y
      · su categoría (`categoria_nombre` del serializer) es «Muebles» o
        «Muebles y Estructuras Móviles».

    Se evalúa en MEMORIA sobre el payload ya serializado (cero N+1) y sólo se
    aplica a los objetos que iban a la bandeja de «🧸 Objetos Sueltos o sin
    Caja»: un ítem guardado dentro de una caja/mueble listado sigue viviendo en
    el contenido de ese contenedor y nunca se duplica acá.

POR QUÉ UN MÓDULO APARTE
    `arbol_inventario_service` ya orquesta el payload completo; la regla vive
    acá para sostener la modularidad del orquestador y para que el predicado y
    su partición tengan un único lugar documentado y testeable.
"""

from .arbol_inventario_objetos_contenedor import es_objeto_contenedor
from .categorias_clasificacion import es_categoria_mueble


def es_objeto_mueble(objeto_data) -> bool:
    """
    True si el Objeto serializado es mobiliario por CATEGORÍA y NO una caja.

    No hace consultas: usa `categoria_nombre` y `es_contenedor` del payload de
    `ObjetoListSerializer`. Un Objeto con `es_contenedor=True` (o declarado
    contenedor por categoría/rótulo) NUNCA entra acá: su sección es «📦 Cajas e
    Inventario Interno».
    """
    if es_objeto_contenedor(objeto_data):
        return False
    return es_categoria_mueble(objeto_data.get('categoria_nombre'))


def separar_muebles_objetos(objetos):
    """
    Divide la bandeja de objetos sueltos en dos listas: (muebles, sueltos).

    `muebles` son los Objetos de categoría «Muebles» que no son cajas (viajan a
    la sección «🗄 Muebles y Estructuras Móviles») y `sueltos` el resto, que
    conserva su comportamiento histórico en «🧸 Objetos Sueltos o sin Caja».
    """
    muebles, sueltos = [], []
    for objeto_data in objetos or []:
        destino = muebles if es_objeto_mueble(objeto_data) else sueltos
        destino.append(objeto_data)
    return muebles, sueltos
