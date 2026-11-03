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
      3. Su rótulo EMPIEZA por «Caja» («Caja 02», «Cajas 03», «Caja de
         herramientas»): el nombre es señal suficiente, sin checkbox manual.
      4. El alta rápida lo declaró caja (`especificaciones.alta_rapida='caja'`).

    Para todo Objeto que cumpla la regla se garantiza:
      · `es_contenedor = True` (el flag de contenedor NUNCA se pierde).
      · `categoria = «Cajas y Contenedores»` SI Y SÓLO SI no tenía categoría:
        una categoría elegida por el operador jamás se pisa.

    La siembra de la categoría base se delega en
    `services.seeding_categorias.sembrar_categorias_adicionales`, fuente única.

Se invoca desde:
    · el CRUD de Objetos (POST y PUT) para que la clasificación se conserve
      aunque el cliente envíe un payload parcial de reubicación;
    · `ObjetoCreateSerializer.validate` (AUTO-ACTIVACIÓN obligatoria: el flag
      viaja forzado en el mismo guardado, sin checkbox del operador);
    · la señal post_save de Objeto (cualquier otro camino de escritura).
"""

import logging

from ..models import Categoria
from .arbol_inventario_objetos_contenedor import (
    CATEGORIAS_OBJETO_CONTENEDOR,
    es_nombre_de_caja,
)
from .categorias_meli import CATEGORIAS_BASE_ADICIONALES
from .taxonomia_contenedor import es_categoria_de_caja

logger = logging.getLogger(__name__)

# Nombre canónico de la categoría organizativa de los bultos contenedores.
NOMBRE_CATEGORIA_CONTENEDOR = 'Cajas y Contenedores'

# Valor de `especificaciones.alta_rapida` que declara el objeto como CAJA
# (disyuntor «Caja / Mueble» del alta: ver `frontend/src/lib/objetos/
# objetoClasificacionAlta.ts`).
ALTA_RAPIDA_CAJA = 'caja'


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


def es_categoria_contenedor(categoria) -> bool:
    """
    True si la `Categoria` declara bultos contenedores («Cajas y Contenedores»).

    Acepta la instancia del modelo (o None). Tolera las variantes manuales del
    nombre («Cajas / Contenedores», «Cajas/Contenedor») y la marca
    `Categoria.es_contenedor` con la que se siembra la categoría base.
    """
    if categoria is None:
        return False
    nombre = str(getattr(categoria, 'nombre', '') or '').strip().casefold()
    if nombre in CATEGORIAS_OBJETO_CONTENEDOR:
        return True
    if es_categoria_de_caja(nombre):
        return True
    return bool(getattr(categoria, 'es_contenedor', False))


def declara_contenedor(nombre=None, categoria=None, especificaciones=None) -> bool:
    """
    REGLA ÚNICA de declaración de CAJA sobre datos sueltos (sin consultas).

    Basta UNA condición:
      1. El rótulo EMPIEZA por «Caja»/«Cajas» (`es_nombre_de_caja`).
      2. La categoría es «Cajas y Contenedores» (`es_categoria_contenedor`).
      3. El alta rápida lo declaró caja (`especificaciones.alta_rapida='caja'`).

    El ESPEJO de dualidad de un Contenedor (`especificaciones.
    es_espejo_contenedor`) NUNCA declara caja: su caja real ya existe como
    `Contenedor` y marcarlo duplicaría el bulto en las pestañas.

    La usan el serializer (auto-activación obligatoria del flag al guardar) y
    la clasificación de cualquier registro ya persistido (`es_objeto_caja`).
    """
    especificaciones = especificaciones or {}
    if especificaciones.get('es_espejo_contenedor'):
        return False
    if especificaciones.get('alta_rapida') == ALTA_RAPIDA_CAJA:
        return True
    if es_nombre_de_caja(nombre):
        return True
    return es_categoria_contenedor(categoria)


def es_objeto_caja(objeto) -> bool:
    """True si el Objeto es una caja/contenedor por marca, rótulo o categoría."""
    if objeto is None:
        return False
    if bool(getattr(objeto, 'es_contenedor', False)):
        return True
    return declara_contenedor(
        getattr(objeto, 'nombre', ''),
        getattr(objeto, 'categoria', None),
        getattr(objeto, 'especificaciones', None),
    )


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
