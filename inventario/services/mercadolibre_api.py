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
    - Acá NO se inventan valores: los atributos obligatorios de la categoría los
      completa `completar_attributes_requeridos()` con un valor válido según el
      `value_type` del catálogo (nunca texto libre en atributos de lista).

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
            - family_name (str, opcional): familia en la RAÍZ del body (ML la
              exige como propiedad directa). Fallback: familia→marca→nombre→título.
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
        if diagnostico is not None:
            diagnostico["error_ml"] = {
                "error": "No hay access_token de Mercado Libre para el usuario.",
            }
        return None

    # =====================================================================
    # BLINDAJE DEL PAYLOAD (anti 400 "body.invalid_fields" / "required_fields")
    # =====================================================================
    # Todo el armado del body (título, moneda, condición, stock, fotos, etc.)
    # vive en construir_payload_item(): sanea tipos, aplica la whitelist de
    # campos de la API y aborta con un ValueError descriptivo si algo falta.
    body = construir_payload_item(item_data)

    # =====================================================================
    # ATRIBUTOS OBLIGATORIOS DE LA CATEGORÍA (100% DINÁMICO)
    # =====================================================================
    # Datos REALES del objeto (marca, modelo, material, talle, especificaciones)
    # + atributos base que ya trae el objeto. El catálogo de la categoría se
    # consulta en cada publicación: GET /categories/{id}/attributes (con caché)
    # y solo se completan los atributos con `tags.required`.
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
    # Descripción que ML rechazó en el body: se crea aparte con
    # POST /items/{id}/description una vez creado el ítem.
    descripcion_pendiente = ""
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
        result = _api_request("POST", "/items", access_token, body)
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
