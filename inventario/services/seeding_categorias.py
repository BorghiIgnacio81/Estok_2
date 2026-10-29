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
  2) Categorías BASE adicionales de uso cotidiano que NO están entre las 11
     oficiales («Ropa», «Libros» y «Cajas y Contenedores»), sembradas con
     `es_sistema=False` para que la limpieza destructiva del comando oficial
     NUNCA las elimine.

«Ropa» lleva el subtipo `ropa`, que es lo que hace que el formulario de alta y
el de EDICIÓN desplieguen el campo Talla / Tamaño sin depender del nombre.

«Cajas y Contenedores» es la categoría organizativa de los bultos que alojan
otros objetos: el listado de inventario agrupa los objetos así clasificados en
«📦 Cajas e Inventario Interno» (ver `arbol_inventario_objetos_contenedor`).

Módulo FUENTE ÚNICA de la siembra: lo consumen EstokCreateSerializer (alta
pública), SuperAdminEstokViewSet (alta desde el panel global) y el comando
`cargar_categorias_meli` (Estoks ya existentes en cada arranque).
"""

from django.db import transaction

from ..models import Categoria
from .categorias_meli import (
    CATEGORIAS_BASE_ADICIONALES,
    aplicar_categorias_oficiales_a_estok,
)


@transaction.atomic
def sembrar_categorias_base(estok):
    """
    Siembra las categorías base del Estok de forma atómica e IDEMPOTENTE.

    Devuelve la tupla (creadas, actualizadas). Se ejecuta dentro de la misma
    transacción del alta del Estok: si algo falla, el inquilinato completo se
    revierte y nunca queda a medio construir.
    """
    creadas, actualizadas = aplicar_categorias_oficiales_a_estok(estok)
    creadas_extra, actualizadas_extra = sembrar_categorias_adicionales(estok)
    return creadas + creadas_extra, actualizadas + actualizadas_extra


def sembrar_categorias_adicionales(estok):
    """
    Asegura «Ropa», «Libros» y «Cajas y Contenedores» en un Estok (idempotente,
    no destructivo).

    Reglas:
      · Si la categoría ya existe se PRESERVA y sólo se completa lo que falte
        (mapeo de Mercado Libre o subtipo): nunca se pisa un mapeo propio del
        usuario ni su ícono.
      · Si no existe se crea con `es_sistema=False`, blindada contra la limpieza
        destructiva del seeding oficial.

    Devuelve la tupla (creadas, actualizadas).
    """
    creadas = 0
    actualizadas = 0

    for cat in CATEGORIAS_BASE_ADICIONALES:
        # Se busca por NOMBRE porque `unique_together` es (nombre, estok): así
        # una categoría ya adoptada por el usuario no se duplica.
        fila = Categoria.objects.filter(
            estok=estok, nombre__iexact=cat["nombre"],
        ).first()

        if fila is None:
            Categoria.objects.create(
                estok=estok,
                nombre=cat["nombre"],
                icono=cat["icono"],
                mercadolibre_category_id=cat["mercadolibre_category_id"],
                subtipo=cat["subtipo"],
                es_contenedor=True,
                es_sistema=False,
            )
            creadas += 1
            continue

        cambios = []
        if not fila.mercadolibre_category_id:
            fila.mercadolibre_category_id = cat["mercadolibre_category_id"]
            cambios.append("mercadolibre_category_id")
        if not fila.subtipo:
            fila.subtipo = cat["subtipo"]
            cambios.append("subtipo")
        if cambios:
            fila.save(update_fields=cambios)
            actualizadas += 1

    return creadas, actualizadas
