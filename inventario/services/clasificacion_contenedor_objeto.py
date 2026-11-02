"""
COHERENCIA CAJA ⇄ CATEGORÍA «Cajas y Contenedores» en cada escritura de Objeto.

PROBLEMA QUE RESUELVE
    Al arrastrar una caja (Cajas 02, 03, 04, 05) desde la bandeja flotante de
    /almacenamiento al lienzo, el PUT sólo viaja con la jerarquía espacial
    (`ubicacion` / `contenedor` / `parent_grid_*`). Si el registro se había
    creado sin categoría —o si su marca `es_contenedor` había quedado en falso—
    la caja se degradaba a «Objeto Suelto» y desaparecía de la sección
    «📦 Cajas e Inventario Interno» del listado de /objetos.

REGLA ÚNICA (idempotente, no destructiva)
    Un Objeto es CAJA/CONTENEDOR cuando cumple AL MENOS una condición:
      1. `es_contenedor = True` (disyuntor «Caja / Mueble» del alta).
      2. Su categoría es «Cajas y Contenedores» (categoría base del Estok).
      3. Su rótulo es el de una caja numerada («Caja 02», «Cajas 03»).

    Para todo Objeto que cumpla la regla se garantiza:
      · `es_contenedor = True` (el flag de contenedor NUNCA se pierde).
      · `categoria = «Cajas y Contenedores»` SI Y SÓLO SI no tenía categoría:
        una categoría elegida por el operador jamás se pisa.

    La siembra de la categoría base se delega en
    `services.seeding_categorias.sembrar_categorias_adicionales`, fuente única.

Se invoca desde el CRUD de Objetos (POST y PUT) para que la clasificación se
conserve aunque el cliente envíe un payload parcial de reubicación.
"""

import logging

from ..models import Categoria
from .arbol_inventario_objetos_contenedor import (
    CATEGORIAS_OBJETO_CONTENEDOR,
    es_nombre_de_caja,
)
from .categorias_meli import CATEGORIAS_BASE_ADICIONALES

logger = logging.getLogger(__name__)

# Nombre canónico de la categoría organizativa de los bultos contenedores.
NOMBRE_CATEGORIA_CONTENEDOR = 'Cajas y Contenedores'


def _definicion_categoria_contenedor():
    """Definición canónica (ícono / mapeo ML) de la categoría de cajas."""
    for cat in CATEGORIAS_BASE_ADICIONALES:
        if cat['nombre'].strip().casefold() == NOMBRE_CATEGORIA_CONTENEDOR.casefold():
            return cat
    return None


def categoria_contenedor_del_estok(estok):
    """
    Categoría «Cajas y Contenedores» del Estok (la crea si faltara).

    Nunca lanza: si la siembra fallara, la coherencia de la categoría se omite
    pero el flag `es_contenedor` igual queda persistido.
    """
    if estok is None:
        return None

    fila = Categoria.objects.filter(
        estok=estok, nombre__iexact=NOMBRE_CATEGORIA_CONTENEDOR,
    ).first()
    if fila is not None:
        return fila

    definicion = _definicion_categoria_contenedor()
    if definicion is None:
        return None
    try:
        return Categoria.objects.create(
            estok=estok,
            nombre=definicion['nombre'],
            icono=definicion['icono'],
            mercadolibre_category_id=definicion.get('mercadolibre_category_id') or None,
            subtipo=definicion.get('subtipo') or '',
            es_contenedor=True,
            es_sistema=False,
        )
    except Exception as exc:  # noqa: BLE001 - la coherencia jamás rompe el PUT
        logger.warning(
            'No se pudo crear la categoría «%s» en el Estok %s: %s',
            NOMBRE_CATEGORIA_CONTENEDOR, estok.pk, exc,
        )
        return Categoria.objects.filter(
            estok=estok, nombre__iexact=NOMBRE_CATEGORIA_CONTENEDOR,
        ).first()


def es_objeto_caja(objeto) -> bool:
    """True si el Objeto es una caja/contenedor por marca, categoría o rótulo."""
    if objeto is None:
        return False
    if bool(getattr(objeto, 'es_contenedor', False)):
        return True
    if es_nombre_de_caja(getattr(objeto, 'nombre', '')):
        return True
    # Sin categoría asignada no hay nada más que evaluar (ni una query extra).
    if getattr(objeto, 'categoria_id', None) is None:
        return False
    categoria = getattr(objeto, 'categoria', None)
    nombre_categoria = str(getattr(categoria, 'nombre', '') or '').strip().casefold()
    return nombre_categoria in CATEGORIAS_OBJETO_CONTENEDOR


def asegurar_clasificacion_contenedor(objeto) -> bool:
    """
    Persiste la coherencia caja ⇄ categoría. Devuelve True si hubo cambios.

    Sólo escribe lo que falta: nunca quita la marca ni reemplaza una categoría
    existente elegida por el operador.
    """
    if not es_objeto_caja(objeto):
        return False

    cambios = []
    if not objeto.es_contenedor:
        objeto.es_contenedor = True
        cambios.append('es_contenedor')

    if objeto.categoria_id is None:
        categoria = categoria_contenedor_del_estok(getattr(objeto, 'estok', None))
        if categoria is not None:
            objeto.categoria = categoria
            cambios.append('categoria')

    if not cambios:
        return False

    objeto.save(update_fields=cambios)
    logger.info(
        'Clasificación de contenedor asegurada en el objeto %s (%s).',
        objeto.pk, ', '.join(cambios),
    )
    return True
