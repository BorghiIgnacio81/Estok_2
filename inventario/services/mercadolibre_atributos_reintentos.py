"""
Reintentos de `attributes` guiados por las causas REALES de Mercado Libre.

Este módulo resuelve, en un único lugar, el bucle clásico de publicación:

    body.required_fields  → falta un atributo obligatorio de la categoría
    body.invalid_fields   → el valor enviado no pertenece al catálogo
    body.required_fields  → se quitó el atributo y vuelve a faltar...

Reglas:

1. Si ML rechaza un atributo OBLIGATORIO se intenta UNA sola corrección con el
   catálogo (`value_id` / opción válida). Si no se puede corregir o ya se
   intentó, se descarta y se recuerda para no volver a agregarlo.
2. Si ML pide un atributo obligatorio, solo se agrega si NO fue rechazado antes
   en esta misma publicación. Si hay conflicto (ML lo exige y lo rechaza), se
   corta el reintento y se devuelve el error real de la API.
3. Nunca se agrega texto libre a un atributo de lista: el valor se construye
   según el `value_type` del catálogo (mercadolibre_atributos_valores.py).

Usado por:
- inventario/services/mercadolibre_api.py (create_item, intentos 5 y 6).
"""

import logging
from typing import Optional

from .mercadolibre_atributos import (
    atributos_faltantes_por_causas,
    atributos_invalidos_por_causas,
    obtener_atributos_categoria,
    valor_catalogo_atributo,
)

logger = logging.getLogger(__name__)

# Acciones que debe tomar el bucle de reintentos de create_item().
ACCION_NINGUNA = "ninguna"       # el error no es de atributos
ACCION_REINTENTAR = "reintentar"  # attributes cambió: enviar de nuevo
ACCION_CORTAR = "cortar"          # conflicto real: devolver el error de ML


def aplicar_causas_atributos(
    causes,
    attributes,
    category_id,
    access_token: str = "",
    datos: Optional[dict] = None,
    requeridos=None,
    corregidos=None,
    descartados=None,
) -> dict:
    """
    Ajusta la lista `attributes` según las causas de error de Mercado Libre.

    Args:
        causes: arreglo `cause` crudo de la respuesta de ML.
        attributes: lista `attributes` del payload actual.
        category_id: categoría destino (para consultar su catálogo real).
        access_token: token de ML (la consulta de categoría es pública).
        datos: datos REALES del objeto (construir_datos_objeto).
        requeridos: IDs obligatorios de la categoría actual.
        corregidos: set de IDs ya corregidos con catálogo (se muta).
        descartados: set de IDs ya rechazados por ML (se muta).

    Returns:
        {
          "accion": ACCION_NINGUNA | ACCION_REINTENTAR | ACCION_CORTAR,
          "attributes": lista resultante,
          "ids": IDs involucrados (para logs),
        }
    """
    attributes = list(attributes or [])
    requeridos = set(requeridos or ())
    corregidos = corregidos if corregidos is not None else set()
    descartados = descartados if descartados is not None else set()

    # ── Atributo enviado que ML rechazó (body.invalid_fields) ────────────────
    invalidos = atributos_invalidos_por_causas(causes, attributes)
    if invalidos:
        restantes: list = []
        corregidos_ok: list = []
        quitados: list = []
        for atributo in attributes:
            aid = str(atributo.get("id", "")).strip().upper()
            if aid not in invalidos:
                restantes.append(atributo)
                continue
            if aid in requeridos and aid not in corregidos:
                nuevo = valor_catalogo_atributo(
                    aid, category_id, access_token, datos
                )
                corregidos.add(aid)
                if nuevo:
                    restantes.append(nuevo)
                    corregidos_ok.append(aid)
                    continue
            descartados.add(aid)
            quitados.append(aid)

        if corregidos_ok or quitados:
            logger.info(
                "Atributos corregidos con el catálogo de %s: [%s] | "
                "descartados por ML: [%s]",
                category_id,
                ", ".join(corregidos_ok) or "-",
                ", ".join(quitados) or "-",
            )
            return {
                "accion": ACCION_REINTENTAR,
                "attributes": restantes,
                "ids": corregidos_ok + quitados,
            }

        logger.error(
            "ML rechaza los atributos obligatorios [%s] y no hay corrección "
            "posible con el catálogo de %s: se corta el reintento para no "
            "repetir el bucle required_fields ↔ invalid_fields.",
            ", ".join(invalidos), category_id,
        )
        return {
            "accion": ACCION_CORTAR,
            "attributes": attributes,
            "ids": invalidos,
        }

    # ── Atributo obligatorio que ML pide (body.required_fields) ──────────────
    faltantes = atributos_faltantes_por_causas(
        causes,
        attributes,
        definidos=obtener_atributos_categoria(category_id, access_token),
        datos=datos,
    )
    if faltantes:
        solicitados = [a["id"] for a in faltantes]
        pendientes = [
            a for a in faltantes
            if str(a.get("id", "")).strip().upper() not in descartados
        ]
        if not pendientes:
            logger.error(
                "Conflicto de Mercado Libre: exige [%s] pero rechazó ese "
                "atributo en esta misma publicación. Se devuelve el error real "
                "sin seguir reintentando.",
                ", ".join(solicitados),
            )
            return {
                "accion": ACCION_CORTAR,
                "attributes": attributes,
                "ids": solicitados,
            }

        logger.info(
            "Atributos obligatorios agregados desde el catálogo: [%s]",
            ", ".join(a["id"] for a in pendientes),
        )
        return {
            "accion": ACCION_REINTENTAR,
            "attributes": attributes + pendientes,
            "ids": [a["id"] for a in pendientes],
        }

    return {"accion": ACCION_NINGUNA, "attributes": attributes, "ids": []}
