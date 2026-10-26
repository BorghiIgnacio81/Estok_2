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

from .mercadolibre_oauth import get_valid_access_token, refresh_access_token
from .mercadolibre_payload import (
    CAMPOS_REQUERIDOS_ML,
    campos_invalidos_ml,
    construir_payload_item,
    extraer_causas_ml,
    extraer_error_ml,
    solo_campos_permitidos,
)
from .mercadolibre_saneamiento import descripcion_publicable
from .mercadolibre_categoria_politica import (
    ajustar_por_causas_titulo,
    condition_publicable,
    construye_titulo_ml,
)
from .mercadolibre_prediccion import ML_API_BASE, predict_category
from .mercadolibre_atributos import (
    completar_attributes_requeridos,
    ids_requeridos,
)
from .mercadolibre_atributos_diagnostico import atributos_detectados
from .mercadolibre_atributos_reintentos import (
    ACCION_CORTAR,
    ACCION_REINTENTAR,
    aplicar_causas_atributos,
)
from .mercadolibre_atributos_valores import construir_datos_objeto

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


def _api_request(
    method: str,
    endpoint: str,
    access_token: str,
    body: Optional[dict] = None,
    usuario=None,
    timeout: int = 30,
) -> Optional[dict]:
    """
    Realiza una request autenticada a la API de MercadoLibre.
    Retorna la respuesta como dict o None si falla.

    `usuario` (opcional pero recomendado): dueño del token OAuth. Si Mercado
    Libre responde HTTP 401 (access_token vencido o inválido) se renueva el
    token con `grant_type=refresh_token`, se guarda en la base y se REINTENTA
    la misma operación UNA sola vez, de forma transparente para el llamador.
    Para cualquier llamada autenticada nueva usar `api_request_autenticado()`.
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
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else "sin cuerpo"

        # ── Renovación TRANSPARENTE del OAuth (401 = token vencido) ────────
        # Se reintenta UNA sola vez con el token renovado (usuario=None en el
        # reintento para que un 401 repetido no genere un bucle de refresh).
        if e.code == 401 and usuario is not None:
            logger.warning(
                "ML devolvió 401 en %s %s: se renueva el token y se reintenta.",
                method, endpoint,
            )
            token_nuevo = refresh_access_token(usuario)
            if token_nuevo and token_nuevo != access_token:
                return _api_request(method, endpoint, token_nuevo, body,
                                    usuario=None, timeout=timeout)

        # Diagnóstico COMPLETO del rechazo: código, motivo y cuerpo crudo que
        # devuelve Mercado Libre (fuente de verdad para saber qué campo falló).
        logger.error(
            "Respuesta ML Error (%d %s) %s %s: %s",
            e.code, e.reason, method, endpoint, error_body,
        )
        try:
            data = json.loads(error_body)
        except json.JSONDecodeError:
            data = {"error": f"HTTP {e.code}: {e.reason}", "detail": error_body[:500]}
        # Status HTTP real de ML para el diagnóstico (no pisa `status` del body).
        if isinstance(data, dict):
            data.setdefault("http_status", e.code)
        return data
    except Exception as e:
        logger.error("ML API Exception: %s", e)
        return {"error": str(e)}


def api_request_autenticado(usuario, method: str, endpoint: str,
                            body: Optional[dict] = None,
                            timeout: int = 30) -> Optional[dict]:
    """
    Petición autenticada a Mercado Libre con renovación automática del token.

    Punto ÚNICO recomendado para cualquier llamada que exija OAuth:
      1. `get_valid_access_token()` refresca el token ANTES de usarlo si ya
         venció o está por vencer (margen MARGEN_REFRESCO_SEGUNDOS).
      2. `_api_request()` reintenta una vez tras un 401 renovando el token.
    """
    access_token = get_valid_access_token(usuario)
    if not access_token:
        logger.warning(
            "Sin access_token válido de Mercado Libre para %s",
            getattr(usuario, "username", usuario),
        )
        return {"error": "No hay access_token de Mercado Libre para el usuario."}
    return _api_request(method, endpoint, access_token, body, usuario=usuario,
                        timeout=timeout)



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

    result = _api_request("POST", "/pictures", access_token, body, usuario=user)
    if result and "id" in result:
        logger.info("Foto subida a ML: picture_id=%s", result["id"])
        return result["id"]

    logger.error("Error al subir foto a ML. URL=%s, Response=%s", image_url[:150], result)
    return None


def _crear_descripcion_aparte(item: dict, access_token: str, texto: str,
                              usuario=None) -> None:
    """
    Crea la descripción con POST /items/{item_id}/description.

    La API actual de Mercado Libre PROHÍBE enviar "description" dentro del body
    de POST /items (HTTP 400 "body.invalid_fields"). Por eso esta llamada se
    hace SIEMPRE después del HTTP 201 que devuelve el item_id. Best-effort: si
    falla solo se registra el error, no se revierte la publicación.
    """
    item_id = str((item or {}).get("id") or "").strip()
    texto = str(texto or "").strip()
    if not item_id or not texto:
        return

    respuesta = _api_request(
        "POST", f"/items/{item_id}/description", access_token,
        {"plain_text": texto},
        usuario=usuario,
    )
    if respuesta and (respuesta.get("id") or respuesta.get("plain_text")):
        logger.info("Descripción creada para el ítem %s", item_id)
    else:
        logger.error(
            "No se pudo crear la descripción del ítem %s: %s",
            item_id,
            json.dumps(respuesta, ensure_ascii=False) if respuesta else "sin respuesta",
        )


def create_item(user, item_data: Dict[str, Any],
                diagnostico: Optional[dict] = None) -> Optional[dict]:
    """
    Crea una publicación en MercadoLibre.

    Args:
        user: Usuario autenticado (dueño del token OAuth)
        diagnostico: Dict opcional que se completa IN-PLACE con
            `payload_enviado`, `atributos_detectados_categoria`, `error_ml`,
            `category_id` e `intentos`. La vista lo devuelve en el HTTP 400 para
            que el frontend muestre exactamente qué se envió y qué respondió ML.
        item_data: Dict con:
            - title (str): Título del producto (15 a 60 caracteres). En
              categorías con dominio de catálogo (ej: MLA49337) NO se envía:
              Mercado Libre lo construye desde family_name + attributes.
            - category_id (str): ID de categoría de ML (ej: "MLA1648" para Computación)
            - price (float): Precio en ARS (debe ser mayor a 0)
            - available_quantity (int): Stock disponible (default 1)
            - condition (str): "new" o "used" (default "used")
            - description (str): Descripción en texto plano. NO viaja en el body
              de POST /items: se envía aparte con POST /items/{id}/description
              apenas la publicación devuelve el item_id.
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
              usados para BRAND / MODEL y para la familia de la raíz.
            - sale_terms (list, opcional): solo WARRANTY_TYPE / WARRANTY_TIME.

        El servicio fuerza los defaults de Mercado Libre: currency_id="ARS",
        buying_mode="buy_it_now", listing_type_id="gold_special" (o el
        configurado en settings.MERCADOLIBRE_LISTING_TYPE_ID), condition ("new"
        si el estado es nuevo, si no "used"), available_quantity (1 por defecto)
        y shipping {"mode": "not_specified", "local_pick_up": True}.

    Returns:
        Dict con la respuesta de ML (id, permalink, status, etc.) o None si falla.

    Raises:
        ValueError: título/categoría/precio inválidos o payload incompleto.
    """
    access_token = get_valid_access_token(user)
    if not access_token:
        logger.warning("No hay access_token para el usuario %s", user.username)
        if diagnostico is not None:
            diagnostico["error_ml"] = {
                "error": "No hay access_token de Mercado Libre para el usuario.",
            }
        return None

    # =====================================================================
    # BLINDAJE DEL PAYLOAD (anti 400 invalid_fields / required_fields)
    # =====================================================================
    # Todo el armado del body vive en construir_payload_item(): sanea tipos,
    # aplica la whitelist de la API y aborta con ValueError si falta algo.
    body = construir_payload_item(item_data)
    # La descripción NO viaja en el body: se crea después del 201 con
    # POST /items/{item_id}/description.
    descripcion = descripcion_publicable(item_data, body.get("title", ""))

    # =====================================================================
    # POLÍTICA DE LA CATEGORÍA (título de catálogo / condición aceptada)
    # =====================================================================
    # MLA49337 y otras categorías con `catalog_domain` CONSTRUYEN el título
    # desde family_name + attributes y rechazan "title" con 400
    # body.invalid_fields (verificado contra la API real): se omite del body.
    titulo_omitido = ""
    if construye_titulo_ml(body.get("category_id"), access_token):
        titulo_omitido = body.pop("title", "") or ""
        logger.info(
            "Categoría %s de catálogo: ML construye el título desde family_name "
            "(%s); se omite 'title' del body.",
            body.get("category_id"), body.get("family_name", "-"),
        )
    # Condición aceptada por la categoría (MLA49337 solo publica "new").
    body["condition"] = condition_publicable(
        body.get("category_id"), body.get("condition", ""), access_token
    )

    # =====================================================================
    # ATRIBUTOS OBLIGATORIOS DE LA CATEGORÍA (100% DINÁMICO)
    # =====================================================================
    # Datos REALES del objeto + base que ya trae: los obligatorios se completan
    # desde GET /categories/{id}/attributes (con caché), solo `tags.required`.
    datos_atributos = construir_datos_objeto(item_data, body.get("title", ""))
    atributos_base = list(item_data.get("attributes") or [])

    def _atributos_para(categoria: str) -> list:
        """Atributos válidos para la categoría: base + obligatorios del catálogo."""
        return completar_attributes_requeridos(
            atributos_base,
            categoria,
            access_token=access_token,
            datos=datos_atributos,
        )

    body["attributes"] = _atributos_para(body["category_id"])
    if not body["attributes"]:
        body.pop("attributes", None)

    # Log EXPLÍCITO del array generado dinámicamente antes del POST: permite
    # auditar exactamente qué atributos y valores se le mandan a Mercado Libre.
    logger.info(
        "Attributes dinámicos para la categoría %s (obligatorios del catálogo ML): %s",
        body.get("category_id"),
        json.dumps(body.get("attributes", []), ensure_ascii=False),
    )

    # Diagnóstico HTTP 400 (se recalcula si cambia la categoría).
    if diagnostico is not None:
        diagnostico["category_id"] = body.get("category_id")
        diagnostico["atributos_detectados_categoria"] = atributos_detectados(
            body.get("category_id"), access_token
        )

    # 8 intentos: categoría, título inválido (re-predicción con el nombre del
    # objeto), condition, listing_type, POWER_SUPPLY_TYPE, atributos inválidos,
    # atributos obligatorios y campos de primer nivel inválidos
    # (body.invalid_fields), todos guiados por las causas REALES de ML.
    MAX_RETRIES = 8
    retry_count = 0
    # Anti-bucle required_fields ↔ invalid_fields: IDs obligatorios de la
    # categoría actual, atributos que ML ya rechazó y correcciones ya intentadas.
    requeridos = ids_requeridos(body["category_id"], access_token)
    atributos_descartados: set = set()
    atributos_corregidos: set = set()
    # Anti-bucle de la re-predicción por título inválido (se intenta UNA vez).
    categoria_repredicha = False

    def _mover_categoria(nueva: str):
        """Mueve el payload a `nueva` y recalcula sus atributos obligatorios."""
        body["category_id"] = nueva
        body["attributes"] = _atributos_para(nueva)
        if not body["attributes"]:
            body.pop("attributes", None)
        atributos_descartados.clear()
        atributos_corregidos.clear()
        logger.info(
            "Attributes recalculados para la categoría %s: %s",
            nueva, json.dumps(body.get("attributes", []), ensure_ascii=False),
        )
        if diagnostico is not None:
            diagnostico["category_id"] = nueva
            diagnostico["atributos_detectados_categoria"] = atributos_detectados(
                nueva, access_token
            )
        return ids_requeridos(nueva, access_token)

    while retry_count < MAX_RETRIES:
        # Garantía final: NINGÚN reintento puede agregar una clave de primer
        # nivel fuera de la spec de POST /items (origen del 400
        # "body.invalid_fields").
        body = solo_campos_permitidos(body)
        # Copia EXACTA del payload de este intento para el diagnóstico HTTP 400.
        if diagnostico is not None:
            diagnostico["payload_enviado"] = json.loads(
                json.dumps(body, ensure_ascii=False)
            )
            diagnostico["intentos"] = retry_count + 1
        logger.info("Payload ML enviado: %s", json.dumps(body, ensure_ascii=False))
        result = _api_request("POST", "/items", access_token, body, usuario=user)
        if diagnostico is not None:
            diagnostico["error_ml"] = result
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

        # Título en categorías de catálogo: ML lo construye desde family_name;
        # si pide más detalle o exige el campo, se ajusta el body y se reintenta.
        reintentar, titulo_omitido = ajustar_por_causas_titulo(
            result, body, item_data, titulo_omitido
        )
        if reintentar:
            continue
        
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
                requeridos = _mover_categoria(predicted)
                continue

        # Intento 1b: ML rechazó el TÍTULO para la categoría resuelta
        # ("The fields [title] are invalid for requested call"). Pasa cuando el
        # inventario tiene el objeto en una categoría que no corresponde (bug
        # real: un GPS en "Electrónica" → MLA1728 "Software Comercial"). Se
        # re-predice UNA vez con el NOMBRE DEL OBJETO (dato del inventario) y se
        # reintenta en la categoría hoja que devuelve Mercado Libre.
        if not categoria_repredicha:
            titulo_invalido = any(
                str(campo).split(".")[-1].strip().lower() == "title"
                for campo in campos_invalidos_ml(result)
            )
            if titulo_invalido:
                categoria_repredicha = True
                texto_objeto = str(
                    item_data.get("nombre") or item_data.get("title") or ""
                ).strip()
                predicted = predict_category(texto_objeto) if texto_objeto else None
                if predicted and predicted != body.get("category_id"):
                    logger.info(
                        "Reintento %d: ML rechazó el título en %s → se re-predice "
                        "%s con el objeto '%s'",
                        retry_count, body.get("category_id"), predicted,
                        texto_objeto[:50],
                    )
                    requeridos = _mover_categoria(predicted)
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

        # Intentos 5 y 6: corrección/descarte de atributos rechazados y adición
        # de obligatorios faltantes, guiados por las causas REALES de ML. La
        # lógica anti-bucle vive en mercadolibre_atributos_reintentos.py.
        decision = aplicar_causas_atributos(
            causes,
            body.get("attributes", []),
            body.get("category_id"),
            access_token,
            datos_atributos,
            requeridos,
            atributos_corregidos,
            atributos_descartados,
        )
        if decision["accion"] == ACCION_REINTENTAR:
            if decision["attributes"]:
                body["attributes"] = decision["attributes"]
            else:
                body.pop("attributes", None)
            continue
        if decision["accion"] == ACCION_CORTAR:
            break

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
                body.pop(campo, None)
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
        # La descripción se crea SIEMPRE después del 201, con el endpoint
        # oficial (POST /items/{item_id}/description). Nunca viaja en el body.
        _crear_descripcion_aparte(result, access_token, descripcion, usuario=user)
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
