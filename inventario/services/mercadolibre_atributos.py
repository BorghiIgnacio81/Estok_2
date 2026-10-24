"""
Atributos obligatorios de la categoría de Mercado Libre (100% dinámicos).

Mercado Libre rechaza POST /items con HTTP 400 "body.required_fields" cuando
falta un atributo obligatorio de la categoría destino y con
"body.invalid_fields" cuando el valor no pertenece al catálogo de esa categoría
(ej: enviar "Genérico" en un atributo de lista). El bucle entre ambos errores se
evita construyendo cada valor según el `value_type` real del atributo.

Este módulo centraliza el blindaje de la lista `attributes`:

1. `obtener_atributos_categoria()`: GET /categories/{id}/attributes (endpoint
   público), con caché en memoria por categoría para no golpear la API en cada
   publicación y con enfriamiento si la API falla.
2. `completar_attributes_requeridos()`: agrega los atributos que ML exige o
   reconoce como identidad (`tags.required`, `tags.catalog_required` o IDs con
   FAMILY / BRAND / MODEL), con el dato REAL del objeto si existe y, si no, un
   valor válido por tipo (value_id de lista, "No" booleano, número + unidad o
   texto por defecto: "Sin marca", "Genérico", "Sin especificar").
   Nunca duplica ni pisa los valores ya cargados en el objeto.
   Los IDs de ATRIBUTOS_EN_RAIZ_ML (FAMILY_NAME) se EXCLUYEN: Mercado Libre los
   exige como propiedad de la RAÍZ del body de POST /items, no en `attributes`.
3. `atributos_faltantes_por_causas()` y `atributos_invalidos_por_causas()`:
   ayudantes para que `create_item` reintente con evidencia REAL de la respuesta
   de Mercado Libre (por si la consulta de atributos de la categoría no está
   disponible), sin re-agregar atributos que ML ya rechazó.
4. `ids_requeridos()` y `valor_catalogo_atributo()`: soporte del anti-bucle
   `required_fields` ↔ `invalid_fields`.

Los valores en sí (lista / booleano / numérico / texto y datos del objeto) viven
en mercadolibre_atributos_valores.py.

Usado por:
- inventario/services/mercadolibre_api.py (create_item + reintentos).
"""

import json
import logging
import re
import time
import urllib.parse
import urllib.request
from typing import Dict, List, Optional

from .mercadolibre_prediccion import ML_API_BASE
from .mercadolibre_saneamiento import ATRIBUTOS_EN_RAIZ_ML
from .mercadolibre_atributos_valores import (
    ATRIBUTOS_OBJETO,
    construir_datos_objeto,
    normalizar_id as _normalizar_id,
    valor_para_atributo,
    valor_por_defecto,
)
from .mercadolibre_atributos_reglas import (
    debe_incluir as _debe_incluir,
    es_requerido as _es_requerido,
)

logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURACIÓN
# =============================================================================
TIMEOUT_CATEGORIA = 10       # segundos por consulta a /categories/{id}/attributes
CACHE_MAX_CATEGORIAS = 200   # tope del caché en memoria (una entrada por categoría)
ENFRIAMIENTO_FALLO = 300     # segundos sin reintentar una categoría que falló

# Los valores de cada atributo (lista / booleano / numérico / texto) y los datos
# reales del objeto viven en mercadolibre_atributos_valores.py: acá solo se
# consulta el catálogo de la categoría y se decide QUÉ atributos completar.

# Palabras que indican que Mercado Libre está pidiendo un atributo faltante.
_SENALES_FALTANTE = (
    "required", "missing", "obligatorio", "requerido", "requiere", "falta",
)

# IDs de atributo dentro de un mensaje ("The attributes [BRAND] are required").
# Mercado Libre también los nombra en minúsculas ("[family_name]"), por eso se
# aceptan ambos formatos y se normalizan a MAYÚSCULAS al extraerlos.
_RE_ID_ATRIBUTO = re.compile(r"\b([A-Za-z][A-Za-z0-9_]{2,})\b")

# Caché en memoria: category_id → lista de atributos de la categoría.
_CACHE_ATRIBUTOS: Dict[str, List[dict]] = {}
# Caché negativa: category_id → timestamp del último fallo de consulta.
_CACHE_FALLOS: Dict[str, float] = {}


# =============================================================================
# CONSULTA DE ATRIBUTOS DE LA CATEGORÍA
# =============================================================================

def obtener_atributos_categoria(category_id, access_token: str = "") -> List[dict]:
    """
    Devuelve los atributos definidos por Mercado Libre para una categoría.

    GET /categories/{category_id}/attributes (público; el token es opcional).
    Cachea el resultado en memoria y, ante un fallo de red/API, no reintenta esa
    categoría durante ENFRIAMIENTO_FALLO segundos. Nunca lanza excepción: si no
    hay datos devuelve [] y el llamador decide el fallback.
    """
    cid = _normalizar_id(category_id)
    if not cid:
        return []

    if cid in _CACHE_ATRIBUTOS:
        return _CACHE_ATRIBUTOS[cid]

    ultimo_fallo = _CACHE_FALLOS.get(cid)
    if ultimo_fallo and (time.time() - ultimo_fallo) < ENFRIAMIENTO_FALLO:
        return []

    url = f"{ML_API_BASE}/categories/{urllib.parse.quote(cid)}/attributes"
    headers = {"Accept": "application/json"}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=TIMEOUT_CATEGORIA) as respuesta:
            data = json.loads(respuesta.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - la publicación debe seguir
        logger.warning(
            "No se pudieron consultar los atributos de la categoría %s: %s", cid, exc
        )
        _CACHE_FALLOS[cid] = time.time()
        return []

    # Defensivo: la API devuelve una lista, pero toleramos {"attributes": [...]}.
    if isinstance(data, dict):
        data = data.get("attributes") or []
    if not isinstance(data, list):
        logger.warning("Respuesta inesperada de atributos ML para %s: %r", cid, data)
        _CACHE_FALLOS[cid] = time.time()
        return []

    if len(_CACHE_ATRIBUTOS) >= CACHE_MAX_CATEGORIAS:
        _CACHE_ATRIBUTOS.clear()
    _CACHE_ATRIBUTOS[cid] = data
    _CACHE_FALLOS.pop(cid, None)
    logger.info("Atributos ML de la categoría %s: %d definidos", cid, len(data))
    return data


def _definicion_por_id(definidos, atributo_id) -> Optional[dict]:
    """Definición del catálogo para un ID de atributo (None si no existe)."""
    aid = _normalizar_id(atributo_id)
    if not aid:
        return None
    for atributo in definidos or []:
        if isinstance(atributo, dict) and _normalizar_id(atributo.get("id")) == aid:
            return atributo
    return None


def ids_requeridos(category_id, access_token: str = "") -> set:
    """IDs de atributo que el catálogo REAL de la categoría marca como obligatorios."""
    return {
        _normalizar_id(atributo.get("id"))
        for atributo in obtener_atributos_categoria(category_id, access_token)
        if isinstance(atributo, dict) and _es_requerido(atributo)
    }


def valor_catalogo_atributo(
    atributo_id,
    category_id,
    access_token: str = "",
    datos: Optional[dict] = None,
) -> Optional[dict]:
    """
    Valor SOLO de catálogo para un atributo que Mercado Libre rechazó.

    Se usa para corregir UNA vez el valor de un atributo obligatorio (elegir un
    `value_id` válido en lugar del dato real del objeto) antes de descartarlo y
    evitar el bucle `required_fields` ↔ `invalid_fields`.
    """
    definicion = _definicion_por_id(
        obtener_atributos_categoria(category_id, access_token), atributo_id
    )
    if definicion is None:
        return None
    return valor_para_atributo(definicion, datos, preferir_catalogo=True)


def _ids_desde_texto(valor) -> List[str]:
    """
    Extrae posibles IDs de atributo de un texto o dict de la respuesta de ML.

    Solo devuelve tokens con forma de ID (mayúsculas/dígitos/underscore); el
    llamador filtra contra los IDs que conoce.
    """
    if isinstance(valor, dict):
        encontrados: List[str] = []
        for clave in ("id", "attribute", "name"):
            texto = _normalizar_id(valor.get(clave))
            if texto and _RE_ID_ATRIBUTO.fullmatch(texto):
                encontrados.append(texto)
        return encontrados
    if not valor:
        return []
    # ML puede nombrar el atributo en minúsculas ("family_name"): se normaliza.
    return [token.upper() for token in _RE_ID_ATRIBUTO.findall(str(valor))]


def completar_attributes_requeridos(
    attributes,
    category_id,
    access_token: str = "",
    marca: str = "",
    modelo: str = "",
    nombre_categoria: str = "",
    titulo: str = "",
    datos: Optional[dict] = None,
) -> List[dict]:
    """
    Completa la lista `attributes` con los obligatorios REALES de la categoría.

    Flujo dinámico (sin valores inventados a ciegas):

    1. GET /categories/{id}/attributes y filtro de los atributos que ML exige o
       reconoce como identidad: `tags.required`, `tags.catalog_required` o IDs
       con FAMILY / BRAND / MODEL.
    2. Por cada atributo faltante se construye su valor respetando el
       `value_type` del catálogo (lista → value_id, booleano, numérico,
       number_unit, texto) con el dato REAL del objeto si existe.
    3. Se descartan los atributos que la categoría no define (claves inventadas
       → HTTP 400 "body.invalid_fields").

    `datos` es el mapa de datos reales del objeto construido con
    `mercadolibre_atributos_valores.construir_datos_objeto()`. Los parámetros
    sueltos (marca / modelo / nombre_categoria / titulo) se mantienen por
    compatibilidad y se usan cuando `datos` no viene.

    Si la consulta del catálogo falla, devuelve la lista tal cual llegó y
    `create_item` reintenta con las causas reales del error de ML.
    """
    resultado: List[dict] = [
        dict(atributo)
        for atributo in (attributes or [])
        if isinstance(atributo, dict)
        and atributo.get("id")
        # FAMILY_NAME viaja en la RAÍZ del body (ATRIBUTOS_EN_RAIZ_ML), no acá.
        and _normalizar_id(atributo.get("id")) not in ATRIBUTOS_EN_RAIZ_ML
    ]
    presentes = {_normalizar_id(a.get("id")) for a in resultado}

    definidos = obtener_atributos_categoria(category_id, access_token)
    if not definidos:
        return resultado

    # Catálogo REAL de la categoría: se descartan los atributos que la categoría
    # no define (claves inventadas → HTTP 400 "body.invalid_fields").
    ids_catalogo = {
        _normalizar_id(atributo.get("id"))
        for atributo in definidos
        if isinstance(atributo, dict)
    }
    fuera_catalogo = [
        atributo for atributo in resultado
        if _normalizar_id(atributo.get("id")) not in ids_catalogo
    ]
    if fuera_catalogo:
        logger.info(
            "Atributos fuera del catálogo de %s descartados: %s",
            category_id,
            ", ".join(str(atributo.get("id")) for atributo in fuera_catalogo),
        )
        resultado = [
            atributo for atributo in resultado
            if _normalizar_id(atributo.get("id")) in ids_catalogo
        ]
        presentes = {_normalizar_id(a.get("id")) for a in resultado}

    if datos is None:
        datos = construir_datos_objeto({
            "marca": marca,
            "modelo": modelo,
            "categoria_nombre": nombre_categoria,
            "title": titulo,
        })

    agregados: List[str] = []
    for atributo in definidos:
        if not isinstance(atributo, dict) or not _debe_incluir(atributo):
            continue
        aid = _normalizar_id(atributo.get("id"))
        if not aid or aid in presentes or aid in ATRIBUTOS_EN_RAIZ_ML:
            continue
        valor = valor_para_atributo(atributo, datos)
        if not valor:
            logger.warning(
                "Atributo obligatorio %s sin valor seguro disponible: se omite.", aid
            )
            continue
        resultado.append(valor)
        presentes.add(aid)
        agregados.append(aid)

    if agregados:
        logger.info(
            "Atributos obligatorios completados para la categoría %s: %s",
            _normalizar_id(category_id), ", ".join(agregados),
        )
    return resultado


# =============================================================================
# FALLBACK BASADO EN LAS CAUSAS REALES DEL ERROR DE MERCADO LIBRE
# =============================================================================

def atributos_faltantes_por_causas(
    causes,
    attributes,
    marca: str = "",
    modelo: str = "",
    nombre_categoria: str = "",
    titulo: str = "",
    definidos=None,
    datos: Optional[dict] = None,
) -> List[dict]:
    """
    Devuelve los atributos que Mercado Libre pide y faltan, con valor VÁLIDO.

    Se usa en los reintentos de `create_item`: analiza las causas del 400/422 y,
    si ML nombra un atributo obligatorio (BRAND, MODEL, COLOR...) que no está en
    el payload, lo construye respetando el `value_type` del catálogo de la
    categoría (`definidos`): value_id para listas, número + unidad, booleano o
    texto con dato real / default.

    Sin `definidos` (la consulta del catálogo falló) solo se completan los
    atributos de identidad conocidos en ATRIBUTOS_OBJETO. Tampoco se descarta
    un ID que ML pida explícitamente aunque no esté en /attributes.
    `FAMILY_NAME` NUNCA se agrega acá: viaja en la RAÍZ del body (lo exige ML
    como propiedad del recurso en categorías como MLA49337).
    Nunca se agrega texto libre a un atributo de lista.
    """
    existentes = {
        _normalizar_id(a.get("id"))
        for a in (attributes or [])
        if isinstance(a, dict)
    }
    if datos is None:
        datos = construir_datos_objeto({
            "marca": marca,
            "modelo": modelo,
            "categoria_nombre": nombre_categoria,
            "title": titulo,
        })

    ids_catalogo = {
        _normalizar_id(a.get("id"))
        for a in (definidos or [])
        if isinstance(a, dict)
    }
    # Se aceptan IDs del catálogo Y los de identidad conocidos: ML puede pedir
    # family_name aunque la categoría no lo publique en /attributes.
    conocidos = ids_catalogo | set(ATRIBUTOS_OBJETO)
    pedidos: List[str] = []

    for causa in causes or []:
        if not isinstance(causa, dict):
            continue
        texto = json.dumps(causa, ensure_ascii=False).lower()
        if not any(senal in texto for senal in _SENALES_FALTANTE):
            continue
        for referencia in (causa.get("attribute"), causa.get("message")):
            for aid in _ids_desde_texto(referencia):
                if (
                    aid in conocidos
                    and aid not in existentes
                    and aid not in pedidos
                    # FAMILY_NAME se envía en la RAÍZ del body, no en attributes.
                    and aid not in ATRIBUTOS_EN_RAIZ_ML
                ):
                    pedidos.append(aid)

    nuevos: List[dict] = []
    for aid in pedidos:
        definicion = _definicion_por_id(definidos, aid)
        if definicion is not None:
            valor = valor_para_atributo(definicion, datos)
        else:
            valor = valor_por_defecto(aid, datos)
            valor = {"id": aid, "value_name": valor} if valor else None
        if not valor:
            logger.warning(
                "Mercado Libre exige %s pero no hay un valor seguro para la "
                "categoría: se omite.", aid,
            )
            continue
        nuevos.append(valor)
        existentes.add(aid)
    return nuevos


def atributos_invalidos_por_causas(causes, attributes) -> List[str]:
    """
    IDs de atributos del payload que Mercado Libre rechazó como inválidos.

    Red de seguridad: si una categoría no admite uno de los atributos que
    enviamos (por ejemplo MODEL en categorías que no lo definen), se
    identifica para quitarlo y reintentar en vez de abortar la publicación.
    """
    existentes = {
        _normalizar_id(a.get("id"))
        for a in (attributes or [])
        if isinstance(a, dict)
    }
    invalidos: List[str] = []

    for causa in causes or []:
        if not isinstance(causa, dict):
            continue
        texto = json.dumps(causa, ensure_ascii=False).lower()
        if "attribute" not in texto and "atributo" not in texto:
            continue
        if not any(
            senal in texto
            for senal in ("not valid", "invalid", "not allowed", "no es válido",
                          "no válido", "no permitido")
        ):
            continue
        for referencia in (causa.get("attribute"), causa.get("message")):
            for aid in _ids_desde_texto(referencia):
                if aid in existentes and aid not in invalidos:
                    invalidos.append(aid)
    return invalidos

