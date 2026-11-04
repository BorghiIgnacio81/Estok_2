"""
SINCRONIZACIÓN DE LOS ÍTEMS DEL VENDEDOR (API de Mercado Libre).

QUÉ RESUELVE
    Las publicaciones creadas en categorías de catálogo (ítems «UP») no
    responden en `articulo.mercadolibre.com.ar/<item_id>`: el único enlace
    válido es la PERMALINK que informa la API. Cuando esa permalink no quedó
    guardada (publicaciones viejas, ítems creados antes de persistirla), las
    tarjetas de /alertas-stock y la ficha /objetos/<id> terminaban en un 404.

    Este módulo consulta los ítems REALES del vendedor y obtiene, para cada
    `item_id`, su `status` y su `permalink` vigente:

      1. GET /users/{ml_user_id}/items/search  → ids del vendedor (paginado con
         `search_type=scan`).
      2. GET /items?ids=…                      → multi-get con status, permalink
         y catalog_product_id (una sola llamada cada 20 ítems).

    Con ese mapa, `sincronizar_permallinks()` actualiza las publicaciones de
    Estok (permalink + estado) sin una llamada por ítem.

REGLA DE ORO
    Todo es BEST-EFFORT: un problema con Mercado Libre devuelve un resumen
    vacío, registra el motivo y NUNCA rompe el request del usuario.
"""

import logging
from typing import Any, Dict, Iterable, List

from django.utils import timezone

from ..models import MercadoLibrePublicacion, MercadoLibreToken
from .mercadolibre_api import api_request_autenticado
from .mercadolibre_estado import normalizar_status_ml
from .mercadolibre_publicacion import actualizar_permalink

logger = logging.getLogger(__name__)

# Timeout corto: la sincronización corre dentro del request (best-effort).
TIMEOUT_VENDEDOR = 10

# Tope de ítems que se leen del vendedor por sincronización (mantiene acotado
# el costo de /alertas-stock; el resto se completa en las siguientes cargas).
LIMITE_ITEMS_VENDEDOR = 100

# Máximos que acepta la API de Mercado Libre por llamada.
ITEMS_POR_PAGINA = 50
IDS_POR_MULTIGET = 20

# Atributos pedidos en el multi-get: respuesta chica y suficiente para el mapa.
ATRIBUTOS_ITEM = "id,status,permalink,price,catalog_product_id"


def _claves_item(item_id) -> List[str]:
    """
    Claves de búsqueda de un `item_id`.

    Además del id EXACTO se indexa su BASE (todo lo anterior al primer guion):
    Mercado Libre devuelve identificadores con sufijo en las publicaciones de
    catálogo (UP / variantes), y así se asocian igual a la publicación guardada
    en Estok.
    """
    texto = str(item_id or "").strip().upper()
    if not texto:
        return []
    base = texto.split("-")[0].strip()
    return [texto] if base == texto else [texto, base]


def ml_user_id(usuario) -> str:
    """
    User ID de Mercado Libre del usuario.

    Se usa el guardado en MercadoLibreToken y, si falta, GET /users/me (y se
    persiste para no volver a pedirlo).
    """
    if usuario is None or not getattr(usuario, "pk", None):
        return ""

    token = MercadoLibreToken.objects.filter(usuario=usuario).first()
    if token is not None and token.ml_user_id:
        return str(token.ml_user_id)

    datos = api_request_autenticado(
        usuario, "GET", "/users/me", timeout=TIMEOUT_VENDEDOR,
    )
    if isinstance(datos, dict) and datos.get("id"):
        user_id = str(datos["id"])
        try:
            if token is not None:
                MercadoLibreToken.objects.filter(pk=token.pk).update(
                    ml_user_id=int(user_id),
                )
        except (TypeError, ValueError):
            pass
        return user_id

    logger.warning("Mercado Libre no informó el user_id de %s", usuario)
    return ""


def ids_items_vendedor(usuario, limite: int = LIMITE_ITEMS_VENDEDOR) -> List[str]:
    """
    IDs de los ítems del vendedor: GET /users/{ml_user_id}/items/search.

    Pagina con `search_type=scan` hasta agotar el listado o alcanzar `limite`.
    Devuelve [] si no hay token, el usuario no tiene cuenta conectada o la API
    responde con error (nunca lanza).
    """
    user_id = ml_user_id(usuario)
    if not user_id:
        return []

    try:
        tope = max(1, int(limite or LIMITE_ITEMS_VENDEDOR))
    except (TypeError, ValueError):
        tope = LIMITE_ITEMS_VENDEDOR

    ids: List[str] = []
    vistos = set()
    offset = 0
    while len(ids) < tope:
        cantidad = min(ITEMS_POR_PAGINA, tope - len(ids))
        endpoint = (
            f"/users/{user_id}/items/search"
            f"?search_type=scan&limit={cantidad}&offset={offset}"
        )
        respuesta = api_request_autenticado(
            usuario, "GET", endpoint, timeout=TIMEOUT_VENDEDOR,
        )
        if not isinstance(respuesta, dict) or respuesta.get("error"):
            logger.warning(
                "No se pudieron listar los ítems del vendedor %s: %s",
                user_id, respuesta,
            )
            break

        resultados = list(respuesta.get("results") or [])
        if not resultados:
            break

        for item_id in resultados:
            clave = str(item_id or "").strip()
            if clave and clave not in vistos:
                vistos.add(clave)
                ids.append(clave)

        paging = respuesta.get("paging") or {}
        try:
            total = int(paging.get("total") or 0)
        except (TypeError, ValueError):
            total = 0
        offset += len(resultados)
        if total and offset >= total:
            break
        if not total and len(resultados) < cantidad:
            break

    logger.info(
        "Vendedor %s: %s ítem(s) leídos de Mercado Libre", user_id, len(ids),
    )
    return ids[:tope]


def publicaciones_por_item(usuario, ids: Iterable[str]) -> Dict[str, Dict[str, Any]]:
    """
    Mapa `item_id → {item_id, status, permalink, catalog_product_id}`.

    Usa el multi-get `GET /items?ids=…` (20 ids por llamada). Cada ítem se
    indexa por su id exacto, por su BASE (sufijos de catálogo/UP) y por su
    `catalog_product_id` cuando existe.
    """
    mapa: Dict[str, Dict[str, Any]] = {}
    limpios = list(dict.fromkeys(
        str(item_id or "").strip() for item_id in ids
        if str(item_id or "").strip()
    ))

    for inicio in range(0, len(limpios), IDS_POR_MULTIGET):
        lote = limpios[inicio:inicio + IDS_POR_MULTIGET]
        endpoint = f"/items?ids={','.join(lote)}&attributes={ATRIBUTOS_ITEM}"
        respuesta = api_request_autenticado(
            usuario, "GET", endpoint, timeout=TIMEOUT_VENDEDOR,
        )
        if not isinstance(respuesta, list):
            logger.warning(
                "Multi-get /items no devolvió una lista (vendedor %s): %s",
                getattr(usuario, "pk", "?"), respuesta,
            )
            continue

        for entrada in respuesta:
            if not isinstance(entrada, dict):
                continue
            cuerpo = entrada.get("body")
            if not isinstance(cuerpo, dict):
                continue
            item_id = str(cuerpo.get("id") or "").strip()
            if not item_id:
                continue
            datos = {
                "item_id": item_id,
                "status": str(cuerpo.get("status") or "").strip().lower(),
                "permalink": str(cuerpo.get("permalink") or "").strip(),
                "catalog_product_id": str(
                    cuerpo.get("catalog_product_id") or ""
                ).strip(),
            }
            for clave in _claves_item(item_id):
                mapa.setdefault(clave, datos)
            if datos["catalog_product_id"]:
                mapa.setdefault(datos["catalog_product_id"].upper(), datos)

    return mapa


def obtener_permalink(usuario, item_id) -> str:
    """
    Permalink REAL de un ítem: GET /items/{item_id}?attributes=permalink.

    Se usa como respaldo cuando POST /items no devolvió el campo, para que la
    publicación quede guardada con un enlace válido desde el primer momento.
    Devuelve '' si Mercado Libre no responde o no lo informa.
    """
    item_id = str(item_id or "").strip()
    if not item_id or usuario is None:
        return ""
    respuesta = api_request_autenticado(
        usuario, "GET",
        f"/items/{item_id}?attributes=id,status,permalink",
        timeout=TIMEOUT_VENDEDOR,
    )
    if isinstance(respuesta, dict):
        return str(respuesta.get("permalink") or "").strip()
    return ""


def _actualizar_publicacion(publicacion, datos) -> Dict[str, int]:
    """
    Persiste permalink/estado REALES del ítem sobre una MercadoLibrePublicacion.

    Devuelve {'permalinks': 0|1, 'estados': 0|1} según lo que cambió.
    """
    cambios = {"permalinks": 0, "estados": 0}
    if actualizar_permalink(publicacion, datos.get("permalink")):
        cambios["permalinks"] = 1

    nuevo_status = normalizar_status_ml(datos.get("status"))
    if nuevo_status and nuevo_status != str(publicacion.status or ""):
        MercadoLibrePublicacion.objects.filter(pk=publicacion.pk).update(
            status=nuevo_status, updated_at=timezone.now(),
        )
        publicacion.status = nuevo_status
        cambios["estados"] = 1
    return cambios


def sincronizar_permallinks(
    estok_id=None,
    limite: int = LIMITE_ITEMS_VENDEDOR,
) -> Dict[str, Any]:
    """
    Asocia las publicaciones de Estok con los ítems REALES del vendedor.

    Para cada dueño del token OAuth con publicaciones en el Estok:
      1. lista sus ítems (GET /users/{user_id}/items/search),
      2. los trae en lote (GET /items?ids=…),
      3. actualiza permalink + estado de las publicaciones que matchean.

    Es la fuente de la permalink activa de las publicaciones de catálogo (UP),
    cuyo enlace no puede reconstruirse a mano con el item_id.

    Returns:
        Resumen con `vendedores`, `items_vendedor`, `permalinks_actualizados`,
        `estados_actualizados` e `items` (detalle de lo actualizado).
    """
    resumen: Dict[str, Any] = {
        "vendedores": 0,
        "items_vendedor": 0,
        "permalinks_actualizados": 0,
        "estados_actualizados": 0,
        "items": [],
    }

    try:
        publicaciones = MercadoLibrePublicacion.objects.select_related(
            "objeto", "objeto__dueno_original", "usuario",
        ).filter(objeto__deleted_at__isnull=True)
        if estok_id:
            publicaciones = publicaciones.filter(objeto__estok_id=estok_id)

        # Publicaciones agrupadas por dueño del token (los tokens de ML son por
        # usuario): cada grupo se resuelve con una sola búsqueda de vendedor.
        por_dueno: Dict[str, List[Any]] = {}
        duenos: Dict[str, Any] = {}
        for publicacion in publicaciones:
            dueno = publicacion.usuario or getattr(
                publicacion.objeto, "dueno_original", None,
            )
            if dueno is None or not getattr(dueno, "pk", None):
                continue
            clave = str(dueno.pk)
            duenos.setdefault(clave, dueno)
            por_dueno.setdefault(clave, []).append(publicacion)

        for clave, vendedor in duenos.items():
            ids = ids_items_vendedor(vendedor, limite=limite)
            if not ids:
                continue
            resumen["vendedores"] += 1
            resumen["items_vendedor"] += len(ids)

            mapa = publicaciones_por_item(vendedor, ids)
            if not mapa:
                continue

            for publicacion in por_dueno.get(clave, []):
                datos = None
                for candidato in _claves_item(publicacion.item_id):
                    datos = mapa.get(candidato)
                    if datos:
                        break
                if not datos:
                    continue

                cambios = _actualizar_publicacion(publicacion, datos)
                if not (cambios["permalinks"] or cambios["estados"]):
                    continue
                resumen["permalinks_actualizados"] += cambios["permalinks"]
                resumen["estados_actualizados"] += cambios["estados"]
                resumen["items"].append({
                    "objeto_id": str(publicacion.objeto_id),
                    "item_id": datos["item_id"],
                    "permalink": datos["permalink"],
                    "status": datos["status"],
                    "permalink_actualizada": bool(cambios["permalinks"]),
                    "estado_actualizado": bool(cambios["estados"]),
                })

        if resumen["permalinks_actualizados"] or resumen["estados_actualizados"]:
            logger.info(
                "Sincronización de vendedor: %s permalink(s) y %s estado(s) "
                "actualizados (%s ítem(s) leídos).",
                resumen["permalinks_actualizados"],
                resumen["estados_actualizados"],
                resumen["items_vendedor"],
            )
        return resumen

    except Exception as exc:  # noqa: BLE001 - best-effort, nunca rompe el request
        logger.error("Error al sincronizar los ítems del vendedor de ML: %s", exc)
        return resumen


