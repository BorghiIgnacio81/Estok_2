"""
Payload y errores de la publicación en Mercado Libre (POST /items).

Centraliza DOS responsabilidades que estaban mezcladas en mercadolibre_api.py:

1. ARMADO DEL BODY con saneamiento integral. Se envía ÚNICAMENTE el conjunto de
   campos de primer nivel que acepta POST /items (whitelist CAMPOS_PERMITIDOS_ML)
   con los tipos exactos de la API: ML responde 400 "body.invalid_fields" por una
   clave ajena al recurso (bugs reales: "warranty", "description") y
   "body.required_fields" si falta un obligatorio (ej: [family_name] en MLA49337).
   El body garantiza currency_id='ARS', buying_mode='buy_it_now', listing_type_id
   válido, condition 'new'/'used', available_quantity ≥ 1, title de 15 a 60
   caracteres y shipping con retiro en persona. "pictures" solo con URLs HTTPS
   públicas y "attributes" solo con valores válidos (obligatorios del catálogo).

   `family_name` viaja en la RAÍZ (ML lo exige en categorías como MLA49337) y
   NUNCA como atributo FAMILY_NAME en "attributes". La DESCRIPCIÓN, en cambio,
   no viaja acá: `descripcion_publicable()` la devuelve y `create_item()` la
   envía DESPUÉS del 201 con POST /items/{item_id}/description.

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

from .mercadolibre_imagenes import normalizar_pictures, normalizar_url
from .mercadolibre_saneamiento import (
    normalizar_attributes,
    normalizar_category_id,
    normalizar_precio,
    normalizar_sale_terms,
    family_name_publicable,
    formatear_titulo,
    validar_titulo,
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
# "family_name" SÍ es una propiedad de la raíz (MLA49337 la exige), pero
# "description" NO: la descripción va a POST /items/{id}/description.
CAMPOS_PERMITIDOS_ML = (
    "title",
    "category_id",
    "price",
    "currency_id",
    "available_quantity",
    "buying_mode",
    "listing_type_id",
    "condition",
    "pictures",
    "attributes",
    "family_name",
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


def _pictures_publicables(pictures) -> list:
    """
    Imágenes publicables: [{"source": "https://..."}] estrictamente HTTPS.

    Devuelve solo URLs absolutas descargables por ML (hosts públicos). Si el
    objeto no tiene fotos válidas se usa la imagen por defecto configurada en
    settings.MERCADOLIBRE_DEFAULT_PICTURE_URL; si tampoco hay, devuelve [] y la
    clave "pictures" NO se envía (nunca elementos nulos ni rutas relativas).
    """
    validas = normalizar_pictures(pictures)
    if validas:
        return validas

    por_defecto = normalizar_url(
        getattr(settings, "MERCADOLIBRE_DEFAULT_PICTURE_URL", "")
    )
    if por_defecto:
        logger.info("Sin fotos públicas: se usa la imagen por defecto %s", por_defecto)
        return [{"source": por_defecto}]

    logger.warning(
        "Sin fotos públicas para publicar: la clave 'pictures' no se envía "
        "(MERCADOLIBRE_DEFAULT_PICTURE_URL sin configurar)."
    )
    return []


def extraer_causas_ml(result: Any) -> list:
    """
    Arreglo `cause` (o `causes`) TAL CUAL lo devuelve Mercado Libre: fuente de
    verdad del campo rechazado (se loguea y se devuelve al frontend).

    ML también responde 400 con `cause: []` y el motivo SOLO en `error` /
    `message` (ej: "The fields [title] are invalid..."): en ese caso se
    sintetiza una causa para que el diagnóstico y los reintentos vean el campo.
    """
    if not isinstance(result, dict):
        return []
    causas = result.get("cause") or result.get("causes") or []
    if isinstance(causas, list) and causas:
        return causas

    mensaje = str(result.get("error") or result.get("message") or "").strip()
    if not mensaje:
        return []
    # Solo se sintetiza para respuestas REALES de ML (400/422 con `message` y/o
    # `status`). Los errores de red ({"error": "..."}) se dejan sin causas.
    if not result.get("message") and not result.get("status"):
        return []
    texto = mensaje.lower()
    if "invalid" in texto or "no es válido" in texto or "no válido" in texto:
        codigo = "body.invalid_fields"
    else:
        codigo = str(result.get("message") or "body.required_fields").strip()
    return [{"code": codigo, "message": mensaje}]


def solo_campos_permitidos(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Descarta cualquier clave de primer nivel fuera de la spec de POST /items.

    Se aplica al body FINAL (y antes de cada reintento): una sola clave
    inventada (ej: "warranty", "family_name" o "description" en la raíz) hace
    que Mercado Libre responda HTTP 400 "body.invalid_fields". Solo las claves
    de CAMPOS_PERMITIDOS_ML llegan a la API.
    """
    return {
        clave: valor for clave, valor in (body or {}).items()
        if clave in CAMPOS_PERMITIDOS_ML
    }


def _causes_ml(result: Any) -> list:
    """Lista de causas (dicts) de una respuesta de error de Mercado Libre."""
    return [causa for causa in extraer_causas_ml(result) if isinstance(causa, dict)]


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

    ML rechaza la publicación con 400 "body.invalid_fields" por claves o tipos
    ajenos al recurso y "body.required_fields" si falta un obligatorio, por eso
    el body final cumple estrictamente:

      - title              → 15 a 60 caracteres (se completa con datos reales
                             del objeto si es más corto)
      - category_id        → MLA + dígitos; se aborta si no es válido (la vista
                             resuelve la categoría hoja y la predicción)
      - price              → float > 0; se aborta si es <= 0 (no se inventa)
      - available_quantity → int >= 1
      - condition          → 'new' si el estado es nuevo, si no 'used'
      - family_name        → raíz del ítem (nombre/marca/título, ≤ 60); ML lo
                             exige en categorías como MLA49337 (GPS)
      - pictures           → [{"source": "https://..."}] solo si hay URLs
                             públicas; sin fotos NO se envía la clave
      - attributes         → solo atributos válidos (BRAND / MODEL por defecto)
      - shipping           → {"mode": "not_specified", "local_pick_up": True}
      - sale_terms         → solo si se especifican términos válidos
      - Cualquier otra clave se descarta (whitelist CAMPOS_PERMITIDOS_ML).

    "description" NO se envía: se publica aparte con `descripcion_publicable()`
    (POST /items/{item_id}/description) después del 201.

    Raises:
        ValueError: título vacío o fuera de rango, categoría inválida, precio
            inválido o payload incompleto (mensaje listo para el frontend).
    """
    if not isinstance(item_data, dict):
        item_data = {}

    # Condición: solo valores nativos ('usado' en español jamás llega a ML).
    # Se calcula ANTES del título porque es uno de los datos que completa un
    # título demasiado corto ("... Usado").
    condition = mapear_condition_ml(item_data.get("condition")) or CONDITION_DEFAULT

    # Título: entre 15 y 60 caracteres. Si el título del inventario es más
    # corto que el mínimo de ML se completa con datos REALES del objeto (marca,
    # modelo, tipo de vehículo, categoría y condición) y se recorta en 60 sin
    # cortar palabras a la mitad.
    title = formatear_titulo(
        item_data.get("title"),
        condition=condition,
        marca=item_data.get("marca"),
        modelo=item_data.get("modelo"),
        categoria=item_data.get("categoria_nombre"),
    )
    error_titulo = validar_titulo(title)
    if error_titulo:
        raise ValueError(error_titulo)

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

    # Tipo de publicación: se respeta solo si es un valor válido de ML; si no,
    # se usa el configurado (settings) o gold_special.
    listing_type_id = str(item_data.get("listing_type_id") or "").strip().lower()
    if listing_type_id not in LISTING_TYPES_VALIDOS:
        listing_type_id = _listing_type_configurado()

    body: Dict[str, Any] = {
        "title": title,
        "category_id": category_id,
        "price": price,
        "currency_id": CURRENCY_ID_DEFAULT,
        "available_quantity": available_quantity,
        "buying_mode": BUYING_MODE_DEFAULT,
        "listing_type_id": listing_type_id,
        "condition": condition,
        # Envío: modo neutro + retiro en persona (default de la spec de ML).
        "shipping": {"mode": "not_specified", "local_pick_up": True},
    }

    # family_name: propiedad de la RAÍZ que ML exige en categorías como
    # MLA49337 (GPS) con 400 "body.required_fields" si falta. Se usa el nombre
    # REAL del objeto ("GPS Garmin") o, si no hay, la marca / el título. NO se
    # envía además como atributo FAMILY_NAME dentro de "attributes".
    family_name = family_name_publicable(item_data, item_data.get("title"))
    if family_name:
        body["family_name"] = family_name

    # NOTA: "description" NO se agrega al body (ML lo rechaza con 400
    # "body.invalid_fields"): se crea después del 201 en /items/{id}/description.

    # Pictures: ÚNICA clave de imágenes, normalizada al formato oficial
    # [{"source": "https://..."}] (absoluta y HTTPS). Sin fotos públicas NO se
    # envía la clave —jamás un {"source": None}— salvo que exista una imagen por
    # defecto configurada en MERCADOLIBRE_DEFAULT_PICTURE_URL.
    pictures = _pictures_publicables(item_data.get("pictures"))
    if pictures:
        body["pictures"] = pictures

    # Attributes: solo atributos con VALOR REAL. No se inventan claves ni se
    # rellenan con "Genérico" para categorías que no los exigen (esa era una
    # fuente real de rechazos). Los obligatorios de la categoría los agrega
    # mercadolibre_atributos.py consultando el catálogo real.
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
    body = solo_campos_permitidos(body)

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
