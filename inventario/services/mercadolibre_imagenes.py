"""
Imágenes para las publicaciones de Mercado Libre.

Centraliza la construcción de la clave "pictures" del payload de POST /items.

La API de MLA exige EXACTAMENTE:

    "pictures": [{"source": "https://url-publica/..."}]

y descarga la imagen por su cuenta. Por eso TODA URL debe ser absoluta, HTTPS y
accesible desde internet: una ruta relativa ("/media/foto.jpg") o un host de
desarrollo (localhost / 127.0.0.1) no son descargables por ML y la publicación
termina subiendo SIN foto (o rebotando con "pictures are mandatory").

Este módulo era la causa del bug de "publicaciones sin imagen": la vista de
publicación descartaba la URL pública correcta por considerarla "interna".
"""

import logging
from typing import Optional

from django.conf import settings

logger = logging.getLogger(__name__)

# Máximo de fotos por publicación aceptado por MLA.
MAX_PICTURES_ML = 12

# Hosts que ML NO puede descargar (entorno de desarrollo / red interna).
HOSTS_NO_PUBLICOS = ('localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal')


def url_media_publica(imagen) -> Optional[str]:
    """
    URL absoluta pública de una imagen de media (settings.SITE_URL + su ruta).

    Ej: https://eeestok.duckdns.org/media/objetos/foto.jpg
    Devuelve None si la imagen no tiene archivo asociado.
    """
    if imagen is None:
        return None
    try:
        ruta = imagen.url or ''
    except ValueError:  # archivo inexistente en el storage
        return None
    return url_publica_relativa(ruta)


def url_publica_relativa(ruta: str) -> Optional[str]:
    """Convierte una ruta de media ("/media/x.jpg") o URL en URL pública HTTPS."""
    valor = str(ruta or '').strip()
    if not valor:
        return None
    if valor.startswith('http://'):
        valor = valor.replace('http://', 'https://', 1)
    if valor.startswith('https://'):
        return valor if es_url_publica(valor) else None
    base = (getattr(settings, 'SITE_URL', '') or '').rstrip('/')
    if not base:
        logger.warning("SITE_URL no está configurado: no se pueden armar URLs públicas.")
        return None
    return f"{base}/{valor.lstrip('/')}"


def es_url_publica(url: str) -> bool:
    """True si la URL es absoluta, HTTPS y descargable por Mercado Libre."""
    valor = str(url or '').strip()
    if not valor.startswith(('http://', 'https://')):
        return False
    return not any(host in valor for host in HOSTS_NO_PUBLICOS)


def normalizar_url(url) -> Optional[str]:
    """Normaliza a HTTPS absoluto; None si no es una URL publicable."""
    valor = str(url or '').strip()
    if valor.startswith('http://'):
        valor = valor.replace('http://', 'https://', 1)
    return valor if es_url_publica(valor) else None


def normalizar_pictures(pictures) -> list:
    """
    Normaliza una lista de imágenes al formato oficial de ML:
    [{"source": "url"}] o [{"id": "picture_id"}].

    Acepta entradas planas (strings) y dicts con claves "source", "id" o "url",
    descartando valores vacíos y URLs no descargables por ML.
    """
    normalizadas: list = []
    if not pictures:
        return normalizadas

    vistos: set = set()
    for pic in pictures:
        crudo = None
        if isinstance(pic, str):
            crudo = pic
        elif isinstance(pic, dict):
            crudo = pic.get("source") or pic.get("id") or pic.get("url")

        if isinstance(pic, dict) and pic.get("id") and not pic.get("source"):
            # picture_id ya subido a ML: no es una URL, se respeta tal cual.
            picture_id = str(pic["id"]).strip()
            if picture_id and picture_id not in vistos:
                vistos.add(picture_id)
                normalizadas.append({"id": picture_id})
            continue

        url = normalizar_url(crudo)
        if not url:
            if crudo:
                logger.warning("Imagen descartada (URL no pública): %s", str(crudo)[:200])
            continue
        if url in vistos:
            continue
        vistos.add(url)
        normalizadas.append({"source": url})

    return normalizadas


def construir_pictures(objeto, url_extra: str = "") -> list:
    """
    Arma la lista definitiva de imágenes para publicar `objeto` en Mercado Libre.

    Orden de prioridad:
      1. `url_extra` (la foto elegida en el modal de publicación), si es pública.
      2. Todas las fotos guardadas del objeto (la principal primero).

    Devuelve el formato exacto que exige la API: [{"source": "https://..."}],
    deduplicado y limitado a MAX_PICTURES_ML.
    """
    urls: list = []

    # Acepta tanto una URL absoluta como una ruta relativa de media
    # ("/media/foto.jpg"), que se resuelve contra settings.SITE_URL.
    extra = url_publica_relativa(url_extra)
    if extra:
        urls.append(extra)

    fotos = []
    if objeto is not None:
        try:
            fotos = list(objeto.fotos.all().order_by('-es_principal', 'fecha_subida'))
        except Exception as exc:  # noqa: BLE001 - publicar no debe romper por esto
            logger.warning(
                "No se pudieron leer las fotos del objeto %s: %s",
                getattr(objeto, 'pk', None), exc,
            )

    for foto in fotos:
        url = url_media_publica(getattr(foto, 'imagen', None))
        if url:
            urls.append(url)

    unicas = list(dict.fromkeys(urls))[:MAX_PICTURES_ML]
    if not unicas:
        logger.warning(
            "Publicación SIN imágenes: el objeto %s no tiene fotos públicas "
            "(SITE_URL=%s).",
            getattr(objeto, 'pk', None), getattr(settings, 'SITE_URL', ''),
        )
    else:
        logger.info("Pictures para ML (%d): %s", len(unicas), unicas)

    return [{"source": url} for url in unicas]
