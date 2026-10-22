"""
Payload y errores de la publicación en Mercado Libre (POST /items).

Centraliza DOS responsabilidades que estaban mezcladas dentro de
mercadolibre_api.py:

1. ARMADO DEL BODY con TODOS los campos obligatorios. Mercado Libre responde
   HTTP 400 "body.required_fields" cuando falta cualquier campo de primer nivel,
   por lo que el body se completa siempre con:
     currency_id='ARS', buying_mode='buy_it_now', listing_type_id='bronze',
     condition ('nuevo' → 'new', cualquier otro estado → 'used'),
     available_quantity (objeto.cantidad o 1) y category_id obligatorio.
   "pictures" solo se envía si hay URLs públicas: nunca se mandan nulos.

2. EXTRACCIÓN DE ERRORES de Mercado Libre (HTTP 400/422): normaliza las causas
   y devuelve el campo exacto que falta, para responderle al frontend
   "Mercado Libre requiere especificar: [condition / pictures / category_id]"
   en lugar de un error genérico.

Usado por:
- inventario/services/mercadolibre_api.py (create_item + logging).
- inventario/api/viewsets/mercadolibre_views.py (publicar_item).
"""

import json
import logging
import re
from typing import Any, Dict

from .mercadolibre_imagenes import normalizar_pictures

logger = logging.getLogger(__name__)

# =============================================================================
# VALORES POR DEFECTO DEL PAYLOAD DE POST /items
# =============================================================================
CURRENCY_ID_DEFAULT = "ARS"          # MLA (Argentina) opera en pesos
BUYING_MODE_DEFAULT = "buy_it_now"   # compra inmediata
LISTING_TYPE_DEFAULT = "bronze"      # exposición clásica gratuita (configurada)
AVAILABLE_QUANTITY_DEFAULT = 1       # stock mínimo publicable
CONDITION_DEFAULT = "used"           # el inventario es de segunda mano por defecto

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


def extraer_error_ml(result: Any) -> Dict[str, Any]:
    """
    Normaliza el error devuelto por Mercado Libre (HTTP 400/422).

    Returns:
        {
          "mensaje": str,   # texto listo para mostrarle al usuario
          "campos": list,   # campos que ML exige y no llegaron en el body
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

    if campos:
        mensaje = "Mercado Libre requiere especificar: [{}]".format(" / ".join(campos))
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

    return {"mensaje": mensaje, "campos": campos, "detalles": detalles}


def construir_payload_item(item_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Arma el body COMPLETO de POST /items con todos los campos obligatorios.

    Mercado Libre responde HTTP 400 "body.required_fields" si falta un campo de
    primer nivel, por eso este builder garantiza SIEMPRE:

      - currency_id        → ARS (o el pedido en item_data)
      - buying_mode        → buy_it_now
      - listing_type_id    → bronze (LISTING_TYPE_DEFAULT)
      - condition          → 'new' si el estado es nuevo, si no 'used'
      - available_quantity → el enviado o 1
      - pictures           → [{"source": "https://..."}] solo si hay URLs
                             públicas; si no hay fotos NO se envía la clave
                             (nunca se mandan elementos nulos)
      - category_id        → obligatorio; sin categoría se aborta con un
                             ValueError descriptivo (la vista la predice antes)

    Raises:
        ValueError: si falta el título, la categoría o el precio es inválido.
    """
    if not isinstance(item_data, dict):
        item_data = {}

    # Título: truncado estricto a 60 caracteres (límite de la API de ML)
    title = str(item_data.get("title") or "").strip()[:60]
    if not title:
        raise ValueError("El título es obligatorio para publicar en Mercado Libre.")

    # Categoría: NUNCA nula (la resolución/predicción es responsabilidad de la vista)
    category_id = str(item_data.get("category_id") or "").strip().upper()
    if not category_id:
        raise ValueError("Falta asignar una categoría de Mercado Libre al objeto.")

    # Precio: float válido y estrictamente mayor a 0
    try:
        price = float(item_data.get("price"))
    except (TypeError, ValueError):
        raise ValueError("El precio debe ser un número válido.")
    if price <= 0:
        raise ValueError("El precio debe ser mayor a 0 para publicar en Mercado Libre.")

    # Condición: solo valores nativos aceptados por MLA
    condition = mapear_condition_ml(item_data.get("condition")) or CONDITION_DEFAULT

    # Stock: entero >= 1
    try:
        available_quantity = int(
            item_data.get("available_quantity") or AVAILABLE_QUANTITY_DEFAULT
        )
    except (TypeError, ValueError):
        available_quantity = AVAILABLE_QUANTITY_DEFAULT
    if available_quantity < 1:
        available_quantity = AVAILABLE_QUANTITY_DEFAULT

    currency_id = str(item_data.get("currency_id") or CURRENCY_ID_DEFAULT).strip().upper()
    buying_mode = str(item_data.get("buying_mode") or BUYING_MODE_DEFAULT).strip()
    listing_type_id = str(
        item_data.get("listing_type_id") or LISTING_TYPE_DEFAULT
    ).strip()

    body: Dict[str, Any] = {
        "title": title,
        "category_id": category_id,
        "price": price,
        "currency_id": currency_id or CURRENCY_ID_DEFAULT,
        "available_quantity": available_quantity,
        "buying_mode": buying_mode or BUYING_MODE_DEFAULT,
        "listing_type_id": listing_type_id or LISTING_TYPE_DEFAULT,
        "condition": condition,
        # Mercado Envíos (ME2): bloque estándar para limpiar las advertencias
        # obligatorias de shipping que arroja el log de MLA.
        "shipping": {
            "mode": "me2",
            "local_pick_up": True,
            "free_shipping": False,
        },
    }

    descripcion = str(item_data.get("description") or "").strip()
    if descripcion:
        body["description"] = {"plain_text": descripcion}

    # Pictures: ÚNICA clave de imágenes en la raíz, normalizada estrictamente
    # al formato [{"source": url}] que exige MLA. Sin fotos públicas no se
    # envía la clave (jamás un {"source": None}).
    pictures = normalizar_pictures(item_data.get("pictures"))
    if pictures:
        body["pictures"] = pictures

    # Attributes: descartar entradas sin id o sin valor (MLA las rechaza)
    attributes = [
        atributo
        for atributo in (item_data.get("attributes") or [])
        if isinstance(atributo, dict)
        and atributo.get("id")
        and (atributo.get("value_name") or atributo.get("value_id"))
    ]
    if attributes:
        body["attributes"] = attributes

    if item_data.get("warranty"):
        body["warranty"] = item_data["warranty"]

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
