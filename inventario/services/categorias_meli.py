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
- inventario/services/seeding_categorias.py: siembra base del alta de Estok.
- inventario/api/viewsets/super_admin.py: seeding al crear un Estok en caliente.
- inventario/api/viewsets/mercadolibre_views.py: al publicar un objeto.

La resolución del mapeo de categorías NUEVAS (alta desde la interfaz) vive en
inventario/services/categorias_resolucion.py para no mezclar responsabilidades.
"""

import json
import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

from inventario.management.commands.cargar_categorias_meli import (
    CATEGORIAS_OFICIALES,
)
from inventario.models.clasificacion import Categoria
from inventario.services.mercadolibre_api import (
    CATEGORIA_MELI_DEFAULT,
    ML_API_BASE,
    predict_category,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CATEGORÍAS BASE ADICIONALES (no oficiales de Mercado Libre)
# Se marcan es_sistema=False para quedar BLINDADAS contra la limpieza del
# seeding oficial. «Ropa» usa MLA1430 «Ropa y Accesorios» (contenedor: la hoja
# real se predice con el nombre del objeto al publicar) y «Libros» el ID real
# de «Libros Físicos» (hoja publicable). `subtipo` es la familia de atributos
# técnicos: Ropa despliega Talla/Tamaño en el alta y en la edición.
#
# «Cajas y Contenedores» es la categoría organizativa de los bultos que alojan
# otros objetos: el listado de inventario la usa (junto con la marca
# `Objeto.es_contenedor`) para agrupar esos registros en la sección
# «📦 Cajas e Inventario Interno» y NO en «Objetos Sueltos o sin Caja».
# No tiene subtipo técnico propio: el mapeo ML es el contenedor «Hogar,
# Muebles y Jardín» (MLA1574) para que publicar nunca quede sin categoría.
# ---------------------------------------------------------------------------
CATEGORIAS_BASE_ADICIONALES = [
    {
        "nombre": "Ropa",
        "mercadolibre_category_id": "MLA1430",
        "icono": "👕",
        "subtipo": "ropa",
    },
    {
        "nombre": "Libros",
        "mercadolibre_category_id": "MLA412445",
        "icono": "📚",
        "subtipo": "libro",
    },
    {
        "nombre": "Cajas y Contenedores",
        "mercadolibre_category_id": "MLA1574",
        "icono": "📦",
        "subtipo": "",
    },
]

# Formatos/IDs válidos para la resolución de categorías.

# Formato oficial de la API de Mercado Libre para el ID de categoría (MLAxxxxx).
PATRON_ID_ML = re.compile(r'^MLA\d+$')

# Verificación de categorías HOJA (GET /categories/{id}): caché en memoria por
# categoría + enfriamiento para no golpear la API en cada publicación.
TIMEOUT_CATEGORIA = 10
ENFRIAMIENTO_FALLO = 300
CACHE_HOJAS: dict = {}
CACHE_FALLOS_HOJAS: dict = {}


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


def _id_oficial_por_nombre(nombre: str) -> str:
    """ID de ML hardcodeado para una categoría oficial (o "" si no lo es)."""
    buscado = str(nombre or "").strip().casefold()
    if not buscado:
        return ""
    for cat in CATEGORIAS_OFICIALES:
        if str(cat["nombre"]).strip().casefold() == buscado:
            return cat["mercadolibre_category_id"]
    return ""


def adoptar_categoria_oficial(estok, cat) -> bool:
    """
    Autocuración anti unique_together(nombre, estok) para una categoría oficial.

    Si existe una fila con el MISMO nombre y un `mercadolibre_category_id`
    distinto, se le restaura el ID oficial (y su ícono/subtipo) en vez de
    duplicar o borrar. Cubre:
      - categoría de usuario sin ID oficial → se adopta como oficial;
      - mapeo legado/corrupto (bug real: «Electrónica» apuntaba a MLA1728,
        «Software Comercial», y el seeding abortaba con UniqueViolation);
      - cambio de ID por auditoría (ej: MLA1798 inexistente → MLA34263).

    Devuelve True si adoptó una fila existente.
    """
    fila = (
        Categoria.objects.filter(
            estok=estok,
            nombre__iexact=cat["nombre"],
        )
        .exclude(mercadolibre_category_id=cat["mercadolibre_category_id"])
        .first()
    )
    if fila is None:
        return False
    fila.mercadolibre_category_id = cat["mercadolibre_category_id"]
    fila.nombre = cat["nombre"]
    fila.icono = cat["icono"]
    fila.subtipo = cat.get("subtipo", "")
    fila.es_contenedor = True
    fila.es_sistema = True
    fila.save(update_fields=[
        "mercadolibre_category_id", "nombre", "icono", "subtipo",
        "es_contenedor", "es_sistema",
    ])
    logger.info(
        "Categoría '%s' adoptada/restaurada como oficial (%s) en Estok %s.",
        cat["nombre"], cat["mercadolibre_category_id"], estok.pk,
    )
    return True


def _mapeo_vigente(categoria, category_id) -> str:
    """
    ID de ML vigente de la categoría, autocorrigiendo los mapeos oficiales.

    Las 11 categorías del sistema tienen un ID hardcodeado
    (CATEGORIAS_OFICIALES). Si en la BD quedó otro ID, se restaura el oficial y
    se persiste la corrección: bug histórico real, "Electrónica" quedó apuntando
    a MLA1728 ("Software Comercial") porque una hoja predicha se persistió
    encima del ID oficial.
    """
    cid = normalizar_id_ml(category_id)
    if not getattr(categoria, "es_sistema", False):
        return cid
    oficial = _id_oficial_por_nombre(getattr(categoria, "nombre", ""))
    if oficial and cid != oficial:
        logger.warning(
            "Mapeo ML corrupto en la categoría oficial '%s': %s → se restaura %s",
            getattr(categoria, "nombre", ""), cid or "(vacío)", oficial,
        )
        _persistir_mapeo(categoria, oficial)
        return oficial
    return cid


def resolver_category_id_ml(categoria, texto_fallback: str = "",
                            access_token: str = "") -> str:
    """
    Devuelve SIEMPRE el `category_id` con el que se debe publicar en ML.

    Orden ESTRICTO:
    1. `Categoria.mercadolibre_category_id` guardado y con formato válido
       (ej: "MLA412445") → se usa tal cual, SIN llamar a la API.
    2. Sin mapeo → se predice con el NOMBRE de la categoría (`texto_fallback`
       se usa solo si la categoría no tiene nombre). El resultado se PERSISTE
       solo en categorías del usuario (es_sistema=False y no contenedor); en
       las oficiales/contenedor se resuelve la hoja por publicación para no
       corromper el ID oficial.
    2b. Mapeo oficial corrupto (distinto de CATEGORIAS_OFICIALES) → se restaura
        el ID oficial y se persiste la corrección.
    3. Si no hay forma de predecir → CATEGORIA_MELI_DEFAULT.

    Args:
        categoria: instancia de Categoria (puede ser None).
        texto_fallback: texto a usar si la categoría no tiene nombre.
        access_token: token OAuth opcional para el predictor oficial.

    Returns:
        str con el category_id (formato MLAxxxxx).
    """
    guardado = _mapeo_vigente(
        categoria, getattr(categoria, 'mercadolibre_category_id', '')
    )
    if guardado:
        logger.info(
            "category_id estricto desde la BD: %s (categoría '%s')",
            guardado, getattr(categoria, 'nombre', ''),
        )
        return guardado

    nombre = (getattr(categoria, 'nombre', '') or '').strip() or str(texto_fallback or '').strip()
    predicho = predecir_id_ml(nombre, access_token=access_token)

    # Las categorías CONTENEDOR / del sistema NO se persisten: agrupan objetos
    # distintos y guardar una hoja predicha corrompía el ID oficial (bug real:
    # "Electrónica" terminó apuntando a MLA1728 "Software Comercial"). La hoja
    # se resuelve por publicación en garantizar_categoria_hoja_ml().
    if getattr(categoria, "es_sistema", False) or getattr(categoria, "es_contenedor", False):
        logger.info(
            "Categoría contenedor '%s': %s se usa solo para esta publicación "
            "(no se persiste)",
            getattr(categoria, 'nombre', ''), predicho,
        )
    else:
        _persistir_mapeo(categoria, predicho)
    return predicho


def _persistir_mapeo(categoria, categoria_ml: str) -> None:
    """Persiste (best-effort) el mapeo ML en la categoría; nunca aborta."""
    if categoria is None or not hasattr(categoria, 'save'):
        return
    try:
        categoria.mercadolibre_category_id = categoria_ml
        categoria.save(update_fields=['mercadolibre_category_id'])
        logger.info(
            "Mapeo ML persistido: categoría '%s' → %s",
            getattr(categoria, 'nombre', ''), categoria_ml,
        )
    except Exception as exc:  # noqa: BLE001 - persistir es best-effort
        logger.warning("No se pudo persistir el mapeo ML: %s", exc)


def es_categoria_hoja_ml(category_id, access_token: str = "") -> Optional[bool]:
    """
    Indica si `category_id` es una categoría HOJA publicable de Mercado Libre.

    Mercado Libre solo permite publicar (POST /items) en categorías sin
    subcategorías: un ID contenedor o inexistente produce HTTP 400.

    Returns:
        True  → existe, no tiene `children_categories` y admite publicaciones.
        False → no existe (404 / formato inválido) o es una categoría contenedor.
        None  → no se pudo verificar (API caída / sin red): el llamador decide.

    El resultado se cachea en memoria; los fallos se reintentan después de
    ENFRIAMIENTO_FALLO segundos para no penalizar cada publicación.
    """
    cid = normalizar_id_ml(category_id)
    if not cid:
        return False
    if cid in CACHE_HOJAS:
        return CACHE_HOJAS[cid]
    if time.time() - CACHE_FALLOS_HOJAS.get(cid, 0) < ENFRIAMIENTO_FALLO:
        return None

    url = f"{ML_API_BASE}/categories/{urllib.parse.quote(cid)}"
    headers = {"Accept": "application/json"}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=TIMEOUT_CATEGORIA) as resp:
            datos = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            logger.warning("Categoría ML %s inexistente (HTTP 404)", cid)
            CACHE_HOJAS[cid] = False
            return False
        CACHE_FALLOS_HOJAS[cid] = time.time()
        logger.warning("No se pudo verificar la categoría ML %s: %s", cid, exc)
        return None
    except Exception as exc:  # noqa: BLE001 - verificar es best-effort
        CACHE_FALLOS_HOJAS[cid] = time.time()
        logger.warning("No se pudo verificar la categoría ML %s: %s", cid, exc)
        return None

    hijos = datos.get("children_categories") or []
    listing_allowed = (datos.get("settings") or {}).get("listing_allowed")
    es_hoja = not hijos and listing_allowed is not False
    if not es_hoja:
        logger.warning(
            "Categoría ML %s (%s) no publicable: subcategorías=%d, listing_allowed=%s",
            cid, datos.get("name", ""), len(hijos), listing_allowed,
        )
    CACHE_HOJAS[cid] = es_hoja
    return es_hoja


def garantizar_categoria_hoja_ml(categoria, category_id,
                                 access_token: str = "",
                                 texto_objeto: str = "") -> str:
    """
    Devuelve el `category_id` HOJA con el que se puede publicar (o "" si no hay).

    Orden:
      1. El ID recibido, si tiene formato MLA y la API confirma que es hoja.
      2. Predicción y persistencia del mapeo corregido:
         - Categoría CONTENEDOR del sistema (las 11 oficiales, ej: "Electrónica"
           → MLA1051): se predice con el NOMBRE REAL DEL OBJETO, que es el dato
           específico del ítem. NUNCA se persiste la hoja: la categoría agrupa
           objetos distintos y persistirla corrompía el ID oficial (bug real:
           un GPS terminó en MLA1728 "Software Comercial").
         - Categoría del usuario sin mapeo: se predice con su NOMBRE y se
           persiste (comportamiento histórico, sin cambios).
      3. "" → el llamador responde 400 "Debes asignar una categoría válida de
         Mercado Libre" antes de gastar una llamada a POST /items.

    Si la API no se puede consultar (None), el ID se respeta tal cual: un fallo
    de red no debe bloquear la publicación.
    """
    cid = _mapeo_vigente(categoria, category_id)
    if cid and es_categoria_hoja_ml(cid, access_token) is not False:
        return cid

    nombre = (getattr(categoria, 'nombre', '') or '').strip()
    texto_objeto = str(texto_objeto or '').strip()
    es_contenedor = bool(getattr(categoria, 'es_contenedor', False))
    # En categorías contenedor el nombre ("Electrónica", "Hogar") no identifica
    # el producto: se usa el nombre del objeto para acertar la hoja real.
    texto_prediccion = texto_objeto if (es_contenedor and texto_objeto) else nombre
    if not texto_prediccion:
        logger.error(
            "Sin categoría ML válida (ID=%s) y sin nombre para predecir",
            cid or '(vacío)',
        )
        return ''

    predicho = normalizar_id_ml(predecir_id_ml(texto_prediccion, access_token=access_token))
    if not predicho:
        return ''
    if es_categoria_hoja_ml(predicho, access_token) is False:
        logger.error(
            "La predicción ML %s para '%s' tampoco es una categoría hoja",
            predicho, texto_prediccion[:50],
        )
        return ''

    if predicho != cid:
        logger.warning(
            "Categoría ML %s inválida o no hoja → se publica en %s (texto '%s')",
            cid or '(vacía)', predicho, texto_prediccion[:50],
        )
        if getattr(categoria, 'es_sistema', False) or es_contenedor:
            logger.info(
                "Categoría contenedor '%s': se mantiene el mapeo %s; la hoja %s "
                "se resuelve por publicación",
                nombre, cid or '(vacío)', predicho,
            )
        else:
            _persistir_mapeo(categoria, predicho)
    return predicho


def aplicar_categorias_oficiales_a_estok(estok):
    """
    Crea o actualiza las 11 categorías oficiales de Mercado Libre para un Estok.

    Idempotente: usa update_or_create sobre (mercadolibre_category_id, estok),
    por lo que puede ejecutarse múltiples veces (arranque del contenedor +
    triggers en caliente) sin duplicar ni pisar nada.

    AUTOCURACIÓN: antes de crear, adopta por NOMBRE la fila existente que tenga
    el mismo nombre con otro ID (categoría de usuario o mapeo legado). Sin esto,
    cambiar un ID oficial (auditoría de categorías) chocaría con
    unique_together(nombre, estok) y abortaría el alta del Estok.

    Devuelve la tupla (creadas, actualizadas).
    """
    creadas = 0
    actualizadas = 0
    for cat in CATEGORIAS_OFICIALES:
        if adoptar_categoria_oficial(estok, cat):
            actualizadas += 1
            continue
        _, created = Categoria.objects.update_or_create(
            mercadolibre_category_id=cat["mercadolibre_category_id"],
            estok=estok,
            defaults={
                "nombre": cat["nombre"],
                "icono": cat["icono"],
                "subtipo": cat.get("subtipo", ""),
                "es_contenedor": True,
                "es_sistema": True,
            },
        )
        if created:
            creadas += 1
        else:
            actualizadas += 1
    return creadas, actualizadas

