"""
Regla ÚNICA de los OBJETOS CONTENEDOR del catálogo de inventario.

CONTEXTO
    Un Objeto puede declararse caja/contenedor por TRES vías:
      1. `Objeto.es_contenedor = True` (disyuntor «Caja / Mueble» del alta).
      2. Categoría «Cajas y Contenedores» (categoría base sembrada en todo Estok).
      3. Rótulo numerado de caja del flujo de alta («Caja 02», «Cajas 03»): una
         caja declarada sólo por su nombre sigue siendo una CAJA del inventario
         y no puede degradarse a «Objeto Suelto» (fix de visibilidad: las cajas
         arrastradas al lienzo desaparecían de la SECCIÓN 1 si su categoría o
         su marca no habían quedado persistidas).

    Esos registros NO son objetos sueltos: el listado (`/objetos`) debe agruparlos
    en la SECCIÓN 1 «📦 Cajas e Inventario Interno», junto a las cajas físicas
    (`Contenedor` con `tipo='CAJA'`), y NUNCA en «🧸 Objetos Sueltos o sin Caja».

POR QUÉ UN MÓDULO APARTE
    `arbol_inventario_service` ya orquesta el payload jerárquico completo
    (muebles, cajas, sueltos y resumen). La clasificación y el nodo de estos
    Objetos viven acá para sostener el límite de modularidad del servicio y
    dejar la regla en un único lugar documentado.

    El nodo resultante conserva el CONTRATO de un nodo de caja (`tipo`,
    `tipo_contenedor`, `contenido`, `declarado_movible`) y agrega
    `origen='objeto'`, que es lo que el cliente usa para enlazar la tarjeta a
    /objetos/{id} en vez del visor de contenedores.
"""

from .taxonomia_contenedor import TIPO_CAJA, es_nombre_de_caja

# Categorías (normalizadas: minúsculas, sin espacios extremos) que declaran un
# Objeto como bulto contenedor. Las variantes toleran renombres manuales mínimos.
CATEGORIAS_OBJETO_CONTENEDOR = frozenset({
    'cajas y contenedores',
    'cajas / contenedores',
    'cajas/contenedores',
    'cajas y contenedor',
})

# RÓTULO NUMERADO DE CAJA del flujo de alta («Caja 02», «Cajas 03», «Caja 4»).
# Es la tercera vía de declaración: el operador crea la caja desde la botonera y
# el nombre es la única señal persistida. El patrón y su predicado viven en
# `services/taxonomia_contenedor.py` (fuente ÚNICA, compartida además con el
# filtro ORM de la canasta) y se reexportan acá por compatibilidad con los
# importadores históricos (`clasificacion_contenedor_objeto`).


def es_caja_declarada_por_naturaleza(objeto_data):
    """
    True si el Objeto es caja/contenedor por CATEGORÍA o RÓTULO NUMERADO.

    Esas dos vías son declaraciones EXPLÍCITAS de naturaleza («Cajas y
    Contenedores», «Caja 02»): la pieza es un bulto del inventario y se lista
    SIEMPRE como tarjeta de la SECCIÓN 1, esté donde esté.

    El simple flag `es_contenedor` NO alcanza para eso: un objeto común apoyado
    dentro de un ESPACIO/arquitectura del cuarto (p. ej. un sillón dentro de
    «Setup PC») conserva su condición de OBJETO y se lista en «🧸 Objetos
    Sueltos o sin Caja» con su ruta jerárquica (ver arbol_inventario_service).
    """
    nombre_categoria = str(
        objeto_data.get('categoria_nombre') or ''
    ).strip().casefold()
    if nombre_categoria in CATEGORIAS_OBJETO_CONTENEDOR:
        return True
    return es_nombre_de_caja(objeto_data.get('nombre'))


def es_objeto_contenedor(objeto_data):
    """
    True si el Objeto serializado es una CAJA/CONTENEDOR declarado.

    No hace consultas: evalúa la marca `es_contenedor`, el nombre de categoría y
    el rótulo numerado de caja ya presentes en el payload de
    `ObjetoListSerializer`.
    """
    if es_caja_declarada_por_naturaleza(objeto_data):
        return True
    return bool(objeto_data.get('es_contenedor'))


def nodo_objeto_contenedor(objeto_data, objetos_serializados):
    """
    Nodo de caja/contenedor para un Objeto declarado (SECCIÓN 1).

    El `contenido` son los Objetos que viven DENTRO del bulto por cualquiera de
    las dos vías persistidas: espacio lógico (`objeto_padre`) o alojamiento
    físico (`contenedor`). Se calcula en memoria sobre el mismo listado
    serializado, sin consultas N+1. Los Objetos que a su vez son cajas NO se
    anidan: tienen su propia tarjeta en la SECCIÓN 1 y su propio contenido.
    """
    clave = str(objeto_data.get('id'))
    hijos = []
    vistos = set()
    for h in objetos_serializados:
        id_hijo = str(h.get('id'))
        if id_hijo == clave or id_hijo in vistos:
            continue
        if es_objeto_contenedor(h):
            continue
        cuelga = (
            str(h.get('objeto_padre') or '') == clave
            or str(h.get('contenedor') or '') == clave
        )
        if not cuelga:
            continue
        hijos.append(h)
        vistos.add(id_hijo)
    return {
        'tipo': 'contenedor',
        # MARCA DE ORIGEN: la tarjeta enlaza al Objeto (/objetos/{id}).
        'origen': 'objeto',
        'tipo_contenedor': TIPO_CAJA,
        'id': clave,
        'nombre': objeto_data.get('nombre') or 'Caja / Contenedor',
        'descripcion': objeto_data.get('descripcion') or '',
        'ubicacion': objeto_data.get('ubicacion'),
        'ubicacion_nombre': objeto_data.get('ubicacion_nombre'),
        'es_inmueble': False,
        'declarado_movible': True,
        'material': None,
        'largo': None,
        'ancho': None,
        'alto': None,
        'foto': objeto_data.get('foto_principal'),
        'grid_filas': None,
        'grid_columnas': None,
        'grid_filas_config': None,
        'parent_contenedor': None,
        'parent_grid_row': objeto_data.get('parent_grid_row'),
        'parent_grid_col': objeto_data.get('parent_grid_col'),
        'subcontenedores_count': 0,
        'objetos_count': len(hijos),
        'contenido': [{**h, 'tipo': 'objeto'} for h in hijos],
    }
