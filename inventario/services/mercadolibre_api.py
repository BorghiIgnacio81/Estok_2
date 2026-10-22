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
from .mercadolibre_payload import (
    CAMPOS_REQUERIDOS_ML,
    campos_invalidos_ml,
    construir_payload_item,
    extraer_causas_ml,
    extraer_error_ml,
    solo_campos_permitidos,
)
from .mercadolibre_prediccion import ML_API_BASE, predict_category
from .mercadolibre_atributos import (
    atributos_faltantes_por_causas,
    atributos_invalidos_por_causas,
    completar_attributes_requeridos,
)

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
        # Diagnóstico COMPLETO del rechazo: código, motivo y cuerpo crudo que
        # devuelve Mercado Libre (fuente de verdad para saber qué campo falló).
        logger.error(
            "Respuesta ML Error (%d %s) %s %s: %s",
            e.code, e.reason, method, endpoint, error_body,
        )
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


def _agregar_atributo(attributes: list, atributo_id: str, value_name) -> bool:
    """
    Agrega un atributo a la lista sin duplicar IDs y sin valores vacíos.

    Devuelve True si lo agregó. Se usa para garantizar los atributos estándar
    de identidad (BRAND / MODEL) sin pisar ni repetir los valores que ya vengan
    del objeto.
    """
    valor = str(value_name or '').strip()
    aid = str(atributo_id or '').strip().upper()
    if not aid or not valor:
        return False
    if any(str(a.get("id", "")).strip().upper() == aid for a in attributes):
        return False
    attributes.append({"id": aid, "value_name": valor})
    return True


def construir_attributes_desde_objeto(objeto, category_id=None) -> list:
    """
    Construye la lista "attributes" ESTÁNDAR que viaja en el payload de ML.

    Mercado Libre responde HTTP 400 "body.invalid_fields" cuando el body trae
    atributos que no pertenecen al catálogo de la categoría destino. Por eso acá
    SOLO se envían los atributos estándar de identidad (BRAND / MODEL): los
    obligatorios de cada categoría los agrega
    `mercadolibre_atributos.completar_attributes_requeridos()` consultando
    GET /categories/{id}/attributes (catálogo real, nunca por suposición).

    - BRAND: solo si el objeto tiene marca cargada.
    - MODEL: solo si el objeto tiene modelo cargado.
    - Sin datos reales NO se envía la clave `attributes` (los valores genéricos
      inventados son una fuente real de rechazos en ML).

    Args:
        objeto: Instancia de Objeto (puede ser None).
        category_id: ID final de categoría ML (se mantiene por compatibilidad de
            firma; la selección de atributos ya no depende de la categoría).
    """
    attributes: list = []
    if objeto is None:
        return attributes

    marca = (getattr(objeto, 'marca', '') or '').strip()
    modelo = (getattr(objeto, 'modelo', '') or '').strip()

    # Solo datos REALES del objeto: nada de "Genérico"/"Sin especificar". Si la
    # categoría no exige atributos, el body va sin la clave `attributes`, que es
    # lo que evita los rechazos por claves/valores inventados.
    if marca:
        _agregar_atributo(attributes, "BRAND", marca)
    if modelo:
        _agregar_atributo(attributes, "MODEL", modelo)
    return attributes


def _crear_descripcion_aparte(item: dict, access_token: str, texto: str) -> None:
    """
    Crea la descripción con POST /items/{id}/description.

    Se usa cuando Mercado Libre rechazó la clave "description" dentro del body de
    POST /items (causa body.invalid_fields): el ítem ya quedó publicado y la
    descripción se agrega con el endpoint dedicado. Best-effort: si falla solo se
    registra el error, no se revierte la publicación.
    """
    item_id = str((item or {}).get("id") or "").strip()
    texto = str(texto or "").strip()
    if not item_id or not texto:
        return

    respuesta = _api_request(
        "POST", f"/items/{item_id}/description", access_token,
        {"plain_text": texto},
    )
    if respuesta and (respuesta.get("id") or respuesta.get("plain_text")):
        logger.info("Descripción creada aparte para el ítem %s", item_id)
    else:
        logger.error(
            "No se pudo crear la descripción del ítem %s: %s",
            item_id,
            json.dumps(respuesta, ensure_ascii=False) if respuesta else "sin respuesta",
        )


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
            - attributes (list, opcional): Atributos de categoría. Por defecto
              solo BRAND / MODEL; los obligatorios que falten los completa
              `completar_attributes_requeridos()` con el catálogo real de la
              categoría.
            - marca / modelo (str, opcional): datos de identidad del objeto,
              usados para completar BRAND / MODEL cuando ML los exige.
            - sale_terms (list, opcional): solo WARRANTY_TYPE / WARRANTY_TIME.

        El servicio fuerza los defaults de Mercado Libre: currency_id="ARS",
        buying_mode="buy_it_now", listing_type_id="gold_special" (o el
        configurado en settings.MERCADOLIBRE_LISTING_TYPE_ID), condition ("new"
        si el estado es nuevo, si no "used"), available_quantity (1 por defecto),
        description {"plain_text": ...} y shipping {"mode": "not_specified",
        "local_pick_up": True}.

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
    # BLINDAJE DEL PAYLOAD (anti 400 "body.invalid_fields" / "required_fields")
    # =====================================================================
    # Todo el armado del body (título, moneda, condición, stock, fotos, etc.)
    # vive en construir_payload_item(): sanea tipos, aplica la whitelist de
    # campos de la API y aborta con un ValueError descriptivo si algo falta.
    body = construir_payload_item(item_data)

    # =====================================================================
    # ATRIBUTOS OBLIGATORIOS DE LA CATEGORÍA
    # =====================================================================
    # GET /categories/{id}/attributes indica qué atributos exige la categoría.
    # Solo se agregan los marcados como obligatorios por el catálogo real. Si la
    # consulta falla se conserva BRAND / MODEL y el reintento de abajo usa las
    # causas reales del error de Mercado Libre.
    atributos_completos = completar_attributes_requeridos(
        body.get("attributes"),
        body.get("category_id"),
        access_token=access_token,
        marca=item_data.get("marca", ""),
        modelo=item_data.get("modelo", ""),
        nombre_categoria=item_data.get("categoria_nombre", ""),
        titulo=body.get("title", ""),
    )
    if atributos_completos:
        body["attributes"] = atributos_completos

    # 8 intentos: categoría, condition, listing_type, POWER_SUPPLY_TYPE,
    # atributos inválidos, atributos obligatorios y campos de primer nivel
    # inválidos (body.invalid_fields), todos guiados por las causas REALES de ML.
    MAX_RETRIES = 8
    retry_count = 0
    # Descripción que ML rechazó en el body: se crea aparte con
    # POST /items/{id}/description una vez creado el ítem.
    descripcion_pendiente = ""

    while retry_count < MAX_RETRIES:
        # Garantía final: NINGÚN reintento puede agregar una clave de primer
        # nivel fuera de la spec de POST /items (origen del 400
        # "body.invalid_fields").
        body = solo_campos_permitidos(body)
        # Diagnóstico exacto del cuerpo que se envía en CADA intento (el
        # payload puede mutar entre reintentos).
        logger.info("Payload ML enviado: %s", json.dumps(body, ensure_ascii=False))
        result = _api_request("POST", "/items", access_token, body)
        retry_count += 1
        
        if result and result.get("id"):
            break  # Éxito

        # Diagnóstico explícito de CADA rechazo de Mercado Libre (400/422):
        # se loguea el mensaje normalizado, las causas y la respuesta cruda.
        intento = extraer_error_ml(result)
        logger.error("Error detallado ML: %s",
                     json.dumps(result, ensure_ascii=False) if result else "sin respuesta")
        logger.error(
            "Mercado Libre rechazó el ítem (intento %d/%d): %s | causas=%s",
            retry_count, MAX_RETRIES, intento["mensaje"],
            intento["detalles"] or "-",
        )
        
        if retry_count >= MAX_RETRIES:
            logger.error("Agotados %d reintentos. Último error: %s", MAX_RETRIES, result)
            break
        
        causes = [c for c in extraer_causas_ml(result) if isinstance(c, dict)]
        
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

        # Intento 5: Mercado Libre rechazó un atributo por no pertenecer a la
        # categoría (ej: FAMILY_NAME en categorías que no lo definen). Se quita
        # ese atributo y se reintenta en vez de abortar la publicación.
        invalidos = atributos_invalidos_por_causas(
            causes, body.get("attributes", [])
        )
        if invalidos:
            logger.info(
                "Reintento %d: quitando atributos inválidos para la categoría %s: %s",
                retry_count, body.get("category_id"), ", ".join(invalidos),
            )
            restantes = [
                a for a in body.get("attributes", [])
                if str(a.get("id", "")).strip().upper() not in invalidos
            ]
            if restantes:
                body["attributes"] = restantes
            else:
                body.pop("attributes", None)
            continue

        # Intento 6: atributo obligatorio de identidad ausente que ML pide por
        # nombre (FAMILY_NAME, BRAND, MODEL, MANUFACTURER...). Cubre el caso en
        # que la consulta de atributos de la categoría no esté disponible.
        faltantes = atributos_faltantes_por_causas(
            causes,
            body.get("attributes", []),
            marca=item_data.get("marca", ""),
            modelo=item_data.get("modelo", ""),
            nombre_categoria=item_data.get("categoria_nombre", ""),
            titulo=body.get("title", ""),
        )
        if faltantes:
            logger.info(
                "Reintento %d: añadiendo atributos obligatorios %s",
                retry_count, ", ".join(a["id"] for a in faltantes),
            )
            body.setdefault("attributes", []).extend(faltantes)
            continue

        # Intento 7: campo de PRIMER NIVEL rechazado (body.invalid_fields). Se
        # usa la causa REAL de ML (campo entre corchetes o `references`) para
        # quitarlo y reintentar. NUNCA se quitan campos obligatorios y NUNCA se
        # agregan claves nuevas en la raíz (eso era lo que generaba el 400).
        invalidos_raiz: list = []
        for campo in campos_invalidos_ml(result):
            raiz = str(campo or "").split(".")[0].strip()
            if (
                raiz in body
                and raiz not in CAMPOS_REQUERIDOS_ML
                and raiz not in invalidos_raiz
            ):
                invalidos_raiz.append(raiz)
        if invalidos_raiz:
            for campo in invalidos_raiz:
                valor = body.pop(campo, None)
                if campo == "description" and isinstance(valor, dict):
                    # La descripción no se pierde: se crea aparte al publicar.
                    descripcion_pendiente = str(valor.get("plain_text") or "")
            logger.info(
                "Reintento %d: ML rechazó los campos [%s] (%s) → se reintenta "
                "sin ellos",
                retry_count, ", ".join(invalidos_raiz), intento["mensaje"],
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
        # Si ML había rechazado "description" en el body, se crea ahora con el
        # endpoint oficial (POST /items/{id}/description).
        _crear_descripcion_aparte(result, access_token, descripcion_pendiente)
        return result

    error = extraer_error_ml(result)
    logger.error(
        "Error al crear ítem en ML: %s | campos_faltantes=%s | campos_invalidos=%s | "
        "detalles=%s | respuesta=%s",
        error["mensaje"],
        error["campos"] or "-",
        error.get("invalidos") or "-",
        error["detalles"] or "-",
        json.dumps(result, ensure_ascii=False) if result else "sin respuesta",
    )
    return result  # Retornar el error para diagnóstico
