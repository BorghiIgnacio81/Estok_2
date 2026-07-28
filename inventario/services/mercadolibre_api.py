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

    # ML acepta imágenes por URL en el campo "source"
    body = {"source": image_url}

    result = _api_request("POST", "/pictures", access_token, body)
    if result and "id" in result:
        logger.info("Foto subida a ML: picture_id=%s", result["id"])
        return result["id"]

    logger.error("Error al subir foto a ML: %s", result)
    return None


def create_item(user, item_data: Dict[str, Any]) -> Optional[dict]:
    """
    Crea una publicación en MercadoLibre.

    Args:
        user: Usuario autenticado (dueño del token OAuth)
        item_data: Dict con:
            - title (str): Título del producto
            - category_id (str): ID de categoría de ML (ej: "MLU3530" para Notebooks)
            - price (float): Precio en la moneda local
            - currency_id (str): "USD", "ARS", etc.
            - available_quantity (int): Stock disponible (default 1)
            - buying_mode (str): "buy_it_now"
            - listing_type_id (str): "gold_special", "gold_pro", etc.
            - condition (str): "new" o "used"
            - description (str): Descripción en texto plano
            - pictures (list): Lista de {"source": "url"} o {"id": "picture_id"}
            - video_id (str, opcional)
            - warranty (str, opcional)
            - attributes (list, opcional): Atributos de categoría

    Returns:
        Dict con la respuesta de ML (id, permalink, status, etc.) o None si falla.
    """
    access_token = get_valid_access_token(user)
    if not access_token:
        logger.warning("No hay access_token para el usuario %s", user.username)
        return None

    # Valores por defecto
    body = {
        "title": item_data.get("title", ""),
        "category_id": item_data.get("category_id", "MLA1747"),  # Argentina - Otros por defecto
        "price": item_data.get("price", 0),
        "currency_id": item_data.get("currency_id", "USD"),
        "available_quantity": item_data.get("available_quantity", 1),
        "buying_mode": item_data.get("buying_mode", "buy_it_now"),
        "listing_type_id": item_data.get("listing_type_id", "free"),
        "condition": item_data.get("condition", "used"),
    }

    if item_data.get("description"):
        body["description"] = {"plain_text": item_data["description"]}

    if item_data.get("pictures"):
        body["pictures"] = item_data["pictures"]

    if item_data.get("attributes"):
        body["attributes"] = item_data["attributes"]

    if item_data.get("warranty"):
        body["warranty"] = item_data["warranty"]

    result = _api_request("POST", "/items", access_token, body)
    if result and "id" in result:
        logger.info(
            "Ítem creado en ML: id=%s, permalink=%s",
            result["id"],
            result.get("permalink", "N/A"),
        )
        return result

    logger.error("Error al crear ítem en ML: %s", result)
    return result  # Retornar el error para diagnóstico