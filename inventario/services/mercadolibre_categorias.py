"""
Resolución del `category_id` de Mercado Libre para BÚSQUEDAS de precio.

Problema que resuelve (bug real: «Buscar precio de referencia» en objetos de
«Ropa» devolvía error / ningún resultado):
- La búsqueda viajaba SIN filtro de categoría, así que el full-text de MLA
  devolvía listados irrelevantes (o nada) para indumentaria.
- El formulario manda tres formatos distintos de categoría: el ID oficial de
  Mercado Libre («MLA1430», alta de objetos), el SUBTIPO técnico («ropa»,
  «calzado») o el nombre visible («👕 Ropa», edición). La API de búsqueda sólo
  acepta el ID oficial en el parámetro `category`.

Este módulo es PURO (sin ORM ni red) y es el ÚNICO lugar que traduce esos
formatos al `category_id` que viaja a GET /sites/MLA/search. Lo que no se puede
resolver devuelve '' y el servicio de búsqueda continúa SIN filtro de categoría
(ese es el fallback automático: nunca se aborta la búsqueda por una categoría
desconocida).
"""

import re
import unicodedata

# Nombre de categoría de la plataforma → ID oficial de Mercado Libre Argentina.
# Espejo de inventario/management/commands/cargar_categorias_meli.py
# (CATEGORIAS_OFICIALES) + inventario/services/categorias_meli.py
# (CATEGORIAS_BASE_ADICIONALES: Ropa y Libros).
CATEGORIAS_MLA_POR_NOMBRE = {
    "ropa": "MLA1430",           # Ropa y Accesorios (contenedor de indumentaria)
    "indumentaria": "MLA1430",
    "calzado": "MLA1430",
    "libros": "MLA412445",       # Libros Físicos
    "libro": "MLA412445",
    "muebles": "MLA436380",
    "mueble": "MLA436380",
    "arte": "MLA34263",
    "coleccionables": "MLA1367",
    "antiguedades": "MLA436789",
    "jardin": "MLA1621",
    "computacion": "MLA1648",
    "electronica": "MLA1000",
    "cocina": "MLA1592",
    "hogar": "MLA1574",
    "herramientas": "MLA407134",
    "materiales": "MLA403697",
}

# Subtipo técnico (Categoria.subtipo) → categoría MLA de búsqueda.
# «ropa» agrupa indumentaria y calzado: MLA1430 «Ropa y Accesorios».
CATEGORIAS_MLA_POR_SUBTIPO = {
    "ropa": "MLA1430",
    "libro": "MLA412445",
    "tecnologia": "MLA1000",
    "mueble_arte": "MLA1574",
}

# Formato oficial del ID de categoría de Mercado Libre (ej: MLA1430, MLA412445).
PATRON_ID_MLA = re.compile(r"^MLA\d{3,}$")


def normalizar_clave(valor) -> str:
    """Texto comparable: sin diacríticos, minúsculas y sin espacios extra."""
    limpio = unicodedata.normalize("NFKD", str(valor or ""))
    limpio = "".join(c for c in limpio if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", limpio).strip().lower()


def resolver_category_id(categoria=None) -> str:
    """
    `category_id` de Mercado Libre para la búsqueda, o '' si no se resuelve.

    Acepta, en este orden:
      1. el ID oficial («MLA1430»),
      2. el nombre de la categoría («👕 Ropa» → MLA1430, «Jardín» → MLA1621),
      3. el subtipo técnico («ropa», «calzado», «indumentaria»).

    El combo del formulario antepone un icono al nombre («👕 Ropa»), por eso la
    búsqueda se hace PALABRA POR PALABRA y no por coincidencia exacta.
    """
    texto = normalizar_clave(categoria)
    if not texto:
        return ""
    if PATRON_ID_MLA.match(texto.upper()):
        return texto.upper()
    for palabra in re.split(r"[^a-z0-9_]+", texto):
        if not palabra:
            continue
        if palabra in CATEGORIAS_MLA_POR_NOMBRE:
            return CATEGORIAS_MLA_POR_NOMBRE[palabra]
        if palabra in CATEGORIAS_MLA_POR_SUBTIPO:
            return CATEGORIAS_MLA_POR_SUBTIPO[palabra]
    return ""
