"""
Resolución del SUBTIPO técnico de una categoría (única fuente del backend).

Problema que resuelve: el formulario de objetos decidía qué atributos técnicos
mostrar (Autor, Marca, Talla, etc.) comparando el NOMBRE de la categoría en el
navegador. Eso funcionaba sólo si el nombre contenía la pista exacta y no había
forma de que el backend supiera qué familia correspondía.

Ahora `Categoria.subtipo` es la fuente explícita y este módulo:
  · normaliza los valores aceptados (choices del modelo), y
  · INFIERE el subtipo por nombre para las categorías creadas dinámicamente o
    para filas históricas sin subtipo (mismas reglas que el frontend).

Módulo puro (sin ORM ni red) para poder usarlo desde seeds, serializers y
migraciones sin riesgo de import circular.
"""

import unicodedata

from ..models.clasificacion import SUBTIPOS_CATEGORIA

# Valores válidos (choices del modelo): libro | tecnologia | mueble_arte | ropa
SUBTIPOS_VALIDOS = frozenset(clave for clave, _ in SUBTIPOS_CATEGORIA)

# Nombres exactos (normalizados) → subtipo. Espejo de FAMILIA_POR_NOMBRE del
# frontend (objetoCamposEspecificos.ts): se mantienen ambos por separado porque
# el frontend puede renderizar antes de que la API responda.
_SUBTIPO_POR_NOMBRE = {
    'libro': 'libro',
    'libros': 'libro',
    'revista': 'libro',
    'revistas': 'libro',
    'comic': 'libro',
    'comics': 'libro',
    'ropa': 'ropa',
    'calzado': 'ropa',
    'indumentaria': 'ropa',
    'mueble': 'mueble_arte',
    'muebles': 'mueble_arte',
    'silla': 'mueble_arte',
    'sillas': 'mueble_arte',
    'sillon': 'mueble_arte',
    'sillones': 'mueble_arte',
    'mesa': 'mueble_arte',
    'mesas': 'mueble_arte',
    'escritorio': 'mueble_arte',
    'escritorios': 'mueble_arte',
    'estante': 'mueble_arte',
    'estantes': 'mueble_arte',
    'estanteria': 'mueble_arte',
    'estanterias': 'mueble_arte',
    'arte': 'mueble_arte',
    'antiguedad': 'mueble_arte',
    'antiguedades': 'mueble_arte',
    'coleccionables': 'mueble_arte',
    'hogar': 'mueble_arte',
    'cocina': 'mueble_arte',
    'jardin': 'mueble_arte',
    'herramientas': 'mueble_arte',
    'materiales': 'mueble_arte',
    'decoracion': 'mueble_arte',
    'electronica': 'tecnologia',
    'computacion': 'tecnologia',
    'informatica': 'tecnologia',
    'tecnologia': 'tecnologia',
}

# Pistas parciales en ORDEN de prioridad (mismo orden que el frontend).
_PISTAS_NOMBRE = (
    ('libro', 'libro'),
    ('revista', 'libro'),
    ('comic', 'libro'),
    ('ropa', 'ropa'),
    ('calzado', 'ropa'),
    ('indumentaria', 'ropa'),
    ('electron', 'tecnologia'),
    ('comput', 'tecnologia'),
    ('informatic', 'tecnologia'),
    ('celular', 'tecnologia'),
    ('tecnolog', 'tecnologia'),
    ('mueble', 'mueble_arte'),
    ('silla', 'mueble_arte'),
    ('sillon', 'mueble_arte'),
    ('mesa', 'mueble_arte'),
    ('escritorio', 'mueble_arte'),
    ('estante', 'mueble_arte'),
    ('arte', 'mueble_arte'),
    ('antiguedad', 'mueble_arte'),
    ('coleccion', 'mueble_arte'),
    ('hogar', 'mueble_arte'),
    ('cocina', 'mueble_arte'),
    ('jardin', 'mueble_arte'),
    ('herramienta', 'mueble_arte'),
    ('material', 'mueble_arte'),
    ('decoracion', 'mueble_arte'),
)


def normalizar_nombre(texto) -> str:
    """Texto comparable: minúsculas, sin diacríticos y sin espacios extra."""
    limpio = unicodedata.normalize('NFD', str(texto or ''))
    limpio = ''.join(c for c in limpio if unicodedata.category(c) != 'Mn')
    return ' '.join(limpio.lower().split())


def normalizar_subtipo(valor) -> str:
    """Devuelve el subtipo válido normalizado o '' (nunca un valor inventado)."""
    clave = normalizar_nombre(valor)
    return clave if clave in SUBTIPOS_VALIDOS else ''


def subtipo_de_nombre(nombre) -> str:
    """
    Infiere el subtipo a partir del nombre de la categoría.

    Primero busca coincidencia exacta normalizada; si no, la primera pista
    parcial (mismas reglas que el frontend). Sin coincidencia devuelve ''.
    """
    clave = normalizar_nombre(nombre)
    if not clave:
        return ''
    exacto = _SUBTIPO_POR_NOMBRE.get(clave)
    if exacto:
        return exacto
    for fragmento, subtipo in _PISTAS_NOMBRE:
        if fragmento in clave:
            return subtipo
    return ''
