"""
Saneamiento de los valores que viajan a la API de Mercado Libre.

Mercado Libre responde HTTP 400 "body.invalid_fields" cuando el body de
POST /items trae campos con tipos o valores que no pertenecen a la
especificación (título con HTML de más de 60 caracteres, precio en texto o 0,
category_id sin formato MLAxxxxx, atributos con IDs inventados, elementos nulos
en "pictures", etc.).

Este módulo centraliza las funciones PURAS de normalización que usa
`mercadolibre_payload.construir_payload_item()` y la vista de publicación:

    limpiar_texto / limpiar_titulo  → título y descripción en texto plano
    normalizar_family_name          → familia raíz del ítem (≤ 60 caracteres)
    family_name_publicable          → familia raíz publicable (identidad o título)
    normalizar_precio               → float > 0 con 2 decimales
    normalizar_category_id          → "MLA" + dígitos o "" si no es válido
    normalizar_attributes           → [{"id": ..., "value_name"/"value_id": ...}]
    normalizar_sale_terms           → solo WARRANTY_TYPE / WARRANTY_TIME

No hacen peticiones de red ni tocan la base de datos: son funciones puras y
por eso son fáciles de testear de forma aislada.
"""

import re

# Límites y valores por defecto de la especificación de POST /items.
TITULO_MAX_ML = 60          # límite duro de la API para el título
FAMILY_NAME_MAX_ML = 60     # límite de ML para family_name (raíz del ítem)
PRECIO_MIN_ML = 0.01        # ML no acepta precio 0 ni negativo
SALE_TERMS_PERMITIDOS = ("WARRANTY_TYPE", "WARRANTY_TIME")

# Saneamiento de textos e IDs.
_RE_HTML = re.compile(r"<[^>]+>")
_RE_ESPACIOS = re.compile(r"\s+")
_RE_CATEGORIA_ML = re.compile(r"^MLA\d+$")
_RE_ID_ATRIBUTO = re.compile(r"^[A-Z][A-Z0-9_]{1,40}$")
_ENTIDADES_HTML = (
    ("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
    ("&quot;", '"'), ("&#39;", "'"),
)


def limpiar_texto(valor, maximo: int = 0) -> str:
    """
    Texto limpio para la API: sin HTML, sin entidades, sin espacios repetidos.

    Recorta a `maximo` caracteres si se indica (ML rechaza títulos > 60). Es la
    base del saneamiento de `title` y `description`: un título con "<b>" hace
    que la API responda "body.invalid_fields".
    """
    texto = _RE_HTML.sub(" ", str(valor or ""))
    for entidad, reemplazo in _ENTIDADES_HTML:
        texto = texto.replace(entidad, reemplazo)
    texto = texto.strip(" -_·|")
    texto = _RE_ESPACIOS.sub(" ", texto).strip()
    if maximo and len(texto) > maximo:
        texto = texto[:maximo].rstrip()
    return texto


def limpiar_titulo(valor) -> str:
    """Título publicable: texto plano y truncado a TITULO_MAX_ML (60) chars."""
    return limpiar_texto(valor, TITULO_MAX_ML)


def normalizar_family_name(valor) -> str:
    """
    `family_name` de la RAÍZ del body: texto plano y truncado a 60 caracteres.

    Mercado Libre exige `family_name` como propiedad DIRECTA del recurso
    (además del atributo FAMILY_NAME dentro de `attributes`). Un valor con HTML
    o de más de 60 caracteres provoca HTTP 400 "body.invalid_fields".
    """
    return limpiar_texto(valor, FAMILY_NAME_MAX_ML)


def family_name_publicable(item_data, title: str = "") -> str:
    """
    Valor de `family_name` para la RAÍZ del body de POST /items.

    Mercado Libre exige `family_name` como propiedad DIRECTA del recurso (no
    alcanza con el atributo FAMILY_NAME dentro de `attributes`). Se usa el dato
    de identidad REAL del objeto en orden de preferencia:

        familia → marca → nombre → título

    Siempre texto plano y truncado a 60 caracteres.
    """
    origen = item_data if isinstance(item_data, dict) else {}
    for clave in ("family_name", "familia", "marca", "nombre"):
        valor = normalizar_family_name(origen.get(clave))
        if valor:
            return valor
    return normalizar_family_name(title)


def normalizar_precio(valor) -> float:
    """
    `price` como float positivo con 2 decimales.

    Acepta "1.234,56" / "1234.56". Lanza ValueError si no es numérico o si es
    <= 0: Mercado Libre no acepta precio 0 y no se inventa un precio.
    """
    if isinstance(valor, str):
        crudo = valor.strip().replace(" ", "")
        if "," in crudo and "." in crudo:
            crudo = crudo.replace(".", "").replace(",", ".")
        else:
            crudo = crudo.replace(",", ".")
        valor = crudo
    try:
        precio = float(valor)
    except (TypeError, ValueError):
        raise ValueError("El precio debe ser un número válido.")
    if precio < PRECIO_MIN_ML:
        raise ValueError("El precio debe ser mayor a 0 para publicar en Mercado Libre.")
    return round(precio, 2)


def normalizar_category_id(valor) -> str:
    """
    ID de categoría MLA en formato oficial (MLA + dígitos) o "" si no sirve.

    Un ID con otro formato (o vacío) hace que ML responda "body.invalid_fields".
    """
    limpio = str(valor or "").strip().upper()
    return limpio if _RE_CATEGORIA_ML.match(limpio) else ""


def normalizar_attributes(attributes) -> list:
    """
    Atributos en el formato exacto de ML: [{"id": "BRAND", "value_name": "..."}].

    Descarta entradas sin id válido, sin valor o con IDs inventados: los IDs del
    catálogo de Mercado Libre vienen SIEMPRE en MAYÚSCULAS, así que una clave en
    minúsculas (ej: "family_name" escrita a mano) no es un atributo del catálogo
    y se descarta en vez de "legitimarla" convirtiéndola. Nunca envía
    value_name junto a value_id (ML rechaza combinaciones inválidas).
    """
    normalizados: list = []
    vistos: set = set()
    for atributo in attributes or []:
        if not isinstance(atributo, dict):
            continue
        crudo = str(atributo.get("id") or "").strip()
        aid = crudo.upper()
        if not crudo or crudo != aid or aid in vistos or not _RE_ID_ATRIBUTO.match(aid):
            continue
        value_id = str(atributo.get("value_id") or "").strip()
        value_name = str(atributo.get("value_name") or "").strip()
        entrada = {"id": aid}
        if value_id:
            entrada["value_id"] = value_id
        elif value_name:
            entrada["value_name"] = value_name
        else:
            continue
        vistos.add(aid)
        normalizados.append(entrada)
    return normalizados


def normalizar_sale_terms(sale_terms) -> list:
    """
    Términos de venta válidos (WARRANTY_TYPE / WARRANTY_TIME).

    Si no vienen o no son válidos se devuelve [] y la clave `sale_terms` no se
    envía: Mercado Libre rechaza términos fuera de catálogo.
    """
    terminos: list = []
    for termino in sale_terms or []:
        if not isinstance(termino, dict):
            continue
        tid = str(termino.get("id") or "").strip().upper()
        value_name = str(termino.get("value_name") or "").strip()
        if tid in SALE_TERMS_PERMITIDOS and value_name:
            terminos.append({"id": tid, "value_name": value_name[:60]})
    return terminos
