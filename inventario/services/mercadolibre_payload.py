"""
Payload y errores de la publicación en Mercado Libre (POST /items).

Centraliza DOS responsabilidades que estaban mezcladas dentro de
mercadolibre_api.py:

1. ARMADO DEL BODY con saneamiento integral. Se envía ÚNICAMENTE el conjunto de
   campos de primer nivel que acepta POST /items (whitelist CAMPOS_PERMITIDOS_ML)
   con los tipos exactos de la API. Mercado Libre responde HTTP 400
   "body.invalid_fields" cuando llega una clave que no pertenece al recurso
   (bug real: la clave raíz "warranty") y "body.required_fields" cuando falta un
   campo obligatorio, por eso el body garantiza siempre:
     currency_id='ARS', buying_mode='buy_it_now',
     listing_type_id (gold_special o el configurado en settings),
     condition ('nuevo' → 'new', cualquier otro estado → 'used'),
     available_quantity entero ≥ 1, title limpio ≤ 60 caracteres,
     description {"plain_text": ...},
     shipping {"mode": "not_specified", "local_pick_up": True}.
   "pictures" solo se envía si hay URLs absolutas HTTPS: nunca valores nulos.
   "attributes" se limita a los atributos estándar (BRAND / MODEL): los
   obligatorios de cada categoría los agrega mercadolibre_atributos.py
   consultando el catálogo real (GET /categories/{id}/attributes).

2. EXTRACCIÓN DE ERRORES de Mercado Libre (HTTP 400/422): normaliza las causas
   y devuelve el campo exacto que falta o que fue rechazado, para responderle al
   frontend "Mercado Libre requiere especificar: [...]" / "Mercado Libre rechazó
   los campos: [...]" en lugar de un error genérico.

Usado por:
- inventario/services/mercadolibre_api.py (create_item + logging).
- inventario/api/viewsets/mercadolibre_views.py (publicar_item).
"""

import json
import logging
import re
from typing import Any, Dict

from django.conf import settings

from .mercadolibre_imagenes import normalizar_pictures
from .mercadolibre_saneamiento import (
    limpiar_texto,
    limpiar_titulo,
    normalizar_attributes,
    normalizar_category_id,
    normalizar_precio,
    normalizar_sale_terms,
)

logger = logging.getLogger(__name__)

# =============================================================================
# VALORES POR DEFECTO DEL PAYLOAD DE POST /items
# =============================================================================
CURRENCY_ID_DEFAULT = "ARS"           # MLA (Argentina) opera en pesos
BUYING_MODE_DEFAULT = "buy_it_now"    # compra inmediata
# Tipo de publicación: 'gold_special' es la exposición clásica de MLA; se puede
# cambiar con settings.MERCADOLIBRE_LISTING_TYPE_ID ('free', 'bronze', ...).
LISTING_TYPE_DEFAULT = "gold_special"
LISTING_TYPES_VALIDOS = ("gold_special", "gold_pro", "silver", "bronze", "free")
AVAILABLE_QUANTITY_DEFAULT = 1        # stock mínimo publicable
CONDITION_DEFAULT = "used"            # el inventario es de segunda mano por defecto

# Estados locales que equivalen a cada condición nativa de Mercado Libre.
ESTADOS_CONDICION_NUEVO = ("nuevo", "nueva", "new")
ESTADOS_CONDICION_USADO = ("usado", "usada", "used")

# Campos de primer nivel que MLA exige en POST /items: se usan para pre-validar
# el payload y devolver un error descriptivo SIN gastar una llamada a la API.
CAMPOS_REQUERIDOS_ML = (
    "title",
    "category_id",
    "price",
    "currency_id",
    "available_quantity",
    "buying_mode",
    "listing_type_id",
    "condition",
)

# Whitelist de campos de primer nivel que acepta POST /items: cualquier otra
# clave se descarta antes de enviar el body (origen de "body.invalid_fields").
CAMPOS_PERMITIDOS_ML = (
    "title",
    "category_id",
    "price",
    "currency_id",
    "available_quantity",
    "buying_mode",
    "listing_type_id",
    "condition",
    "description",
    "pictures",
    "attributes",
    "shipping",
    "sale_terms",
)

# ML devuelve los campos faltantes entre corchetes en el mensaje de la causa:
# "The fields [condition, pictures] are required".
_RE_CAMPOS_ML = re.compile(r"\[([^\]]+)\]")
_SEPARADORES_CAMPOS_ML = re.compile(r"[,/]| and | y ")


def mapear_condition_ml(valor) -> str:
    """
    Traduce un estado local al `condition` nativo de Mercado Libre.

    'nuevo'/'nueva'/'new' → 'new'; 'usado'/'usada'/'used' → 'used'.
    Cualquier otro valor (o vacío) → '' para que el llamador aplique el default.
    """
    texto = str(valor or "").strip().lower()
    if texto in ESTADOS_CONDICION_NUEVO:
        return "new"
    if texto in ESTADOS_CONDICION_USADO:
        return "used"
    return ""


def condition_desde_objeto(objeto, por_defecto: str = CONDITION_DEFAULT) -> str:
    """
    Mapea el estado del objeto al `condition` de Mercado Libre.

    Prueba los campos de estado del inventario (estado, condicion,
    estado_conservacion): solo 'nuevo' produce 'new'; cualquier otro estado
    (bueno, regular, malo, muy_malo...) produce 'used'.
    """
    for atributo in ("estado", "condicion", "estado_conservacion"):
        mapeado = mapear_condition_ml(getattr(objeto, atributo, ""))
        if mapeado:
            return mapeado
    return por_defecto


def cantidad_disponible_ml(objeto, por_defecto: int = AVAILABLE_QUANTITY_DEFAULT) -> int:
    """
    `available_quantity` para Mercado Libre.

    Usa objeto.cantidad si existe (también acepta stock/available_quantity) y
    cae al default 1 cuando el campo no existe, no es numérico o es <= 0.
    """
    for atributo in ("cantidad", "stock", "available_quantity"):
        try:
            cantidad = int(getattr(objeto, atributo, None))
        except (TypeError, ValueError):
            continue
        if cantidad > 0:
            return cantidad
    return por_defecto


def _listing_type_configurado() -> str:
    """Tipo de publicación configurado (settings) o el default gold_special."""
    configurado = str(
        getattr(settings, "MERCADOLIBRE_LISTING_TYPE_ID", "") or ""
    ).strip().lower()
    if configurado in LISTING_TYPES_VALIDOS:
        return configurado
    return LISTING_TYPE_DEFAULT


def _causes_ml(result: Any) -> list:
    """Lista de causas (dicts) de una respuesta de error de Mercado Libre."""
    if not isinstance(result, dict):
        return []
    causas = result.get("cause") or result.get("causes") or []
    if not isinstance(causas, list):
        return []
    return [causa for causa in causas if isinstance(causa, dict)]


def campos_requeridos_faltantes(result: Any) -> list:
    """
    Nombres de los campos que Mercado Libre reporta como faltantes.

    ML los devuelve entre corchetes en el mensaje de la causa
    ("The fields [condition, pictures] are required") y/o en `references`
    ("body.category_id", "body.pictures.source").
    """
    campos: list = []
    for causa in _causes_ml(result):
        codigo = str(causa.get("code") or "").lower()
        mensaje = str(causa.get("message") or "")
        texto = mensaje.lower()
        es_requerido = (
            "required" in codigo or "missing" in codigo
            or "required" in texto or "missing" in texto
        )
        if not es_requerido:
            continue

        candidatos: list = []
        for grupo in _RE_CAMPOS_ML.findall(mensaje):
            candidatos.extend(_SEPARADORES_CAMPOS_ML.split(grupo))
        for referencia in (causa.get("references") or []):
            texto_ref = str(referencia or "").strip()
            if texto_ref.lower().startswith("body."):
                candidatos.append(texto_ref.split(".")[-1])

        for candidato in candidatos:
            campo = str(candidato or "").strip().strip("'\"")
            if campo and " " not in campo and campo not in campos:
                campos.append(campo)
    return campos


def campos_invalidos_ml(result: Any) -> list:
    """
    Campos que Mercado Libre reportó como INVÁLIDOS (body.invalid_fields).

    ML los devuelve en el mensaje entre corchetes ("The fields [warranty] are
    invalid") y/o en `references` ("body.shipping.mode").
    """
    campos: list = []
    for causa in _causes_ml(result):
        codigo = str(causa.get("code") or "").lower()
        mensaje = str(causa.get("message") or "")
        texto = mensaje.lower()
        if "required" in codigo or "missing" in codigo:
            continue
        if not any(
            senal in codigo or senal in texto
            for senal in ("invalid", "not valid", "not allowed", "no es válido",
                          "no válido", "no permitido")
        ):
            continue

        candidatos: list = []
        for grupo in _RE_CAMPOS_ML.findall(mensaje):
            candidatos.extend(_SEPARADORES_CAMPOS_ML.split(grupo))
        for referencia in (causa.get("references") or []):
            texto_ref = str(referencia or "").strip()
            if texto_ref.lower().startswith("body."):
                candidatos.append(texto_ref[5:])
        if causa.get("attribute"):
            candidatos.append(causa["attribute"])

        for candidato in candidatos:
            campo = str(candidato or "").strip().strip("'\"")
            if campo and len(campo) <= 60 and campo not in campos:
                campos.append(campo)
    return campos


def extraer_error_ml(result: Any) -> Dict[str, Any]:
    """
    Normaliza el error devuelto por Mercado Libre (HTTP 400/422).

    Returns:
        {
          "mensaje": str,   # texto listo para mostrarle al usuario
          "campos": list,   # campos que ML exige y no llegaron en el body
          "invalidos": list,# campos que ML rechazó por contenido inválido
          "detalles": list, # una línea legible por cada causa de ML
        }
    """
    detalles: list = []
    for causa in _causes_ml(result):
        detalle = str(causa.get("message") or causa.get("code") or "").strip()
        atributo = causa.get("attribute") or causa.get("department")
        if atributo:
            detalle = f"[{atributo}] {detalle}"
        if detalle:
            detalles.append(detalle)

    campos = campos_requeridos_faltantes(result)
    invalidos = campos_invalidos_ml(result)

    if campos:
        mensaje = "Mercado Libre requiere especificar: [{}]".format(" / ".join(campos))
    elif invalidos:
        mensaje = "Mercado Libre rechazó los campos: [{}]".format(" / ".join(invalidos))
        if detalles:
            mensaje += " — " + "; ".join(detalles)
    elif detalles:
        mensaje = "; ".join(detalles)
    elif isinstance(result, dict) and result.get("message"):
        mensaje = str(result["message"])
    elif isinstance(result, dict) and result.get("error"):
        mensaje = str(result["error"])
    elif result:
        mensaje = json.dumps(result, ensure_ascii=False)
    else:
        mensaje = "Error desconocido al publicar en Mercado Libre."

    return {
        "mensaje": mensaje,
        "campos": campos,
        "invalidos": invalidos,
        "detalles": detalles,
    }


def construir_payload_item(item_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Arma el body de POST /items con saneamiento integral de tipos y valores.

    Mercado Libre rechaza la publicación con HTTP 400 "body.invalid_fields"
    cuando el body trae claves o tipos que no pertenecen al recurso, y con
    "body.required_fields" cuando falta un campo obligatorio. Por eso el body
    final cumple estrictamente:

      - title              → texto plano (sin HTML) truncado a 60 caracteres
      - category_id        → MLA + dígitos; se aborta si no es válido (la vista
                             resuelve la categoría hoja y la predicción)
      - price              → float > 0; se aborta si es <= 0 (no se inventa)
      - currency_id        → ARS (siempre)
      - available_quantity → int >= 1
      - buying_mode        → buy_it_now (siempre)
      - listing_type_id    → gold_special o el configurado en settings
      - condition          → 'new' si el estado es nuevo, si no 'used'
      - description        → {"plain_text": ...} (cae al título si viene vacía)
      - pictures           → [{"source": "https://..."}] solo si hay URLs
                             públicas; sin fotos NO se envía la clave
      - attributes         → solo atributos válidos (BRAND / MODEL por defecto)
      - shipping           → {"mode": "not_specified", "local_pick_up": True}
      - sale_terms         → solo si se especifican términos válidos
      - Cualquier otra clave se descarta (whitelist CAMPOS_PERMITIDOS_ML).

    Raises:
        ValueError: título vacío, categoría inválida, precio inválido o payload
            incompleto (mensaje listo para devolverse al frontend).
    """
    if not isinstance(item_data, dict):
        item_data = {}

    # Título: texto plano (sin HTML) y truncado estricto a 60 caracteres
    title = limpiar_titulo(item_data.get("title"))
    if not title:
        raise ValueError("El título es obligatorio para publicar en Mercado Libre.")

    # Categoría: NUNCA nula ni con formato raro (la vista resuelve la hoja)
    category_id = normalizar_category_id(item_data.get("category_id"))
    if not category_id:
        raise ValueError("Debes asignar una categoría válida de Mercado Libre")

    # Precio: float positivo con 2 decimales (ML no acepta 0)
    price = normalizar_precio(item_data.get("price"))

    # Stock: entero estricto >= 1
    try:
        available_quantity = int(
            float(item_data.get("available_quantity") or AVAILABLE_QUANTITY_DEFAULT)
        )
    except (TypeError, ValueError):
        available_quantity = AVAILABLE_QUANTITY_DEFAULT
    available_quantity = max(available_quantity, AVAILABLE_QUANTITY_DEFAULT)

    # Condición: solo valores nativos ('usado' en español jamás llega a ML)
    condition = mapear_condition_ml(item_data.get("condition")) or CONDITION_DEFAULT

    # Tipo de publicación: se respeta solo si es un valor válido de ML; si no,
    # se usa el configurado (settings) o gold_special.
    listing_type_id = str(item_data.get("listing_type_id") or "").strip().lower()
    if listing_type_id not in LISTING_TYPES_VALIDOS:
        listing_type_id = _listing_type_configurado()

    # Descripción: SIEMPRE objeto {"plain_text": ...}; si viene vacía se usa
    # el título (ML rechaza cadenas vacías en la descripción).
    description = limpiar_texto(item_data.get("description")) or title

    body: Dict[str, Any] = {
        "title": title,
        "category_id": category_id,
        "price": price,
        "currency_id": CURRENCY_ID_DEFAULT,
        "available_quantity": available_quantity,
        "buying_mode": BUYING_MODE_DEFAULT,
        "listing_type_id": listing_type_id,
        "condition": condition,
        "description": {"plain_text": description},
        # Envío: modo neutro + retiro en persona (default de la spec de ML).
        "shipping": {"mode": "not_specified", "local_pick_up": True},
    }

    # Pictures: ÚNICA clave de imágenes, normalizada al formato oficial
    # [{"source": url}]. Sin fotos públicas NO se envía la clave (jamás un
    # {"source": None}, que ML rechaza con "body.invalid_fields").
    pictures = normalizar_pictures(item_data.get("pictures"))
    if pictures:
        body["pictures"] = pictures

    # Attributes: solo IDs válidos con valor. Por defecto BRAND y MODEL; los
    # obligatorios de la categoría los agrega mercadolibre_atributos.py
    # consultando el catálogo real, nunca por suposición.
    attributes = normalizar_attributes(item_data.get("attributes"))
    if attributes:
        body["attributes"] = attributes

    # Sale terms: solo términos del catálogo (WARRANTY_TYPE / WARRANTY_TIME).
    # La clave raíz "warranty" NO existe en POST /items: se omite siempre.
    sale_terms = normalizar_sale_terms(item_data.get("sale_terms"))
    if sale_terms:
        body["sale_terms"] = sale_terms

    # Whitelist final: cualquier clave fuera de la spec se descarta antes de
    # enviar la petición (origen real del 400 "body.invalid_fields").
    body = {
        clave: valor for clave, valor in body.items()
        if clave in CAMPOS_PERMITIDOS_ML
    }

    # Pre-validación local: si algo obligatorio quedó nulo/vacío, se aborta con
    # un mensaje que nombra el campo exacto en vez de esperar el 400 de ML.
    faltantes = [
        campo for campo in CAMPOS_REQUERIDOS_ML
        if body.get(campo) in (None, "", 0, [])
    ]
    if faltantes:
        raise ValueError(
            "Mercado Libre requiere especificar: [{}]".format(" / ".join(faltantes))
        )

    return body
