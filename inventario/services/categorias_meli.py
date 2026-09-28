"""
Servicio central de categorías de Mercado Libre.

Dos responsabilidades:

1. Seeding de las 11 categorías atómicas oficiales (lista hardcodeada en
   inventario/management/commands/cargar_categorias_meli.py, único origen de
   verdad) para un Estok específico (aislamiento multi-tenant).
2. RESOLUCIÓN DINÁMICA del `category_id` que viaja en el POST /items: es el
   único lugar del backend que decide qué categoría de Mercado Libre se usa al
   publicar, tanto para las 11 del sistema como para las categorías creadas por
   el usuario (el catálogo NO está limitado a una lista fija).

Regla de oro (bug histórico corregido): el `category_id` se resuelve con el
NOMBRE DE LA CATEGORÍA del objeto, NUNCA con el título del ítem. Predecir con el
título desviaba publicaciones a categorías absurdas (un cómic de Garfield
terminó publicado en "Tartas y Tortas Dulces").

Usado por:
- inventario/api/viewsets/super_admin.py: seeding al crear un Estok en caliente.
- inventario/api/viewsets/categorias.py: mapeo al crear una categoría.
- inventario/api/viewsets/mercadolibre_views.py: al publicar un objeto.
"""

import logging
import re

from inventario.management.commands.cargar_categorias_meli import (
    CATEGORIAS_OFICIALES,
)
from inventario.models.clasificacion import Categoria
from inventario.services.mercadolibre_api import (
    CATEGORIA_MELI_DEFAULT,
    predict_category,
)

logger = logging.getLogger(__name__)

# Formato oficial de la API de Mercado Libre para el ID de categoría (MLAxxxxx).
PATRON_ID_ML = re.compile(r'^MLA\d+$')


def es_id_ml_valido(valor) -> bool:
    """True si `valor` tiene el formato oficial de la API (ej: "MLA412445")."""
    return bool(PATRON_ID_ML.match(str(valor or '').strip().upper()))


def normalizar_id_ml(valor) -> str:
    """Devuelve el ID normalizado (sin espacios, mayúsculas) o '' si no es válido."""
    limpio = str(valor or '').strip().upper()
    return limpio if PATRON_ID_ML.match(limpio) else ''


def predecir_id_ml(nombre_categoria: str, access_token: str = "") -> str:
    """
    Predice el ID de Mercado Libre para un NOMBRE de categoría.

    Nunca falla: si el predictor no responde (o el nombre está vacío) devuelve
    CATEGORIA_MELI_DEFAULT, de modo que el alta de categorías y la publicación
    jamás se abortan por culpa de Mercado Libre.
    """
    nombre = str(nombre_categoria or '').strip()
    predicho = ''
    if nombre:
        try:
            predicho = normalizar_id_ml(
                predict_category(nombre, access_token=access_token)
            )
        except Exception as exc:  # noqa: BLE001 - nunca abortar por el predictor
            logger.warning("Predictor de ML indisponible para '%s': %s", nombre, exc)
        if predicho:
            logger.info("Categoría '%s' → predicción ML %s", nombre, predicho)
    if not predicho:
        logger.info(
            "Categoría '%s' sin coincidencia en ML; usando default %s",
            nombre, CATEGORIA_MELI_DEFAULT,
        )
        return CATEGORIA_MELI_DEFAULT
    return predicho


def resolver_category_id_ml(categoria, texto_fallback: str = "",
                            access_token: str = "") -> str:
    """
    Devuelve SIEMPRE el `category_id` con el que se debe publicar en ML.

    Orden ESTRICTO:
    1. `Categoria.mercadolibre_category_id` guardado y con formato válido
       (ej: "MLA412445") → se usa tal cual, SIN llamar a la API.
    2. Sin mapeo → se predice con el NOMBRE de la categoría (`texto_fallback`
       se usa solo si la categoría no tiene nombre) y el resultado se PERSISTE
       en la base de datos, para que esa categoría —aunque la haya creado el
       usuario— quede mapeada y funcional en la próxima publicación.
    3. Si no hay forma de predecir → CATEGORIA_MELI_DEFAULT.

    Args:
        categoria: instancia de Categoria (puede ser None).
        texto_fallback: texto a usar si la categoría no tiene nombre.
        access_token: token OAuth opcional para el predictor oficial.

    Returns:
        str con el category_id (formato MLAxxxxx).
    """
    guardado = normalizar_id_ml(getattr(categoria, 'mercadolibre_category_id', ''))
    if guardado:
        logger.info(
            "category_id estricto desde la BD: %s (categoría '%s')",
            guardado, getattr(categoria, 'nombre', ''),
        )
        return guardado

    nombre = (getattr(categoria, 'nombre', '') or '').strip() or str(texto_fallback or '').strip()
    predicho = predecir_id_ml(nombre, access_token=access_token)

    if categoria is not None and hasattr(categoria, 'save'):
        try:
            categoria.mercadolibre_category_id = predicho
            categoria.save(update_fields=['mercadolibre_category_id'])
            logger.info(
                "Mapeo ML persistido: categoría '%s' → %s",
                getattr(categoria, 'nombre', ''), predicho,
            )
        except Exception as exc:  # noqa: BLE001 - persistir es best-effort
            logger.warning("No se pudo persistir el mapeo ML: %s", exc)

    return predicho


def aplicar_categorias_oficiales_a_estok(estok):
    """
    Crea o actualiza las 11 categorías oficiales de Mercado Libre para un Estok.

    Idempotente: usa update_or_create sobre (mercadolibre_category_id, estok),
    por lo que puede ejecutarse múltiples veces (arranque del contenedor +
    triggers en caliente) sin duplicar ni pisar nada.

    Devuelve la tupla (creadas, actualizadas).
    """
    creadas = 0
    actualizadas = 0
    for cat in CATEGORIAS_OFICIALES:
        _, created = Categoria.objects.update_or_create(
            mercadolibre_category_id=cat["mercadolibre_category_id"],
            estok=estok,
            defaults={
                "nombre": cat["nombre"],
                "icono": cat["icono"],
                "es_contenedor": True,
                "es_sistema": True,
            },
        )
        if created:
            creadas += 1
        else:
            actualizadas += 1
    return creadas, actualizadas

