"""
Seeding canónico de las CATEGORÍAS BASE de un Estok recién fundado.

Problema que resuelve: el combobox «Categoría» del alta/edición de objetos
(GET /api/categorias/) nacía VACÍO para todo inquilinato nuevo, porque las 11
categorías oficiales se sembraban sólo con el comando de arranque
(cargar_categorias_meli) y no en el alta. El usuario del Onboarding veía una
lista sin opciones y no podía clasificar su primer objeto.

Alcance:
  1) Las 11 categorías OFICIALES de Mercado Libre (reutiliza el servicio
     existente `aplicar_categorias_oficiales_a_estok`, idempotente).
  2) Dos categorías BASE adicionales de uso cotidiano que NO están entre las 11
     oficiales («Ropa» y «Libros»), sembradas con `es_sistema=False` para que la
     limpieza destructiva del comando oficial NUNCA las elimine.

Módulo FUENTE ÚNICA: lo consume EstokCreateSerializer (alta de usuario/admin).
"""

from django.db import transaction

from ..models import Categoria
from .categorias_meli import aplicar_categorias_oficiales_a_estok

# ---------------------------------------------------------------------------
# CATEGORÍAS BASE ADICIONALES (no oficiales de Mercado Libre)
# Se marcan es_sistema=False para quedar BLINDADAS contra la limpieza del
# seeding oficial. «Libros» lleva el ID real que ya usa el predictor del proyecto
# (MLA412445 «Libros Físicos»); «Ropa» se deja sin mapeo para que la publicación
# lo prediga con el NOMBRE DEL OBJETO (misma regla que una categoría de usuario).
# ---------------------------------------------------------------------------
CATEGORIAS_BASE_ADICIONALES = [
    {"nombre": "Ropa", "mercadolibre_category_id": None, "icono": "👕"},
    {"nombre": "Libros", "mercadolibre_category_id": "MLA412445", "icono": "📚"},
]


@transaction.atomic
def sembrar_categorias_base(estok):
    """
    Siembra las categorías base del Estok de forma atómica e IDEMPOTENTE.

    Devuelve la tupla (creadas, actualizadas). Se ejecuta dentro de la misma
    transacción del alta del Estok: si algo falla, el inquilinato completo se
    revierte y nunca queda a medio construir.
    """
    creadas, actualizadas = aplicar_categorias_oficiales_a_estok(estok)

    for cat in CATEGORIAS_BASE_ADICIONALES:
        # Se busca por NOMBRE porque `unique_together` es (nombre, estok): así una
        # categoría ya adoptada por el usuario no se duplica ni se pisa.
        fila = Categoria.objects.filter(
            estok=estok, nombre__iexact=cat["nombre"],
        ).first()
        if fila is not None:
            actualizadas += 1
            continue
        Categoria.objects.create(
            estok=estok,
            nombre=cat["nombre"],
            icono=cat["icono"],
            mercadolibre_category_id=cat["mercadolibre_category_id"],
            es_contenedor=True,
            es_sistema=False,
        )
        creadas += 1

    return creadas, actualizadas
