"""
Predicción de la categoría de Mercado Libre a partir de un texto.

Se usa para mapear el NOMBRE de una categoría del inventario (ej: "Libros y
Revistas") a su ID real de Mercado Libre (formato MLAxxxxx).

IMPORTANTE: el texto debe ser el NOMBRE DE LA CATEGORÍA, nunca el título del
objeto. Predecir con el título desviaba publicaciones a categorías absurdas
(verificado contra la API real: "Garfield comic historieta" → "Diseño y
Edición" / "Tartas y Tortas Dulces").

Cadena de intentos (degradación controlada, nunca lanza excepción):
  1. /sites/MLA/category_predictor/predict  → endpoint OFICIAL de predicción.
     VERIFICADO (2026): hoy responde HTTP 404 sin credenciales (deprecado
     públicamente para MLA), por eso hay un segundo intento.
  2. /sites/MLA/domain_discovery/search     → VERIFICADO operativo y público
     (ej: "Libros" → MLA412445 "Libros Físicos").
"""

import json
import logging
import urllib.parse
import urllib.request
from typing import Optional

logger = logging.getLogger(__name__)

# Base de la API pública de Mercado Libre (usada por todo el servicio).
ML_API_BASE = "https://api.mercadolibre.com"


def _predict_con_predictor_oficial(texto: str, site: str, timeout: int,
                                   access_token: Optional[str] = None) -> Optional[str]:
    """
    GET /sites/{site}/category_predictor/predict?title=<texto>

    Endpoint oficial de predicción de Mercado Libre. Devuelve el category_id
    sugerido o None si no responde.
    """
    q = urllib.parse.quote(texto[:200])
    url = f"{ML_API_BASE}/sites/{site}/category_predictor/predict?title={q}"
    headers = {"Accept": "application/json"}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - se degrada al siguiente intento
        logger.info("Predictor oficial de ML no disponible (%s): %s", url, exc)
        return None

    if isinstance(data, dict):
        for clave in ("id", "category_id"):
            cat_id = data.get(clave)
            if cat_id:
                logger.info(
                    "Categoría predicha (predictor oficial) para '%s': %s",
                    texto[:50], cat_id,
                )
                return cat_id
    return None


def _predict_con_domain_discovery(texto: str, site: str, timeout: int,
                                  access_token: Optional[str] = None) -> Optional[str]:
    """
    GET /sites/{site}/domain_discovery/search?q=<texto>&limit=1

    Búsqueda pública de dominio: devuelve la categoría hoja más cercana al
    texto (ej: "Libros" → MLA412445 "Libros Físicos").
    """
    q = urllib.parse.quote(texto[:200])
    url = f"{ML_API_BASE}/sites/{site}/domain_discovery/search?q={q}&limit=1"
    headers = {"Accept": "application/json"}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - el llamador decide el default
        logger.warning("domain_discovery no disponible para '%s': %s", texto[:50], exc)
        return None

    if isinstance(data, list):
        for item in data:
            cat_id = item.get("category_id")
            if cat_id:
                logger.info(
                    "Categoría predicha (domain_discovery) para '%s': %s (%s)",
                    texto[:50], cat_id, item.get("category_name", ""),
                )
                return cat_id
    return None


def predict_category(title: str, site: str = "MLA", timeout: int = 10,
                     access_token: Optional[str] = None) -> Optional[str]:
    """
    Predice la categoría de Mercado Libre más adecuada para un texto.

    Args:
        title: NOMBRE de la categoría del inventario (o, en última instancia,
            un título). Nunca el título del objeto al publicar.
        site: sitio de Mercado Libre (MLA = Argentina).
        timeout: segundos de espera por intento.
        access_token: token OAuth opcional (el predictor oficial puede exigirlo).

    Returns:
        category_id en formato MLAxxxxx, o None si ningún intento respondió.
    """
    texto = str(title or "").strip()
    if not texto:
        return None

    for intento in (_predict_con_predictor_oficial, _predict_con_domain_discovery):
        cat_id = intento(texto, site, timeout, access_token)
        if cat_id:
            return str(cat_id).strip().upper()

    logger.warning("No se pudo predecir categoría de ML para '%s'", texto[:50])
    return None
