"""
Atributos obligatorios de la categoría de Mercado Libre (fix FAMILY_NAME).

Mercado Libre rechaza POST /items con HTTP 400 "Validation error" cuando falta
un atributo obligatorio de la categoría destino. El caso reportado es
FAMILY_NAME (marca/familia del producto), pero el mismo problema aparece con
BRAND / MODEL / MANUFACTURER / PRODUCT_NAME según la categoría.

Este módulo centraliza el blindaje de la lista `attributes`:

1. `obtener_atributos_categoria()`: GET /categories/{id}/attributes (endpoint
   público), con caché en memoria por categoría para no golpear la API en cada
   publicación y con enfriamiento si la API falla.
2. `completar_attributes_requeridos()`: agrega a la lista `attributes` los
   atributos obligatorios de la categoría que falten, con VALORES POR DEFECTO
   SEGUROS (marca → BRAND / MANUFACTURER, familia → FAMILY_NAME, modelo →
   MODEL, ...). Nunca duplica ni pisa los valores ya cargados en el objeto.
3. `atributos_faltantes_por_causas()`, `atributos_invalidos_por_causas()`,
   `familia_por_defecto()` y `menciona_family_name()`: ayudantes para que
   `create_item` reintente con evidencia REAL de la respuesta de Mercado Libre
   (por si la consulta de atributos de la categoría no está disponible).

Regla de honestidad: NO se inventan valores para atributos que exigen un dato
verificable (GTIN/ISBN, talles, compatibilidades de vehículos, etc.). Solo se
completan atributos de identidad de producto y, en atributos de lista, se elige
una opción neutra SOLO si la categoría la ofrece ("Otro", "No aplica", ...).

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

logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURACIÓN
# =============================================================================
TIMEOUT_CATEGORIA = 10       # segundos por consulta a /categories/{id}/attributes
CACHE_MAX_CATEGORIAS = 200   # tope del caché en memoria (una entrada por categoría)
ENFRIAMIENTO_FALLO = 300     # segundos sin reintentar una categoría que falló

# Valor genérico para atributos de identidad de texto libre sin dato cargado.
VALOR_GENERICO = "Genérico"

# Fuente de cada atributo de identidad + valor por defecto cuando viene vacío.
#   marca / modelo / familia / nombre → campos del objeto o su categoría.
ATRIBUTOS_IDENTIDAD = {
    "BRAND": ("marca", VALOR_GENERICO),
    "FAMILY_NAME": ("familia", VALOR_GENERICO),
    "MANUFACTURER": ("marca", VALOR_GENERICO),
    "MODEL": ("modelo", "Sin especificar"),
    "MODEL_NAME": ("modelo", "Sin especificar"),
    "LINE": ("marca", "Genérica"),
    "PART_NUMBER": ("modelo", "Sin especificar"),
    "MPN": ("modelo", "Sin especificar"),
    "PRODUCT_NAME": ("nombre", "Producto"),
}

# Opciones neutras aceptables en atributos de lista (value_type = "list").
OPCIONES_NEUTRAS = (
    "otro", "otra", "otros", "otras", "no aplica", "no corresponde",
    "sin marca", "generico", "genérico", "generica", "genérica",
    "universal", "estandar", "estándar", "sin especificar",
)

# Palabras que indican que Mercado Libre está pidiendo un atributo faltante.
_SENALES_FALTANTE = (
    "required", "missing", "obligatorio", "requerido", "requiere", "falta",
)

# IDs de atributo dentro de un mensaje ("The attributes [BRAND] are required").
_RE_ID_ATRIBUTO = re.compile(r"\b([A-Z][A-Z0-9_]{2,})\b")

# Caché en memoria: category_id → lista de atributos de la categoría.
_CACHE_ATRIBUTOS: Dict[str, List[dict]] = {}
# Caché negativa: category_id → timestamp del último fallo de consulta.
_CACHE_FALLOS: Dict[str, float] = {}


# =============================================================================
# CONSULTA DE ATRIBUTOS DE LA CATEGORÍA
# =============================================================================

def _normalizar_id(valor) -> str:
    """ID de atributo normalizado (mayúsculas, sin espacios)."""
    return str(valor or "").strip().upper()


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


def _es_requerido(atributo: dict) -> bool:
    """True si el atributo de categoría está marcado como obligatorio por ML."""
    tags = atributo.get("tags") or {}
    return bool(tags.get("required"))


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
    return _RE_ID_ATRIBUTO.findall(str(valor))


def _valor_desde_campos(
    fuente: str,
    valor_defecto: str,
    marca: str,
    modelo: str,
    nombre_categoria: str,
    titulo: str,
) -> str:
    """Resuelve el valor por defecto de un atributo de identidad."""
    campos = {
        "marca": marca,
        "modelo": modelo,
        "familia": marca or nombre_categoria or titulo,
        "nombre": nombre_categoria or titulo,
        "titulo": titulo,
    }
    valor = str(campos.get(fuente, "") or "").strip()
    return valor or valor_defecto


def _opcion_neutra(atributo: dict) -> Optional[dict]:
    """
    Devuelve `{"value_id", "value_name"}` con la primera opción neutra que
    ofrezca un atributo de lista (ej: "Otro", "No aplica"), o None.
    """
    for opcion in atributo.get("values") or []:
        if not isinstance(opcion, dict):
            continue
        nombre = str(opcion.get("name") or "").strip().lower()
        valor_id = str(opcion.get("id") or "").strip()
        if not valor_id:
            continue
        if nombre in OPCIONES_NEUTRAS or valor_id.lower() in OPCIONES_NEUTRAS:
            return {"value_id": valor_id, "value_name": opcion.get("name") or valor_id}
    return None


def _valor_para_atributo(
    atributo: dict,
    marca: str,
    modelo: str,
    nombre_categoria: str,
    titulo: str,
) -> Optional[dict]:
    """
    Construye el valor con el que se completa un atributo obligatorio faltante.

    - Atributos de identidad: marca/modelo/familia/nombre con default genérico.
    - Atributos de lista: opción neutra si existe (si no, no se completa).
    - Cualquier otro atributo (GTIN, talles, compatibilidades...): no se inventa.
    """
    aid = _normalizar_id(atributo.get("id"))
    if not aid:
        return None

    # Atributo de LISTA (la categoría define `values`): Mercado Libre solo
    # acepta una opción existente. Enviar texto libre produce HTTP 400
    # "body.invalid_fields" / "item.attribute.invalid", así que se usa la
    # opción neutra si existe y, si no, el atributo se omite.
    tiene_valores = bool(atributo.get("values"))

    if aid in ATRIBUTOS_IDENTIDAD and not tiene_valores:
        fuente, valor_defecto = ATRIBUTOS_IDENTIDAD[aid]
        return {
            "id": aid,
            "value_name": _valor_desde_campos(
                fuente, valor_defecto, marca, modelo, nombre_categoria, titulo
            ),
        }

    opcion = _opcion_neutra(atributo)
    if opcion:
        return {"id": aid, **opcion}

    logger.info(
        "Atributo obligatorio %s sin valor seguro disponible: se omite "
        "(requiere un dato real del objeto).", aid,
    )
    return None


def completar_attributes_requeridos(
    attributes,
    category_id,
    access_token: str = "",
    marca: str = "",
    modelo: str = "",
    nombre_categoria: str = "",
    titulo: str = "",
) -> List[dict]:
    """
    Completa la lista `attributes` con los obligatorios de la categoría.

    Solo agrega atributos que Mercado Libre define para la categoría destino y
    que están marcados como `required`, con un valor por defecto seguro cuando
    el objeto no trae el dato. Los atributos ya presentes nunca se modifican.

    Si la consulta de atributos de la categoría falla, devuelve la lista tal
    cual llegó: los atributos de identidad ya vienen garantizados por
    `construir_attributes_desde_objeto()` y `create_item` reintenta con las
    causas reales del error.
    """
    resultado: List[dict] = [
        dict(atributo)
        for atributo in (attributes or [])
        if isinstance(atributo, dict) and atributo.get("id")
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

    agregados: List[str] = []
    for atributo in definidos:
        if not isinstance(atributo, dict) or not _es_requerido(atributo):
            continue
        aid = _normalizar_id(atributo.get("id"))
        if not aid or aid in presentes:
            continue
        valor = _valor_para_atributo(
            atributo, marca, modelo, nombre_categoria, titulo
        )
        if not valor:
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
) -> List[dict]:
    """
    Devuelve los atributos de identidad que Mercado Libre pide y faltan.

    Se usa en los reintentos de `create_item`: analiza las causas del 400/422 y,
    si ML nombra un atributo obligatorio conocido (FAMILY_NAME, BRAND, MODEL,
    MANUFACTURER, ...) que no está en el payload, lo construye con valor por
    defecto. No agrega nada para atributos que exigen un dato verificable.
    """
    existentes = {
        _normalizar_id(a.get("id"))
        for a in (attributes or [])
        if isinstance(a, dict)
    }
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
                    aid in ATRIBUTOS_IDENTIDAD
                    and aid not in existentes
                    and aid not in pedidos
                ):
                    pedidos.append(aid)

    nuevos: List[dict] = []
    for aid in pedidos:
        fuente, valor_defecto = ATRIBUTOS_IDENTIDAD[aid]
        nuevos.append({
            "id": aid,
            "value_name": _valor_desde_campos(
                fuente, valor_defecto, marca, modelo, nombre_categoria, titulo
            ),
        })
        existentes.add(aid)
    return nuevos


def atributos_invalidos_por_causas(causes, attributes) -> List[str]:
    """
    IDs de atributos del payload que Mercado Libre rechazó como inválidos.

    Red de seguridad: si una categoría no admite uno de los atributos que
    enviamos (por ejemplo FAMILY_NAME en categorías que no lo definen), se
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


def menciona_family_name(causes) -> bool:
    """True si Mercado Libre exige `family_name` (atributo o campo raíz)."""
    texto = json.dumps(causes or [], ensure_ascii=False).lower()
    if "family_name" not in texto and "family name" not in texto:
        return False
    return any(senal in texto for senal in _SENALES_FALTANTE)


def familia_por_defecto(
    marca: str = "",
    modelo: str = "",
    nombre_categoria: str = "",
    titulo: str = "",
) -> str:
    """
    Valor de familia para el campo raíz `family_name` de Mercado Libre.

    Prioriza marca + modelo; si no hay datos, usa la categoría y, por último,
    las primeras palabras del título. Nunca devuelve vacío (ML exige valor).
    """
    partes = [str(marca or "").strip(), str(modelo or "").strip()]
    valor = " ".join(parte for parte in partes if parte).strip()
    if not valor:
        valor = str(nombre_categoria or "").strip()
    if not valor:
        valor = " ".join(str(titulo or "").split()[:5])
    return (valor or VALOR_GENERICO)[:60]
