"""
SINCRONIZACIÓN DE PUBLICACIONES DE MERCADO LIBRE CON EL INVENTARIO DE ESTOK.

ÚNICA fuente de verdad para traducir el estado real de un Objeto a la acción
que corresponde sobre su publicación en Mercado Libre:

    · Eliminado (soft delete: `deleted_at`)      → PUT status = "closed"
    · Vendido (envío despachado) o sin stock (0) → PUT status = "paused"
    · Cualquier otro cambio                      → no toca la publicación

También persiste el `item_id` que devuelve POST /items (ver
models/integraciones.py → MercadoLibrePublicacion) y el usuario dueño del token
OAuth con el que se publicó, porque los tokens de Mercado Libre son POR USUARIO.

REGLA DE ORO: esta sincronización es BEST-EFFORT. Nunca lanza excepciones hacia
el llamador: un problema con Mercado Libre JAMÁS debe impedir guardar, vender o
eliminar un objeto en Estok.
"""

import logging

from django.utils import timezone

from ..models import MercadoLibrePublicacion
from .mercadolibre_api import api_request_autenticado

logger = logging.getLogger(__name__)

# Estados nativos de Mercado Libre que fija esta sincronización.
ESTADO_PAUSADO = MercadoLibrePublicacion.ESTADO_PAUSADO
ESTADO_CERRADO = MercadoLibrePublicacion.ESTADO_CERRADO

# Campos de stock aceptados de forma defensiva: el modelo Objeto de este
# esquema NO tiene `cantidad`, pero algunos despliegues sí (mismo criterio que
# mercadolibre_payload.cantidad_disponible_ml()).
CAMPOS_CANTIDAD = ("cantidad", "stock", "available_quantity")

# Campos de estado que pueden marcar el objeto como vendido en despliegues que
# los tengan. La señal REAL de venta en este esquema es `despachado_en`.
CAMPOS_ESTADO_VENTA = ("estado", "estado_venta")

# Timeout corto: la sincronización corre dentro del request (señal post_save).
TIMEOUT_SINCRONIZACION = 15


# =============================================================================
# LECTURA DEL ESTADO DEL OBJETO
# =============================================================================
def cantidad_de(objeto):
    """Stock del objeto, o None si el modelo no tiene ningún campo de stock."""
    for atributo in CAMPOS_CANTIDAD:
        valor = getattr(objeto, atributo, None)
        if valor is None:
            continue
        try:
            return int(valor)
        except (TypeError, ValueError):
            continue
    return None


def objeto_vendido(objeto) -> bool:
    """
    ¿El objeto ya se vendió?

    1. `despachado_en` con valor → el Administrador Físico despachó el envío del
       objeto vendido (services/descarte_service.despachar_envio()).
    2. Campo de estado explícito 'vendido' (solo si el despliegue lo tuviera).
    """
    if getattr(objeto, "despachado_en", None):
        return True
    for atributo in CAMPOS_ESTADO_VENTA:
        valor = str(getattr(objeto, atributo, "") or "").strip().lower()
        if valor == "vendido":
            return True
    return False


def esta_publicado(objeto) -> bool:
    """¿El objeto tiene una publicación en Mercado Libre?"""
    if getattr(objeto, "meli_id", None) or getattr(objeto, "meli_item_id", None):
        return True
    plataformas = getattr(objeto, "plataformas_publicadas", None) or []
    try:
        return "mercadolibre" in plataformas
    except TypeError:  # JSONField con un valor inesperado
        return False


def publicacion_de(objeto):
    """Registro de publicación del objeto, o None."""
    if objeto is None or getattr(objeto, "pk", None) is None:
        return None
    return MercadoLibrePublicacion.objects.filter(objeto=objeto).first()


def item_id_de(objeto) -> str:
    """
    `item_id` de Mercado Libre del objeto ('' si no se conoce).

    Prioriza el campo legacy `meli_id`/`meli_item_id` (algunos despliegues lo
    tienen) y cae al registro MercadoLibrePublicacion.
    """
    legacy = getattr(objeto, "meli_id", None) or getattr(objeto, "meli_item_id", None)
    if legacy:
        return str(legacy).strip()
    publicacion = publicacion_de(objeto)
    return str(publicacion.item_id or "").strip() if publicacion else ""


def objetivo_publicacion(objeto):
    """
    Estado al que debe quedar la publicación según el inventario.

    Devuelve ESTADO_CERRADO, ESTADO_PAUSADO o None (nada que sincronizar).
    """
    if getattr(objeto, "deleted_at", None) is not None:
        return ESTADO_CERRADO
    if objeto_vendido(objeto):
        return ESTADO_PAUSADO
    cantidad = cantidad_de(objeto)
    if cantidad is not None and cantidad <= 0:
        return ESTADO_PAUSADO
    return None



# =============================================================================
# REGISTRO DE LA PUBLICACIÓN (al crear el ítem en ML)
# =============================================================================
def registrar_publicacion(objeto, item_id, permalink="", usuario=None,
                          status=MercadoLibrePublicacion.ESTADO_ACTIVO):
    """
    Persiste el `item_id` devuelto por POST /items y marca el objeto como
    publicado en `plataformas_publicadas` (sin disparar señales: se usa
    `.update()`, así el post_save de Objeto no lanza una sincronización inútil).

    Devuelve la MercadoLibrePublicacion creada/actualizada, o None.
    """
    item_id = str(item_id or "").strip()
    if not item_id or objeto is None or getattr(objeto, "pk", None) is None:
        return None

    publicacion, creada = MercadoLibrePublicacion.objects.update_or_create(
        objeto=objeto,
        defaults={
            "item_id": item_id,
            "permalink": str(permalink or "")[:300],
            "status": str(status or MercadoLibrePublicacion.ESTADO_ACTIVO)[:20],
            "usuario": usuario if getattr(usuario, "pk", None) else None,
        },
    )

    plataformas = list(getattr(objeto, "plataformas_publicadas", None) or [])
    if "mercadolibre" not in plataformas:
        plataformas.append("mercadolibre")
        type(objeto).objects.filter(pk=objeto.pk).update(
            plataformas_publicadas=plataformas
        )
        objeto.plataformas_publicadas = plataformas

    logger.info(
        "Publicación de ML registrada para el objeto %s: item_id=%s (%s)",
        objeto.pk, item_id, "nueva" if creada else "actualizada",
    )
    return publicacion


# =============================================================================
# SINCRONIZACIÓN DE ESTADO (pausar / cerrar)
# =============================================================================
def _marcar_estado(publicacion, respuesta, objetivo):
    """Refleja en la base el estado REAL que devolvió Mercado Libre."""
    if publicacion is None:
        return
    estado_real = str((respuesta or {}).get("status") or objetivo)[:20]
    MercadoLibrePublicacion.objects.filter(pk=publicacion.pk).update(
        status=estado_real, updated_at=timezone.now(),
    )
    publicacion.status = estado_real


def sincronizar_publicacion(objeto, forzar: bool = False) -> bool:
    """
    Pausa o cierra la publicación del objeto en Mercado Libre si corresponde.

    `forzar=True` ignora el atajo de idempotencia (útil para reintentos
    manuales). Devuelve True si la publicación quedó en el estado esperado.
    """
    try:
        if objeto is None or not esta_publicado(objeto):
            return False

        item_id = item_id_de(objeto)
        if not item_id:
            logger.info(
                "Objeto %s está marcado como publicado en ML pero no tiene "
                "item_id persistido: no hay nada que sincronizar.",
                getattr(objeto, "pk", "?"),
            )
            return False

        objetivo = objetivo_publicacion(objeto)
        if objetivo is None:
            return False

        publicacion = publicacion_de(objeto)
        if not forzar and publicacion is not None and publicacion.status == objetivo:
            return True  # ya está en el estado pedido: no se golpea la API

        usuario = publicacion.usuario if publicacion is not None else None
        usuario = usuario or getattr(objeto, "dueno_original", None)
        if usuario is None:
            logger.warning(
                "No se puede sincronizar el ítem %s de ML: el objeto %s no "
                "tiene usuario dueño del token OAuth.",
                item_id, getattr(objeto, "pk", "?"),
            )
            return False

        respuesta = api_request_autenticado(
            usuario, "PUT", f"/items/{item_id}", {"status": objetivo},
            timeout=TIMEOUT_SINCRONIZACION,
        )
        if (
            not respuesta
            or respuesta.get("error")
            or int(respuesta.get("http_status") or 200) >= 400
        ):
            logger.error(
                "No se pudo sincronizar el ítem %s de ML (objeto %s → %s): %s",
                item_id, objeto.pk, objetivo, respuesta,
            )
            return False

        _marcar_estado(publicacion, respuesta, objetivo)
        logger.info(
            "Publicación de ML %s sincronizada → %s (objeto %s)",
            item_id, objetivo, objeto.pk,
        )
        return True

    except Exception as exc:  # noqa: BLE001 - nunca rompe el guardado del objeto
        logger.error(
            "Error inesperado al sincronizar la publicación de ML del objeto "
            "%s: %s", getattr(objeto, "pk", "?"), exc,
        )
        return False


# =============================================================================
# DETECCIÓN DE CAMBIOS (usada por las señales pre_save / post_save)
# =============================================================================
def instantanea_sincronizacion(objeto) -> dict:
    """
    Foto de los datos que disparan una sincronización con Mercado Libre.

    Se toma en pre_save (estado anterior) y en post_save (estado nuevo); la
    diferencia entre ambas es lo que decide si hay que llamar a la API.
    """
    return {
        "publicado": esta_publicado(objeto),
        "eliminado": getattr(objeto, "deleted_at", None) is not None,
        "vendido": objeto_vendido(objeto),
        "cantidad": cantidad_de(objeto),
    }


def cambio_requiere_sincronizacion(antes, despues) -> bool:
    """¿Entre las dos fotos cambió algo que afecte la publicación en ML?"""
    if not antes or not despues:
        return False
    if not despues.get("publicado"):
        return False
    return any(
        antes.get(clave) != despues.get(clave)
        for clave in ("eliminado", "vendido", "cantidad")
    )
