"""
Política de publicación de una categoría de Mercado Libre (GET /categories/{id}).

Mercado Libre informa en `settings` de cada categoría las reglas que modifican el
body de POST /items:

    settings.catalog_domain  → la categoría pertenece a un DOMINIO DE CATÁLOGO
        (ej: MLA49337 "Equipos GPS" → MLA-VEHICLE_GPS). En estas categorías ML
        CONSTRUYE el título a partir de `family_name` + atributos
        (/decorations/build-title) y RECHAZA el campo "title" del body con
        HTTP 400 "body.invalid_fields: The fields [title] are invalid for
        requested call". VERIFICADO contra la API real (endpoint de validación):
        el mismo body SIN "title" pasa la validación; con "title" falla.
    settings.item_conditions → condiciones aceptadas (ej: ["new"]). Enviar una
        condición fuera de esa lista produce HTTP 400.

La consulta es pública (el token es opcional) y se cachea en memoria por
categoría para no golpear la API en cada publicación.

Usado por:
- inventario/services/mercadolibre_api.py (create_item).
"""

import json
import logging
import time
import urllib.parse
import urllib.request
from typing import Dict

from .mercadolibre_prediccion import ML_API_BASE
from .mercadolibre_payload import campos_requeridos_faltantes, extraer_causas_ml
from .mercadolibre_saneamiento import ampliar_family_name

logger = logging.getLogger(__name__)

TIMEOUT_CATEGORIA = 10      # segundos por consulta a /categories/{id}
ENFRIAMIENTO_FALLO = 300    # segundos sin reintentar una categoría que falló

# Caché en memoria: category_id → dict de política.
_CACHE: Dict[str, dict] = {}
_FALLOS: Dict[str, float] = {}

POLITICA_VACIA: dict = {
    "catalog_domain": "",
    "item_conditions": [],
    "max_title_length": 0,
    "listing_allowed": None,
}


def obtener_politica_categoria(category_id, access_token: str = "") -> dict:
    """
    Política publicable de la categoría (catálogo, condiciones, largo de título).

    Nunca lanza excepción: si la API no responde devuelve POLITICA_VACIA y el
    llamador se comporta como siempre (título propio + condición pedida).
    """
    cid = str(category_id or "").strip().upper()
    if not cid:
        return dict(POLITICA_VACIA)
    if cid in _CACHE:
        return _CACHE[cid]

    ultimo_fallo = _FALLOS.get(cid)
    if ultimo_fallo and (time.time() - ultimo_fallo) < ENFRIAMIENTO_FALLO:
        return dict(POLITICA_VACIA)

    url = f"{ML_API_BASE}/categories/{urllib.parse.quote(cid)}"
    headers = {"Accept": "application/json"}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=TIMEOUT_CATEGORIA) as respuesta:
            data = json.loads(respuesta.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - la publicación debe seguir
        logger.warning("No se pudo leer la política de la categoría %s: %s", cid, exc)
        _FALLOS[cid] = time.time()
        return dict(POLITICA_VACIA)

    settings = data.get("settings") if isinstance(data, dict) else None
    if not isinstance(settings, dict):
        settings = {}

    politica = {
        "catalog_domain": str(settings.get("catalog_domain") or "").strip(),
        "item_conditions": [
            str(condicion).strip()
            for condicion in (settings.get("item_conditions") or [])
            if str(condicion).strip()
        ],
        "max_title_length": int(settings.get("max_title_length") or 0),
        "listing_allowed": settings.get("listing_allowed"),
    }
    _CACHE[cid] = politica
    _FALLOS.pop(cid, None)
    logger.info(
        "Política ML de la categoría %s: catalog_domain=%s | item_conditions=%s",
        cid, politica["catalog_domain"] or "-", politica["item_conditions"] or "-",
    )
    return politica


def construye_titulo_ml(category_id, access_token: str = "") -> bool:
    """
    True si Mercado Libre arma el título (categoría con `catalog_domain`).

    En ese caso el body de POST /items NO debe incluir "title": ML lo genera a
    partir de `family_name` + atributos y rechaza cualquier título enviado.
    """
    politica = obtener_politica_categoria(category_id, access_token)
    return bool(politica.get("catalog_domain"))


def condition_publicable(category_id, condition: str, access_token: str = "") -> str:
    """
    Condición aceptada por la categoría (la pedida si está permitida).

    MLA49337, por ejemplo, solo acepta "new": publicar "used" ahí devuelve 400.
    Si la categoría no informa condiciones, se respeta la condición pedida.
    """
    permitidas = obtener_politica_categoria(category_id, access_token).get(
        "item_conditions"
    ) or []
    condicion = str(condition or "").strip()
    if permitidas and condicion not in permitidas:
        logger.warning(
            "La categoría %s solo acepta condition %s: se publica como %s "
            "(Mercado Libre rechaza %s).",
            category_id, permitidas, permitidas[0], condicion or "sin condición",
        )
        return permitidas[0]
    return condicion


def ajustar_por_causas_titulo(result, body: dict, item_data, titulo_omitido: str = ""):
    """
    Ajusta el body cuando ML rechaza o exige el título en una categoría de catálogo.

    - `item.title.minimum_length` con el título omitido → el título que arma ML
      desde `family_name` es pobre: se amplía la familia con datos reales.
    - `body.required_fields` pidiendo [title] con el título omitido → la
      categoría no construye el título (política desactualizada): se reinyecta
      el título calculado por Estok.

    Devuelve (reintentar, titulo_omitido); `reintentar=True` = el body cambió y
    hay que volver a hacer POST /items.
    """
    if not isinstance(result, dict):
        return False, titulo_omitido

    causes = [
        causa for causa in extraer_causas_ml(result) if isinstance(causa, dict)
    ]

    if "title" not in body and any(
        "title.minimum_length" in str(causa.get("code") or "") for causa in causes
    ):
        familia = ampliar_family_name(body.get("family_name", ""), item_data)
        if familia and familia != body.get("family_name"):
            logger.info(
                "ML pide un título más descriptivo → family_name '%s'", familia
            )
            body["family_name"] = familia
            return True, titulo_omitido

    if titulo_omitido and "title" in campos_requeridos_faltantes(result):
        body["title"] = titulo_omitido
        logger.info(
            "ML exige 'title' en esta categoría: se reinyecta el título "
            "calculado por Estok."
        )
        return True, ""

    return False, titulo_omitido
