"""
Servicio para interactuar con la API de MercadoLibre.
- Subir fotos (POST /pictures)
- Crear publicaciones (POST /items)
"""

import logging
import json
import urllib.request
import urllib.parse
from typing import Optional, Dict, Any

from .mercadolibre_oauth import get_valid_access_token

logger = logging.getLogger(__name__)

ML_API_BASE = "https://api.mercadolibre.com"


def _api_request(method: str, endpoint: str, access_token: str, body: Optional[dict] = None) -> Optional[dict]:
    """
    Realiza una request autenticada a la API de MercadoLibre.
    Retorna la respuesta como dict o None si falla.
    """
    url = f"{ML_API_BASE}{endpoint}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    }

    data = None
    if body:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")

    try:
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else "sin cuerpo"
        logger.error("ML API Error %d %s: %s", e.code, e.reason, error_body)
        try:
            return json.loads(error_body)
        except json.JSONDecodeError:
            return {"error": f"HTTP {e.code}: {e.reason}", "detail": error_body[:500]}
    except Exception as e:
        logger.error("ML API Exception: %s", e)
        return {"error": str(e)}


def upload_picture(user, image_url: str) -> Optional[str]:
    """
    Sube una foto a MercadoLibre desde una URL pública.
    ML requiere que la imagen ya esté accesible públicamente.
    Retorna el picture_id o None si falla.
    """
    access_token = get_valid_access_token(user)
    if not access_token:
        logger.warning("No hay access_token para el usuario %s", user.username)
        return None

    logger.info("Intentando subir foto a ML desde URL: %s", image_url[:150])

    # ML acepta imágenes por URL en el campo "source"
    body = {"source": image_url}

    result = _api_request("POST", "/pictures", access_token, body)
    if result and "id" in result:
        logger.info("Foto subida a ML: picture_id=%s", result["id"])
        return result["id"]

    logger.error("Error al subir foto a ML. URL=%s, Response=%s", image_url[:150], result)
    return None


def predict_category(title: str, site: str = "MLA") -> Optional[str]:
    """
    Predice la categoría de MercadoLibre más adecuada según el título del producto.
    Usa la API pública de ML (no requiere autenticación).
    Retorna el category_id de una categoría hoja, o None si no puede predecir.
    """
    import urllib.parse
    try:
        q = urllib.parse.quote(title[:200])
        url = f"https://api.mercadolibre.com/sites/{site}/domain_discovery/search?q={q}&limit=1"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        
        if data and isinstance(data, list):
            for item in data:
                cat_id = item.get("category_id")
                if cat_id:
                    logger.info("Categoría predicha para '%s': %s (%s)", 
                                title[:50], cat_id, item.get("category_name", ""))
                    return cat_id
    except Exception as e:
        logger.warning("No se pudo predecir categoría: %s", e)
    
    return None


def construir_attributes_desde_objeto(objeto) -> list:
    """
    Construye la lista "attributes" de la API de MercadoLibre a partir de un
    Objeto de inventario, omitiendo campos nulos o vacíos para no romper la
    validación de la categoría (evita el 400 "Validation error").

    - Categorías de tecnología (Computación/Electrónica): marca → BRAND,
      modelo → MODEL.
    - Libros/revistas (detectados por autor/editorial/isbn): autor → AUTHOR,
      editorial → PUBLISHER.
    """
    attributes: list = []
    if objeto is None:
        return attributes

    es_tecnologia = False
    if objeto.categoria:
        nombre = (objeto.categoria.nombre or '').strip().lower()
        meli_id = (objeto.categoria.meli_category_id or '').strip().upper()
        es_tecnologia = (
            nombre in ('computación', 'computacion', 'electrónica', 'electronica')
            or meli_id in ('MLA1648', 'MLA1051')
        )

    es_libro = bool(
        getattr(objeto, 'autor', '') or getattr(objeto, 'editorial', '')
        or getattr(objeto, 'isbn_issn', '')
    )

    marca = (getattr(objeto, 'marca', '') or '').strip()
    modelo = (getattr(objeto, 'modelo', '') or '').strip()
    autor = (getattr(objeto, 'autor', '') or '').strip()
    editorial = (getattr(objeto, 'editorial', '') or '').strip()

    if es_tecnologia:
        if marca:
            attributes.append({"id": "BRAND", "value_name": marca})
        if modelo:
            attributes.append({"id": "MODEL", "value_name": modelo})
    elif es_libro:
        if autor:
            attributes.append({"id": "AUTHOR", "value_name": autor})
        if editorial:
            attributes.append({"id": "PUBLISHER", "value_name": editorial})

    return attributes


def create_item(user, item_data: Dict[str, Any]) -> Optional[dict]:
    """
    Crea una publicación en MercadoLibre.

    Args:
        user: Usuario autenticado (dueño del token OAuth)
        item_data: Dict con:
            - title (str): Título del producto (se trunca a 60 caracteres)
            - category_id (str): ID de categoría de ML (ej: "MLA1648" para Computación)
            - price (float): Precio en ARS (debe ser mayor a 0)
            - available_quantity (int): Stock disponible (default 1)
            - condition (str): "new" o "used" (default "used")
            - description (str): Descripción en texto plano
            - pictures (list): Lista de {"source": "url"} o {"id": "picture_id"}
            - video_id (str, opcional)
            - warranty (str, opcional)
            - attributes (list, opcional): Atributos de categoría

        El servicio fuerza: currency_id="ARS", buying_mode="buy_it_now" y
        listing_type_id="bronze" (exposición clásica gratuita / baja comisión).

    Returns:
        Dict con la respuesta de ML (id, permalink, status, etc.) o None si falla.

    Raises:
        ValueError: si el título está vacío, el precio no es numérico o es <= 0.
    """
    access_token = get_valid_access_token(user)
    if not access_token:
        logger.warning("No hay access_token para el usuario %s", user.username)
        return None

    # =====================================================================
    # BLINDAJE DEL PAYLOAD (anti 400 "Validation error" de MLA)
    # =====================================================================
    # Título: truncado estricto a 60 caracteres (límite de la API de ML)
    title = str(item_data.get("title") or "").strip()[:60]
    if not title:
        raise ValueError("El título es obligatorio para publicar en Mercado Libre.")

    # Precio: float válido y estrictamente mayor a 0
    try:
        price = float(item_data.get("price"))
    except (TypeError, ValueError):
        raise ValueError("El precio debe ser un número válido.")
    if price <= 0:
        raise ValueError("El precio debe ser mayor a 0 para publicar en Mercado Libre.")

    # Condición: solo valores nativos aceptados por MLA ("used" para inventario usado)
    condition = str(item_data.get("condition") or "used").strip().lower()
    if condition not in ("new", "used"):
        condition = "used"

    # Moneda: MLA Argentina opera estrictamente en ARS
    body = {
        "title": title,
        "category_id": item_data.get("category_id", "MLA1747"),  # Argentina - Otros por defecto
        "price": price,
        "currency_id": "ARS",
        "available_quantity": int(item_data.get("available_quantity", 1) or 1),
        "buying_mode": "buy_it_now",
        "listing_type_id": "bronze",  # Exposición clásica gratuita / baja comisión
        "condition": condition,
    }

    if item_data.get("description"):
        body["description"] = {"plain_text": item_data["description"]}

    if item_data.get("pictures"):
        body["pictures"] = item_data["pictures"]

    if item_data.get("attributes"):
        body["attributes"] = item_data["attributes"]

    if item_data.get("warranty"):
        body["warranty"] = item_data["warranty"]

    MAX_RETRIES = 3
    retry_count = 0
    
    while retry_count < MAX_RETRIES:
        result = _api_request("POST", "/items", access_token, body)
        retry_count += 1
        
        if result and result.get("id"):
            break  # Éxito
        
        if retry_count >= MAX_RETRIES:
            logger.error("Agotados %d reintentos. Último error: %s", MAX_RETRIES, result)
            break
        
        causes = result.get("cause", []) if result else []
        
        # Intento 1: predecir categoría hoja desde el título
        is_category_error = any(
            c.get("code") == "item.category_id.invalid" for c in causes
        )
        if is_category_error:
            title = item_data.get("title", "")
            predicted = predict_category(title) if title else None
            if predicted and predicted != body.get("category_id"):
                logger.info("Reintento %d: categoría predicha %s → %s", 
                            retry_count, body.get("category_id"), predicted)
                body["category_id"] = predicted
                continue
        
        # Intento 2: cambiar condition de used a new
        is_condition_error = any(
            c.get("code") == "item.condition.invalid" for c in causes
        )
        if is_condition_error and body.get("condition") == "used":
            logger.info("Reintento %d: condition used → new (cat %s solo acepta new)",
                        retry_count, body.get("category_id"))
            body["condition"] = "new"
            continue
        
        # Si el error no es de los que sabemos manejar, salir
        break
    
    if result and "id" in result:
        logger.info(
            "Ítem creado en ML: id=%s, permalink=%s",
            result["id"],
            result.get("permalink", "N/A"),
        )
        return result

    logger.error("Error al crear ítem en ML: %s", result)
    return result  # Retornar el error para diagnóstico
