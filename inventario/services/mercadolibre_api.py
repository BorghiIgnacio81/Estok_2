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
from .mercadolibre_payload import construir_payload_item, extraer_error_ml
from .mercadolibre_prediccion import ML_API_BASE, predict_category

logger = logging.getLogger(__name__)

# =============================================================================
# Categoría general por defecto de Mercado Libre Argentina (MLA) para cuando la
# API de predicción no responde o no encuentra coincidencia.
# MLA1383 = "Otros" (hoja dentro de Antigüedades y Colecciones). VERIFICADO en
# la API real: listing_allowed=true y acepta condition used/new/not_specified.
# NOTA: NO usar MLA1747 como "Otros": en la API real es "Repuestos Autos y
# Camionetas" con listing_allowed=false → publicar ahí produce HTTP 400.
# =============================================================================
CATEGORIA_MELI_DEFAULT = "MLA1383"


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


def construir_attributes_desde_objeto(objeto, category_id=None) -> list:
    """
    Construye la lista "attributes" de la API de MercadoLibre a partir de un
    Objeto de inventario, omitiendo campos nulos o vacíos para no romper la
    validación de la categoría (evita el 400 "Validation error").

    - Tecnología (Computación/Electrónica) y electrodomésticos/cocina:
      marca → BRAND y modelo → MODEL (rellenados con "Genérico"/"Sin
      especificar" si el formulario viene vacío).
    - Electrodomésticos/cocina (ej: MLA104680 Licuadoras): añade el atributo
      obligatorio POWER_SUPPLY_TYPE ("Batería recargable" si el título indica
      portátil/inalámbrico, si no "Corriente eléctrica").
    - Libros/revistas (detectados por autor/editorial/isbn): autor → AUTHOR,
      editorial → PUBLISHER.

    Args:
        objeto: Instancia de Objeto (puede ser None).
        category_id: ID final de categoría ML que viajará en el payload
            (ej: "MLA104680"), para detectar categorías de cocina que el
            inventario no mapea entre las 11 oficiales.
    """
    attributes: list = []
    if objeto is None:
        return attributes

    nombre = ''
    meli_id = ''
    if objeto.categoria:
        nombre = (objeto.categoria.nombre or '').strip().lower()
        meli_id = (objeto.categoria.mercadolibre_category_id or '').strip().upper()
    cid = str(category_id or '').strip().upper()

    es_tecnologia = (
        nombre in ('computación', 'computacion', 'electrónica', 'electronica')
        or meli_id in ('MLA1648', 'MLA1051')
        or cid in ('MLA1648', 'MLA1051')
    )

    es_cocina_electro = (
        nombre in ('cocina', 'electrodomésticos', 'electrodomesticos',
                   'electrodoméstico', 'electrodomestico', 'electro')
        or meli_id in ('MLA1403', 'MLA104680')
        or cid in ('MLA1403', 'MLA104680')
    )

    es_libro = bool(
        getattr(objeto, 'autor', '') or getattr(objeto, 'editorial', '')
        or getattr(objeto, 'isbn_issn', '')
    )

    marca = (getattr(objeto, 'marca', '') or '').strip()
    modelo = (getattr(objeto, 'modelo', '') or '').strip()
    autor = (getattr(objeto, 'autor', '') or '').strip()
    editorial = (getattr(objeto, 'editorial', '') or '').strip()

    if es_tecnologia or es_cocina_electro:
        # BRAND/MODEL: rellenar con texto genérico si el formulario viene vacío
        # para no faltar a requisitos obligatorios de estas categorías.
        attributes.append({"id": "BRAND", "value_name": marca or "Genérico"})
        attributes.append({"id": "MODEL", "value_name": modelo or "Sin especificar"})

    if es_cocina_electro:
        # POWER_SUPPLY_TYPE: atributo técnico obligatorio en electrodomésticos
        # de cocina (ej: licuadoras portátiles MLA104680).
        titulo = (getattr(objeto, 'nombre', '') or '').lower()
        es_portatil = any(
            k in titulo
            for k in ('portatil', 'portátil', 'inalambric', 'inalámbric',
                      'recargable', 'bateria', 'batería')
        )
        attributes.append({
            "id": "POWER_SUPPLY_TYPE",
            "value_name": "Batería recargable" if es_portatil else "Corriente eléctrica",
        })

    if es_libro:
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
            - pictures (list): Lista de dicts {"source": "url"} (formato único
              que acepta MLA; este servicio lo normaliza y deduplica)
            - categoria_nombre (str, opcional): nombre de la categoría del
              objeto, usado SOLO para el reintento cuando MLA rechaza el
              category_id (se predice desde el nombre de la categoría, jamás
              desde el título del ítem).
            - video_id (str, opcional)
            - warranty (str, opcional)
            - attributes (list, opcional): Atributos de categoría

        El servicio fuerza los defaults de Mercado Libre: currency_id="ARS",
        buying_mode="buy_it_now", listing_type_id="bronze" (exposición clásica
        gratuita / baja comisión), condition ("new" si el estado es nuevo, si no
        "used"), available_quantity (1 por defecto) y shipping mode="me2".

    Returns:
        Dict con la respuesta de ML (id, permalink, status, etc.) o None si falla.

    Raises:
        ValueError: si el título está vacío, falta la categoría, el precio no es
            numérico o es <= 0, o si el payload queda incompleto.
    """
    access_token = get_valid_access_token(user)
    if not access_token:
        logger.warning("No hay access_token para el usuario %s", user.username)
        return None

    # =====================================================================
    # BLINDAJE DEL PAYLOAD (anti 400 "body.required_fields" / "Validation error")
    # =====================================================================
    # Todo el armado del body (título, moneda, condición, stock, fotos, etc.)
    # vive en construir_payload_item(): garantiza los campos obligatorios de ML
    # y aborta con un ValueError descriptivo si algo no se puede resolver.
    body = construir_payload_item(item_data)
    logger.info("Payload POST /items: %s", json.dumps(body, ensure_ascii=False))

    MAX_RETRIES = 4
    retry_count = 0
    
    while retry_count < MAX_RETRIES:
        result = _api_request("POST", "/items", access_token, body)
        retry_count += 1
        
        if result and result.get("id"):
            break  # Éxito

        # Diagnóstico explícito de CADA rechazo de Mercado Libre (400/422):
        # se loguea el mensaje normalizado, las causas y la respuesta cruda.
        intento = extraer_error_ml(result)
        logger.error(
            "Mercado Libre rechazó el ítem (intento %d/%d): %s | causas=%s | "
            "respuesta=%s",
            retry_count, MAX_RETRIES, intento["mensaje"],
            intento["detalles"] or "-",
            json.dumps(result, ensure_ascii=False) if result else "sin respuesta",
        )
        
        if retry_count >= MAX_RETRIES:
            logger.error("Agotados %d reintentos. Último error: %s", MAX_RETRIES, result)
            break
        
        causes = result.get("cause", []) if result else []
        
        # Intento 1: predecir la categoría hoja con el NOMBRE DE LA CATEGORÍA
        # del objeto (nunca con el título: predecir con el título desviaba la
        # publicación a categorías absurdas).
        is_category_error = any(
            c.get("code") == "item.category_id.invalid" for c in causes
        )
        if is_category_error:
            texto_categoria = item_data.get("categoria_nombre") or ""
            predicted = predict_category(texto_categoria) if texto_categoria else None
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
        
        # Intento 3: listing_type no disponible para la cuenta/categoría
        # (ML puede rebotar exigiendo la matriz de imágenes de gold_special).
        # Fallback seguro a "free", que no exige imágenes.
        is_listing_error = any(
            c.get("code") in ("item.listing_type_id.invalid", "item.listing_type_id.not_found")
            or "listing_type" in str(c.get("message", "")).lower()
            or "gold_special" in str(c)
            for c in causes
        )
        if is_listing_error and body.get("listing_type_id") != "free":
            logger.info("Reintento %d: listing_type %s → free (permisos/categoría)",
                        retry_count, body.get("listing_type_id"))
            body["listing_type_id"] = "free"
            continue

        # Intento 4: atributo obligatorio POWER_SUPPLY_TYPE ausente
        is_power_error = any(
            "power_supply_type" in str(c.get("attribute", "")).lower()
            or "alimentaci" in str(c.get("message", "")).lower()
            for c in causes
        )
        if is_power_error and not any(
            a.get("id") == "POWER_SUPPLY_TYPE" for a in body.get("attributes", [])
        ):
            logger.info("Reintento %d: añadiendo POWER_SUPPLY_TYPE (corriente eléctrica)",
                        retry_count)
            body.setdefault("attributes", []).append(
                {"id": "POWER_SUPPLY_TYPE", "value_name": "Corriente eléctrica"}
            )
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

    error = extraer_error_ml(result)
    logger.error(
        "Error al crear ítem en ML: %s | campos_faltantes=%s | detalles=%s | "
        "respuesta=%s",
        error["mensaje"],
        error["campos"] or "-",
        error["detalles"] or "-",
        json.dumps(result, ensure_ascii=False) if result else "sin respuesta",
    )
    return result  # Retornar el error para diagnóstico
