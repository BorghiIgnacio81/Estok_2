"""
Resolución del mapeo de Mercado Libre para categorías NUEVAS (creadas por el
usuario desde la interfaz).

Problema que resuelve: al crear una categoría personalizada, el alta debía
quedar con un `mercadolibre_category_id` válido para que las publicaciones
posteriores no se bloquearan. Antes sólo se "predecía" y se guardaba cualquier
resultado (incluso IDs inexistentes o categorías contenedor, que Mercado Libre
rechaza con HTTP 400 al publicar).

Cadena de resolución (degradación controlada, NUNCA lanza excepciones):
  1. Nombre conocido (11 oficiales + «Ropa»/«Libros») → ID hardcodeado.
  2. Búsqueda/predicción pública de Mercado Libre
     (`category_predictor` + `domain_discovery/search`).
  3. Verificación de categoría HOJA publicable (GET /categories/{id}).
  4. Fallback genérico oficial `CATEGORIA_MELI_DEFAULT` (MLA1383 «Otros»,
     hoja verificada).

Módulo separado de `categorias_meli` (que conserva la publicación y el seeding)
para mantener cada responsabilidad en un archivo acotado.
"""

import logging

from inventario.management.commands.cargar_categorias_meli import (
    CATEGORIAS_OFICIALES,
)
from inventario.services.categorias_meli import (
    CATEGORIAS_BASE_ADICIONALES,
    es_categoria_hoja_ml,
    normalizar_id_ml,
)
from inventario.services.mercadolibre_api import (
    CATEGORIA_MELI_DEFAULT,
    predict_category,
)

logger = logging.getLogger(__name__)


def id_ml_conocido_por_nombre(nombre: str) -> str:
    """
    ID de ML hardcodeado para un nombre CONOCIDO (11 oficiales + base adicional).

    Evita una llamada a la API cuando el nombre es exactamente «Ropa», «Libros»,
    «Muebles», etc. Devuelve '' si el nombre no está en el catálogo conocido.
    """
    buscado = str(nombre or "").strip().casefold()
    if not buscado:
        return ""
    for cat in list(CATEGORIAS_OFICIALES) + list(CATEGORIAS_BASE_ADICIONALES):
        if str(cat["nombre"]).strip().casefold() == buscado:
            return cat["mercadolibre_category_id"]
    return ""


def resolver_mapeo_categoria_ml(nombre: str, access_token: str = "") -> str:
    """
    Devuelve SIEMPRE un `mercadolibre_category_id` utilizable para una categoría
    nueva, verificando que sea una categoría HOJA publicable cuando la API
    responde. Sin coincidencia utilizable → fallback genérico válido.

    El alta de categorías jamás se aborta por culpa de Mercado Libre.
    """
    texto = str(nombre or "").strip()
    conocido = id_ml_conocido_por_nombre(texto)
    if conocido:
        logger.info("Categoría '%s' mapeada por alias conocido → %s", texto, conocido)
        return conocido
    if not texto:
        return CATEGORIA_MELI_DEFAULT

    try:
        predicho = normalizar_id_ml(
            predict_category(texto, access_token=access_token)
        )
    except Exception as exc:  # noqa: BLE001 - el predictor jamás aborta el alta
        logger.warning("Predictor de ML indisponible para '%s': %s", texto, exc)
        predicho = ""

    # `es_categoria_hoja_ml` devuelve None si no pudo verificar (red caída):
    # en ese caso se confía en la predicción para no bloquear el alta.
    if predicho and es_categoria_hoja_ml(predicho, access_token) is not False:
        logger.info("Categoría '%s' → mapeo ML verificado %s", texto, predicho)
        return predicho

    logger.info(
        "Categoría '%s' sin coincidencia publicable en ML; usando fallback %s",
        texto, CATEGORIA_MELI_DEFAULT,
    )
    return CATEGORIA_MELI_DEFAULT
