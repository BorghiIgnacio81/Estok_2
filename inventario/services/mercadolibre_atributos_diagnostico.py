"""
Diagnóstico de atributos de la categoría de Mercado Libre.

Genera la lista `atributos_detectados_categoria` que el backend devuelve en el
HTTP 400 de /api/mercadolibre/publicar_item/ junto con el payload exacto y la
respuesta cruda de ML. Permite ver en pantalla o en la consola (F12) por qué un
atributo (por ejemplo FAMILY_NAME) se incluyó, se omitió o quedó fuera del
catálogo de la categoría.

La lista NO arrastra el catálogo completo de valores (puede pesar cientos de
KB): incluye los atributos relevantes con sus tags y las primeras 25 opciones.

Usado por:
- inventario/services/mercadolibre_api.py (create_item → diagnóstico HTTP 400).
"""

from typing import List

from .mercadolibre_atributos import obtener_atributos_categoria
from .mercadolibre_atributos_reglas import (
    debe_incluir,
    es_catalog_required,
    es_requerido,
)
from .mercadolibre_atributos_valores import normalizar_id

# Tope de opciones por atributo: alcanza para diagnosticar sin inflar el JSON.
MAX_OPCIONES_DIAGNOSTICO = 25


def atributos_detectados(category_id, access_token: str = "") -> List[dict]:
    """
    Catálogo COMPLETO de la categoría, en formato compacto de diagnóstico.

    Incluye todos los IDs que devuelve GET /categories/{id}/attributes para que
    se pueda ver si `FAMILY_NAME` existe o no, y marca con `enviado=True` los
    que el backend incluyó en el payload (required / catalog_required /
    identidad). Las opciones de catálogo se incluyen solo para los enviados
    (máximo 25) para no inflar el JSON con cientos de valores.

    Cada elemento: id, name, value_type, required, catalog_required, tags,
    values_count, enviado y values (id/name).
    """
    detectados: List[dict] = []
    for atributo in obtener_atributos_categoria(category_id, access_token):
        if not isinstance(atributo, dict):
            continue
        opciones = atributo.get("values")
        if not isinstance(opciones, list):
            opciones = []
        enviado = debe_incluir(atributo)
        detectados.append({
            "id": normalizar_id(atributo.get("id")),
            "name": atributo.get("name") or "",
            "value_type": atributo.get("value_type") or "",
            "required": es_requerido(atributo),
            "catalog_required": es_catalog_required(atributo),
            "tags": atributo.get("tags") or {},
            "values_count": len(opciones),
            "enviado": enviado,
            "values": [
                {"id": str(opcion.get("id") or ""),
                 "name": str(opcion.get("name") or "")}
                for opcion in (opciones[:MAX_OPCIONES_DIAGNOSTICO] if enviado else [])
                if isinstance(opcion, dict)
            ],
        })
    return detectados
