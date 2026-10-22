"""
Reglas de inclusión de atributos de Mercado Libre.

Define qué atributos del catálogo de una categoría deben viajar en el payload de
POST /items, sin depender de cómo se construye el valor:

    tags.required        → ML lo exige
    tags.catalog_required → ML exige un valor del catálogo de productos
    FAMILY / BRAND        → identidad del producto (siempre se incluye)
    MODEL / MODEL_NAME    → identidad del producto (siempre se incluye)

Usado por:
- inventario/services/mercadolibre_atributos.py
- inventario/services/mercadolibre_atributos_diagnostico.py
"""

from .mercadolibre_atributos_valores import normalizar_id

# IDs de identidad que SIEMPRE se incluyen cuando la categoría los define,
# aunque ML no los marque como obligatorios.
TOKENS_IDENTIDAD = ("FAMILY", "BRAND")


def es_requerido(atributo: dict) -> bool:
    """
    True si el atributo está marcado como obligatorio por ML.

    El catálogo lo informa en `tags.required` (dict o lista) y, de forma
    defensiva, también se acepta `required: true` en el primer nivel o la
    palabra "required" dentro de `hierarchy`.
    """
    tags = atributo.get("tags") or {}
    if isinstance(tags, dict):
        if str(tags.get("required")).strip().lower() in ("true", "1", "yes"):
            return True
    elif isinstance(tags, list):
        if any(str(tag).strip().lower() == "required" for tag in tags):
            return True
    if atributo.get("required") is True:
        return True
    return "required" in str(atributo.get("hierarchy") or "").strip().lower()


def es_catalog_required(atributo: dict) -> bool:
    """True si ML exige que el valor provenga del catálogo de productos."""
    tags = atributo.get("tags") or {}
    if isinstance(tags, dict):
        return str(tags.get("catalog_required")).strip().lower() in (
            "true", "1", "yes",
        )
    if isinstance(tags, list):
        return any(str(tag).strip().lower() == "catalog_required" for tag in tags)
    return False


def debe_incluir(atributo: dict) -> bool:
    """
    True si el atributo debe viajar en el payload.

    Criterio:
      - `tags.required == True`, o
      - `tags.catalog_required == True`, o
      - el ID es de identidad: contiene FAMILY / BRAND, o es MODEL / MODEL_NAME.

    Se excluyen PROCESSOR_MODEL, GRAPHIC_CARD_MODEL y similares: son datos
    técnicos opcionales y forzarlos con un valor genérico generaría rechazos.
    """
    aid = normalizar_id(atributo.get("id"))
    if not aid:
        return False
    if es_requerido(atributo) or es_catalog_required(atributo):
        return True
    if any(token in aid for token in TOKENS_IDENTIDAD):
        return True
    return aid == "MODEL" or aid.startswith("MODEL_")
