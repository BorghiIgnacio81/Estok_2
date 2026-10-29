"""
Regla ÚNICA de los OBJETOS CONTENEDOR del catálogo de inventario.

CONTEXTO
    Un Objeto puede declararse caja/contenedor por dos vías persistidas:
      1. `Objeto.es_contenedor = True` (disyuntor «Caja / Mueble» del alta).
      2. Categoría «Cajas y Contenedores» (categoría base sembrada en todo Estok).

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

from .taxonomia_contenedor import TIPO_CAJA

# Categorías (normalizadas: minúsculas, sin espacios extremos) que declaran un
# Objeto como bulto contenedor. Las variantes toleran renombres manuales mínimos.
CATEGORIAS_OBJETO_CONTENEDOR = frozenset({
    'cajas y contenedores',
    'cajas / contenedores',
    'cajas/contenedores',
    'cajas y contenedor',
})


def es_objeto_contenedor(objeto_data):
    """
    True si el Objeto serializado es una CAJA/CONTENEDOR declarado.

    No hace consultas: evalúa la marca `es_contenedor` y el nombre de categoría
    ya presentes en el payload de `ObjetoListSerializer`.
    """
    if objeto_data.get('es_contenedor'):
        return True
    nombre = str(objeto_data.get('categoria_nombre') or '').strip().casefold()
    return nombre in CATEGORIAS_OBJETO_CONTENEDOR


def nodo_objeto_contenedor(objeto_data, objetos_serializados):
    """
    Nodo de caja/contenedor para un Objeto declarado (SECCIÓN 1).

    El `contenido` son los Objetos cuyo espacio lógico (`objeto_padre`) apunta a
    este registro. Se calcula en memoria sobre el mismo listado serializado, sin
    consultas N+1.
    """
    clave = str(objeto_data.get('id'))
    hijos = [
        h for h in objetos_serializados
        if str(h.get('objeto_padre') or '') == clave
    ]
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
