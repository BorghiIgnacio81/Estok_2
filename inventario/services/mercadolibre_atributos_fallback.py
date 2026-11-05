"""
Fallback de atributos obligatorios de la categorÃ­a (pre-flight de publicaciÃ³n).

Mercado Libre rechaza POST /items con HTTP 400 "validation_error" /
"body.required_fields" cuando falta un atributo que la categorÃ­a marca como
obligatorio (`tags.required`), aunque el objeto del inventario no tenga ese dato
cargado (FAMILY_NAME, BRAND, MODEL, DEVELOPER, SOFTWARE_NAME...). Una
publicaciÃ³n no puede depender de que ML devuelva el 400 para descubrirlo, asÃ­
que este mÃ³dulo garantiza el valor ANTES de enviar el body:

1. `inyectar_atributos_requeridos()`: consulta GET /categories/{id}/attributes
   (catÃ¡logo REAL, con cachÃ©) y, por cada atributo obligatorio que falte en el
   payload, inyecta el valor que corresponde a su `value_type`: el dato REAL del
   objeto si existe y, si no, el fallback seguro (value_id de catÃ¡logo para
   listas, "No" para booleanos, nÃºmero + unidad y, en texto libre, "GenÃ©rico" /
   "Sin marca" / "Sin especificar").

2. `atributos_fallback_por_causas()`: Ãºltima red, para cuando la consulta del
   catÃ¡logo no estÃ¡ disponible (red caÃ­da). Usa SOLO los IDs que Mercado Libre
   nombrÃ³ en sus causas (`[DEVELOPER]` o `attribute`) y los completa con el
   valor genÃ©rico, sin volver a agregar los que ML ya rechazÃ³ en esta misma
   publicaciÃ³n (evita el bucle required_fields â†” invalid_fields).

Nunca duplica un atributo ya presente y NUNCA inventa IDs que la categorÃ­a no
declare: un atributo fuera del catÃ¡logo produce 400 "body.invalid_fields".

Usado por:
- inventario/api/viewsets/mercadolibre_views.py (publicar_item, pre-flight).
- inventario/services/mercadolibre_api.py (create_item, Ãºltimo reintento).
"""

import json
import logging
import re
from typing import List, Optional

from .mercadolibre_atributos import obtener_atributos_categoria
from .mercadolibre_atributos_reglas import es_requerido
from .mercadolibre_atributos_valores import (
    VALOR_GENERICO,
    normalizar_id,
    valor_para_atributo,
    valor_por_defecto,
)
from .mercadolibre_saneamiento import ATRIBUTOS_EN_RAIZ_ML

logger = logging.getLogger(__name__)

# Atributos de lista: SOLO aceptan un `value_id` del catÃ¡logo. Mandarles texto
# ("GenÃ©rico") produce 400 "body.invalid_fields", asÃ­ que si la categorÃ­a no
# publica opciones NO se inventa nada y queda constancia en el diagnÃ³stico.
TIPOS_LISTA = ("list", "list_of_values")

# IDs que Mercado Libre nombra en el mensaje de la causa:
#   "The attributes [BRAND, MODEL] are required"  /  "... [family_name]"
# Solo se aceptan tokens con forma de ID para no arrastrar palabras del texto.
_RE_GRUPO_ATRIBUTOS = re.compile(r"\[([^\]]+)\]")
_RE_ID_ML = re.compile(r"^[A-Za-z][A-Za-z0-9_]{2,}$")
_SEPARADORES_ID = re.compile(r"[,/]| and | y ")

# SeÃ±ales de que la causa de ML estÃ¡ pidiendo un atributo faltante.
_SENALES_FALTANTE = (
    "required", "missing", "obligatorio", "requerido", "requiere", "falta",
)


def _valor_fallback(atributo: dict, atributo_id: str,
                    datos: Optional[dict]) -> Optional[dict]:
    """
    Valor seguro para un atributo obligatorio sin dato real en el objeto.

    Primero se intenta el valor del catÃ¡logo (`value_id` para listas, "No",
    nÃºmero o el texto por defecto). Si el catÃ¡logo no publica opciones para un
    atributo de lista devuelve None: ningÃºn texto libre es vÃ¡lido ahÃ­.
    """
    valor = valor_para_atributo(atributo, datos)
    if valor:
        return valor
    if str(atributo.get("value_type") or "").strip().lower() in TIPOS_LISTA:
        return None
    texto = valor_por_defecto(atributo_id, datos) or VALOR_GENERICO
    return {"id": atributo_id, "value_name": texto}


def inyectar_atributos_requeridos(
    attributes,
    category_id,
    access_token: str = "",
    datos: Optional[dict] = None,
) -> dict:
    """
    Completa con un valor de fallback los atributos obligatorios de la categorÃ­a.

    Pre-flight de la publicaciÃ³n: se ejecuta en la vista ANTES de llamar a
    Mercado Libre para que el body nunca salga sin un atributo que la categorÃ­a
    exige (`tags.required`).

    Args:
        attributes: lista `attributes` ya armada con los datos reales del objeto.
        category_id: categorÃ­a destino de la publicaciÃ³n (MLAxxxx).
        access_token: token de ML (la consulta del catÃ¡logo es pÃºblica).
        datos: datos REALES del objeto (`construir_datos_objeto`), para preferir
            el valor cargado antes que el genÃ©rico.

    Returns:
        {
          "attributes": lista resultante (original + fallbacks inyectados),
          "inyectados": IDs agregados con el fallback,
          "omitidos": IDs obligatorios sin un valor vÃ¡lido posible
                      (atributos de lista sin opciones publicadas),
        }

    Si la consulta del catÃ¡logo no estÃ¡ disponible devuelve la lista tal cual:
    en ese caso el fallback por causas de ML de `atributos_fallback_por_causas`
    es la Ãºltima red.
    """
    resultado: List[dict] = [
        dict(atributo)
        for atributo in (attributes or [])
        if isinstance(atributo, dict) and atributo.get("id")
    ]
    presentes = {normalizar_id(atributo.get("id")) for atributo in resultado}
    inyectados: List[str] = []
    omitidos: List[str] = []

    definidos = obtener_atributos_categoria(category_id, access_token)
    if not definidos:
        logger.warning(
            "Sin catÃ¡logo de atributos para la categorÃ­a %s: no se puede "
            "inyectar el fallback de obligatorios por catÃ¡logo (queda el "
            "reintento por causas de Mercado Libre).", category_id,
        )
        return {
            "attributes": resultado,
            "inyectados": inyectados,
            "omitidos": omitidos,
        }

    for atributo in definidos:
        if not isinstance(atributo, dict) or not es_requerido(atributo):
            continue
        atributo_id = normalizar_id(atributo.get("id"))
        if (
            not atributo_id
            or atributo_id in presentes
            # FAMILY_NAME viaja en la RAÃZ del body (familia del Ã­tem), no acÃ¡.
            or atributo_id in ATRIBUTOS_EN_RAIZ_ML
        ):
            continue
        valor = _valor_fallback(atributo, atributo_id, datos)
        if not valor:
            omitidos.append(atributo_id)
            logger.warning(
                "Atributo obligatorio %s de %s sin opciones en el catÃ¡logo: no "
                "se envÃ­a un valor inventado (ML lo rechazarÃ­a con "
                "body.invalid_fields).", atributo_id, category_id,
            )
            continue
        resultado.append(valor)
        presentes.add(atributo_id)
        inyectados.append(atributo_id)

    if inyectados:
        logger.info(
            "Fallback de atributos obligatorios inyectado en %s: %s",
            category_id, ", ".join(inyectados),
        )
    return {
        "attributes": resultado,
        "inyectados": inyectados,
        "omitidos": omitidos,
    }


def _ids_nombrados(causa: dict) -> List[str]:
    """
    IDs de atributo que Mercado Libre nombra en UNA causa.

    Se toman los grupos entre corchetes del mensaje ("The attributes [BRAND,
    MODEL] are required") y el campo `attribute` de la causa. Nunca se aceptan
    palabras sueltas del texto: un ID inventado produce 400 invalid_fields.
    """
    candidatos: List[str] = []
    for referencia in (causa.get("attribute"), causa.get("message")):
        if not referencia:
            continue
        texto = str(referencia)
        for grupo in _RE_GRUPO_ATRIBUTOS.findall(texto):
            candidatos.extend(_SEPARADORES_ID.split(grupo))
        if referencia is causa.get("attribute"):
            candidatos.append(texto)

    ids: List[str] = []
    for candidato in candidatos:
        token = str(candidato or "").strip().strip("'\"")
        if not _RE_ID_ML.match(token):
            continue
        atributo_id = normalizar_id(token)
        if atributo_id and atributo_id not in ids:
            ids.append(atributo_id)
    return ids


def atributos_fallback_por_causas(
    causes,
    attributes,
    datos: Optional[dict] = None,
    descartados=None,
) -> List[dict]:
    """
    Atributos que Mercado Libre pide y NO estÃ¡n en el payload, con valor genÃ©rico.

    Ãšltima red de seguridad de `create_item`: se usa cuando la consulta del
    catÃ¡logo de la categorÃ­a no devolviÃ³ datos (red caÃ­da) y
    `completar_attributes_requeridos()` no pudo agregar el obligatorio.

    Args:
        causes: arreglo `cause` crudo de la respuesta de ML.
        attributes: `attributes` del payload del intento que fallÃ³.
        datos: datos REALES del objeto (para "Sin marca" / el dato cargado).
        descartados: IDs que ML ya rechazÃ³ en esta publicaciÃ³n (no se repiten).

    Returns:
        Lista de atributos NUEVOS listos para el payload (vacÃ­a si no aplica).
    """
    existentes = {
        normalizar_id(a.get("id"))
        for a in (attributes or [])
        if isinstance(a, dict)
    }
    rechazados = {normalizar_id(aid) for aid in (descartados or ())}

    pedidos: List[str] = []
    for causa in causes or []:
        if not isinstance(causa, dict):
            continue
        texto = json.dumps(causa, ensure_ascii=False).lower()
        if not any(senal in texto for senal in _SENALES_FALTANTE):
            continue
        for atributo_id in _ids_nombrados(causa):
            if (
                atributo_id in existentes
                or atributo_id in rechazados
                or atributo_id in ATRIBUTOS_EN_RAIZ_ML
                or atributo_id in pedidos
            ):
                continue
            pedidos.append(atributo_id)

    nuevos: List[dict] = []
    for atributo_id in pedidos:
        texto = valor_por_defecto(atributo_id, datos) or VALOR_GENERICO
        nuevos.append({"id": atributo_id, "value_name": texto})
        existentes.add(atributo_id)

    if nuevos:
        logger.info(
            "Atributos obligatorios completados por causas de ML (fallback "
            "genÃ©rico, sin catÃ¡logo disponible): %s",
            ", ".join(atributo["id"] for atributo in nuevos),
        )
    return nuevos
