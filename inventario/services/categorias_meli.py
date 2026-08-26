"""
Servicio central de seeding de las 11 categorías atómicas de Mercado Libre.

Único punto de entrada para inyectar las 11 categorías oficiales de Mercado
Libre Argentina en un Estok específico (aislamiento multi-tenant).

La lista oficial (CATEGORIAS_OFICIALES) vive hardcodeada en
inventario/management/commands/cargar_categorias_meli.py y se importa desde
aquí para NO duplicarla en otro archivo (un solo origen de verdad).

Usado por:
- inventario/api/viewsets/super_admin.py: trigger de seeding al crear un Estok
  en caliente desde el panel Admin Global (combobox de categorías nunca vacío).
"""
from inventario.management.commands.cargar_categorias_meli import (
    CATEGORIAS_OFICIALES,
)
from inventario.models.clasificacion import Categoria


def aplicar_categorias_oficiales_a_estok(estok):
    """
    Crea o actualiza las 11 categorías oficiales de Mercado Libre para un Estok.

    Idempotente: usa update_or_create sobre (meli_category_id, estok), por lo
    que puede ejecutarse múltiples veces (arranque del contenedor + triggers en
    caliente) sin duplicar ni pisar nada.

    Devuelve la tupla (creadas, actualizadas).
    """
    creadas = 0
    actualizadas = 0
    for cat in CATEGORIAS_OFICIALES:
        _, created = Categoria.objects.update_or_create(
            meli_category_id=cat["meli_category_id"],
            estok=estok,
            defaults={
                "nombre": cat["nombre"],
                "icono": cat["icono"],
                "es_contenedor": True,
            },
        )
        if created:
            creadas += 1
        else:
            actualizadas += 1
    return creadas, actualizadas
