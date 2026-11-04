"""
ESTADO REAL Y PRECIO DE LAS PUBLICACIONES DE MERCADO LIBRE (sentido ML → Estok).

QUÉ RESUELVE
    Hasta ahora Estok sólo empujaba cambios HACIA Mercado Libre (pausar/cerrar
    al vender o eliminar el objeto). Si el usuario pausaba, finalizaba o
    eliminaba la publicación DESDE la web de Mercado Libre, la base seguía
    diciendo «Publicado» y las tarjetas de /alertas-stock mostraban «listo para
    vender» con un enlace muerto.

    Este módulo es la ÚNICA fuente de verdad del estado real:
      1. `estado_publicacion()`     → foto del estado persistido (sin red).
      2. `verificar_publicacion()`  → GET /items/{id} y persistencia del status
                                      real (active / paused / closed).
      3. `verificar_publicaciones_estok()` → verificación en lote con límite y
                                      ventana mínima entre consultas.
      4. `sincronizar_precio()`     → PUT /items/{id} {"price": ...} cuando el
                                      valor del objeto cambia en Estok.

REGLA DE ORO
    Todo es BEST-EFFORT: un problema con Mercado Libre NUNCA debe romper el
    guardado de un objeto ni el armado del tablero de decisiones.

NOTA DE ALCANCE
    El estado real se consulta con el token OAuth del usuario que PUBLICÓ el
    ítem (los tokens de Mercado Libre son POR USUARIO), con respaldo en el
    dueño original del objeto.
"""

import logging
from datetime import timedelta

from django.utils import timezone

from ..models import MercadoLibrePublicacion
from .mercadolibre_api import api_request_autenticado
from .mercadolibre_publicacion import (
    actualizar_permalink,
    item_id_de,
    publicacion_de,
    registrar_publicacion,
)

logger = logging.getLogger(__name__)

# Timeout corto: la verificación corre dentro de un request HTTP.
TIMEOUT_ESTADO = 6
TIMEOUT_PRECIO = 10

# Ventana mínima entre dos consultas del mismo ítem a Mercado Libre: evita
# golpear la API en cada carga de /alertas-stock.
MINUTOS_ENTRE_VERIFICACIONES = 5

# Tope de ítems verificados por request (el tablero verifica el resto en las
# siguientes cargas): mantiene el endpoint dentro de un tiempo razonable.
LIMITE_VERIFICACIONES = 12

# Estados canónicos que consumen las tarjetas y la ficha del objeto.
ESTADO_SIN_PUBLICAR = 'sin_publicar'
ESTADO_PUBLICADO = 'publicado'
ESTADO_PAUSADA = 'pausada'
ESTADO_FINALIZADA = 'finalizada'

ETIQUETAS = {
    ESTADO_SIN_PUBLICAR: 'Sin publicar',
    ESTADO_PUBLICADO: 'Publicado',
    ESTADO_PAUSADA: 'Pausada',
    ESTADO_FINALIZADA: 'Finalizada',
}

AVISOS = {
    ESTADO_PAUSADA: (
        'La publicación está pausada en Mercado Libre: reactivala desde la '
        'web de Mercado Libre para volver a venderla.'
    ),
    ESTADO_FINALIZADA: (
        'La publicación fue finalizada o eliminada en Mercado Libre: el enlace '
        'ya no está activo. Volvé a publicarla desde Estok.'
    ),
}

# Traducción del `status` nativo de Mercado Libre a los estados del inventario.
MAPA_STATUS_ML = {
    'active': MercadoLibrePublicacion.ESTADO_ACTIVO,
    'paused': MercadoLibrePublicacion.ESTADO_PAUSADO,
    'closed': MercadoLibrePublicacion.ESTADO_CERRADO,
}

# Estados intermedios de ML que NO venden (en revisión, sin pago configurado,
# congeladas…): se reflejan como «pausada», que es exactamente lo que ocurre
# —el ítem existe pero no se puede comprar—.
ESTADOS_ML_NO_VENDIBLES = (
    'under_review',
    'inactive',
    'payment_required',
    'not_yet_active',
    'freeze',
)

# =============================================================================
# NORMALIZACIÓN DEL STATUS DE MERCADO LIBRE
# =============================================================================
def normalizar_status_ml(status):
    """
    `status` de ML → estado persistible en MercadoLibrePublicacion.

    Devuelve '' cuando el valor no es reconocible (el llamador conserva el
    estado anterior en lugar de inventar uno).
    """
    texto = str(status or '').strip().lower()
    if texto in MAPA_STATUS_ML:
        return MAPA_STATUS_ML[texto]
    if texto in ESTADOS_ML_NO_VENDIBLES:
        return MercadoLibrePublicacion.ESTADO_PAUSADO
    return ''


def _estado_desde_status(status):
    """Estado persistido → estado canónico de la UI."""
    if status == MercadoLibrePublicacion.ESTADO_ACTIVO:
        return ESTADO_PUBLICADO
    if status == MercadoLibrePublicacion.ESTADO_PAUSADO:
        return ESTADO_PAUSADA
    if status == MercadoLibrePublicacion.ESTADO_CERRADO:
        return ESTADO_FINALIZADA
    return ESTADO_SIN_PUBLICAR


def _invalidar_cache_publicacion(objeto):
    """
    Descarta la publicación cacheada en la instancia del objeto.

    La relación inversa `Objeto.publicacion_ml` (OneToOne) se cachea en
    `_state.fields_cache`: sin este paso, tras persistir un estado nuevo el
    mismo objeto seguiría devolviendo el registro viejo.
    """
    cache = getattr(getattr(objeto, '_state', None), 'fields_cache', None)
    if isinstance(cache, dict):
        cache.pop('publicacion_ml', None)


# =============================================================================
# LECTURA DEL ESTADO (sin red)
# =============================================================================
def estado_publicacion(objeto, publicacion=None):
    """
    Foto del estado REAL (persistido) de la publicación de un objeto.

    Contrato ÚNICO que consumen las tarjetas de /alertas-stock
    (`payload_objeto_decision`) y la ficha del objeto (ObjetoDetailSerializer):

        {
          'item_id': str,        # '' si el objeto no está publicado
          'status': str,         # active / paused / closed (nativo de ML)
          'estado': str,         # publicado / pausada / finalizada / sin_publicar
          'label': str,          # etiqueta legible para las tarjetas
          'publicado': bool,     # True sólo si existe y NO está finalizada
          'activa': bool,        # True sólo si ML la reporta 'active'
          'url': str | None,     # PERMALINK guardada (None si no hay/finalizada)
          'permalink': str,
          'aviso': str,          # advertencia para la UI ('' si está OK)
          'verificado_en': str | None,
        }

    ENLACE: `url` es SIEMPRE la permalink que devolvió la API de Mercado Libre y
    que se persistió al crear, editar o sincronizar la publicación. NO se arma
    la URL a mano con el `item_id` (`articulo.mercadolibre.com.ar/<id>`): las
    publicaciones de catálogo (UP) tienen otra ruta y ese enlace daba HTTP 404.
    """
    publicacion = publicacion if publicacion is not None else publicacion_de(objeto)
    item_id = item_id_de(objeto)
    permalink = str(getattr(publicacion, 'permalink', '') or '').strip()

    status = str(getattr(publicacion, 'status', '') or '').strip().lower()
    if not status and item_id:
        # `item_id` legacy (campo `meli_id`) sin registro de publicación: se
        # asume activa hasta que la próxima verificación traiga el estado real.
        status = MercadoLibrePublicacion.ESTADO_ACTIVO
    if not item_id:
        status = ''

    estado = _estado_desde_status(status)
    publicado = estado in (ESTADO_PUBLICADO, ESTADO_PAUSADA)

    # EXCLUSIVAMENTE la permalink guardada: sin permalink no hay enlace (la UI
    # no dibuja «Ver publicación») en vez de ofrecer una URL inventada.
    url = permalink if (publicado and permalink.startswith('http')) else None

    verificado = getattr(publicacion, 'updated_at', None)
    return {
        'item_id': item_id,
        'status': status,
        'estado': estado,
        'label': ETIQUETAS.get(estado, ETIQUETAS[ESTADO_SIN_PUBLICAR]),
        'publicado': publicado,
        'activa': estado == ESTADO_PUBLICADO,
        'url': url,
        'permalink': permalink,
        'aviso': AVISOS.get(estado, ''),
        'verificado_en': verificado.isoformat() if verificado else None,
    }


# =============================================================================
# VERIFICACIÓN CONTRA MERCADO LIBRE (GET /items/{id})
# =============================================================================
def _dueno_del_token(objeto, publicacion, usuario=None):
    """
    Usuario dueño del token OAuth con el que se publicó el ítem.

    Prioridad: usuario explícito del llamador → usuario que publicó (registro
    MercadoLibrePublicacion) → dueño original del objeto.
    """
    return (
        usuario
        or getattr(publicacion, 'usuario', None)
        or getattr(objeto, 'dueno_original', None)
    )


def _quitar_marca_mercadolibre(objeto):
    """
    Quita 'mercadolibre' de `plataformas_publicadas`.

    Se usa cuando Mercado Libre confirma que la publicación está CERRADA
    (finalizada o eliminada): el inventario deja de mentir diciendo que el
    objeto está publicado. Los demás marketplaces (facebook/instagram) se
    conservan intactos.
    """
    plataformas = list(getattr(objeto, 'plataformas_publicadas', None) or [])
    restantes = [
        plataforma for plataforma in plataformas
        if str(plataforma).strip().lower() != 'mercadolibre'
    ]
    if len(restantes) == len(plataformas):
        return
    try:
        type(objeto).objects.filter(pk=objeto.pk).update(
            plataformas_publicadas=restantes
        )
        objeto.plataformas_publicadas = restantes
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning(
            'No se pudo quitar la marca de Mercado Libre del objeto %s: %s',
            getattr(objeto, 'pk', '?'), exc,
        )


def _persistir_estado(objeto, publicacion, item_id, status, permalink,
                      dueno=None, previo=None):
    """
    Guarda en la base el estado REAL devuelto por Mercado Libre.

    Devuelve el contrato de `estado_publicacion()` con el campo extra
    `cambiado` (True si el estado persistido cambió con esta verificación).
    """
    previo = previo or estado_publicacion(objeto, publicacion=publicacion)

    if publicacion is None:
        # Publicación legacy (item_id sin registro): se crea el registro para
        # poder sincronizarla de acá en adelante.
        publicacion = registrar_publicacion(
            objeto, item_id, permalink=permalink, usuario=dueno, status=status,
        )
    elif publicacion is not None:
        MercadoLibrePublicacion.objects.filter(pk=publicacion.pk).update(
            status=status,
            permalink=(permalink or publicacion.permalink or '')[:300],
            updated_at=timezone.now(),
        )

    if status == MercadoLibrePublicacion.ESTADO_CERRADO:
        _quitar_marca_mercadolibre(objeto)

    _invalidar_cache_publicacion(objeto)
    actual = estado_publicacion(objeto)
    actual['cambiado'] = actual['estado'] != previo.get('estado')
    if actual['cambiado']:
        logger.info(
            'Publicación de ML %s del objeto %s: %s → %s',
            item_id, getattr(objeto, 'pk', '?'),
            previo.get('estado'), actual['estado'],
        )
    return actual



def verificar_publicacion(objeto, forzar=False, usuario=None, publicacion=None):
    """
    Consulta GET /items/{item_id} y refleja en Estok el estado REAL del ítem.

    `forzar=True` ignora la ventana de MINUTOS_ENTRE_VERIFICACIONES (se usa en
    la ficha del objeto y en las verificaciones en lote).

    Devuelve el contrato de `estado_publicacion()` (+ `cambiado`), o None si el
    objeto no tiene publicación o no se pudo consultar Mercado Libre.
    """
    try:
        publicacion = publicacion if publicacion is not None else publicacion_de(objeto)
        item_id = item_id_de(objeto)
        if not item_id:
            return None

        previo = estado_publicacion(objeto, publicacion=publicacion)
        if not forzar and getattr(publicacion, 'updated_at', None):
            edad = timezone.now() - publicacion.updated_at
            if edad < timedelta(minutes=MINUTOS_ENTRE_VERIFICACIONES):
                # Consulta reciente: se respeta la ventana y no se golpea ML.
                return {**previo, 'cambiado': False}

        dueno = _dueno_del_token(objeto, publicacion, usuario)
        if dueno is None:
            logger.warning(
                'No se puede verificar el ítem %s de ML: el objeto %s no tiene '
                'usuario dueño del token OAuth.', item_id,
                getattr(objeto, 'pk', '?'),
            )
            return None

        respuesta = api_request_autenticado(
            dueno, 'GET',
            f'/items/{item_id}?attributes=id,status,permalink,price',
            timeout=TIMEOUT_ESTADO,
        )
        http_status = int((respuesta or {}).get('http_status') or 200)

        if not respuesta or respuesta.get('error') or http_status >= 400:
            if http_status == 404:
                # El ítem ya no existe en Mercado Libre (eliminado): se refleja
                # como publicación finalizada y se deja de marcar como publicada.
                logger.info(
                    'El ítem %s de ML ya no existe (HTTP 404): publicación del '
                    'objeto %s marcada como finalizada.',
                    item_id, getattr(objeto, 'pk', '?'),
                )
                return _persistir_estado(
                    objeto, publicacion, item_id,
                    MercadoLibrePublicacion.ESTADO_CERRADO,
                    previo.get('permalink', ''), dueno, previo,
                )
            logger.warning(
                'No se pudo verificar el ítem %s de ML (objeto %s): %s',
                item_id, getattr(objeto, 'pk', '?'), respuesta,
            )
            return None

        status = normalizar_status_ml(respuesta.get('status'))
        if not status:
            logger.warning(
                'Estado desconocido de ML para el ítem %s: %s (se conserva el '
                'estado anterior).', item_id, respuesta.get('status'),
            )
            return None

        permalink = str(
            respuesta.get('permalink') or previo.get('permalink') or ''
        ).strip()
        return _persistir_estado(
            objeto, publicacion, item_id, status, permalink, dueno, previo,
        )

    except Exception as exc:  # noqa: BLE001 - nunca rompe el request del usuario
        logger.error(
            'Error inesperado al verificar la publicación de ML del objeto %s: %s',
            getattr(objeto, 'pk', '?'), exc,
        )
        return None



def verificar_publicaciones_estok(estok_id=None, forzar=False,
                                  limite=LIMITE_VERIFICACIONES):
    """
    Verifica en lote las publicaciones de Mercado Libre de un Estok.

    Se usa al cargar /alertas-stock: devuelve un resumen con cuántas se
    verificaron y cuántas cambiaron de estado, más el detalle por ítem.
    El límite y la ventana de MINUTOS_ENTRE_VERIFICACIONES mantienen el costo
    de la llamada acotado (los ítems restantes se verifican en cargas futuras).
    """
    try:
        tope = int(limite or LIMITE_VERIFICACIONES)
    except (TypeError, ValueError):
        tope = LIMITE_VERIFICACIONES
    tope = max(1, min(tope, LIMITE_VERIFICACIONES))

    publicaciones = MercadoLibrePublicacion.objects.select_related(
        'objeto', 'usuario',
    ).filter(objeto__deleted_at__isnull=True)
    if estok_id:
        publicaciones = publicaciones.filter(objeto__estok_id=estok_id)
    if not forzar:
        publicaciones = publicaciones.filter(
            updated_at__lt=timezone.now() - timedelta(
                minutes=MINUTOS_ENTRE_VERIFICACIONES
            )
        )

    items = []
    verificados = 0
    actualizados = 0
    for publicacion in publicaciones.order_by('updated_at')[:tope]:
        resultado = verificar_publicacion(
            publicacion.objeto, forzar=True, publicacion=publicacion,
        )
        if resultado is None:
            continue
        verificados += 1
        if resultado.get('cambiado'):
            actualizados += 1
        items.append({**resultado, 'objeto_id': str(publicacion.objeto_id)})

    return {
        'verificados': verificados,
        'actualizados': actualizados,
        'items': items,
    }


# =============================================================================
# PRECIO (sentido Estok → Mercado Libre)
# =============================================================================
def sincronizar_precio(objeto, precio, usuario=None):
    """
    Empuja el valor del objeto a su publicación de Mercado Libre.

    PUT /items/{item_id} {"price": <nuevo precio>}

    Sólo actúa cuando la publicación está VIVA (activa o pausada): Mercado
    Libre rechaza con HTTP 400 cualquier cambio de precio sobre un ítem
    cerrado, y no tiene sentido tocar una publicación que ya no existe.

    BEST-EFFORT: devuelve True/False y NUNCA lanza (un fallo de Mercado Libre
    jamás debe impedir guardar el objeto en Estok).
    """
    try:
        publicacion = publicacion_de(objeto)
        item_id = item_id_de(objeto)
        if not item_id:
            return False

        estado = estado_publicacion(objeto, publicacion=publicacion)
        if estado['estado'] not in (ESTADO_PUBLICADO, ESTADO_PAUSADA):
            logger.info(
                'Objeto %s: el ítem %s de ML no está vigente (%s); no se '
                'actualiza el precio.', getattr(objeto, 'pk', '?'), item_id,
                estado['estado'],
            )
            return False

        try:
            nuevo = round(float(precio), 2)
        except (TypeError, ValueError):
            return False
        if nuevo <= 0:
            return False

        dueno = _dueno_del_token(objeto, publicacion, usuario)
        if dueno is None:
            logger.warning(
                'No se puede actualizar el precio del ítem %s de ML: el objeto '
                '%s no tiene usuario dueño del token OAuth.',
                item_id, getattr(objeto, 'pk', '?'),
            )
            return False

        respuesta = api_request_autenticado(
            dueno, 'PUT', f'/items/{item_id}', {'price': nuevo},
            timeout=TIMEOUT_PRECIO,
        )
        http_status = int((respuesta or {}).get('http_status') or 200)
        if not respuesta or respuesta.get('error') or http_status >= 400:
            logger.error(
                'No se pudo actualizar el precio del ítem %s de ML (objeto %s → '
                '$%s): %s', item_id, getattr(objeto, 'pk', '?'), nuevo, respuesta,
            )
            return False

        logger.info(
            'Precio del ítem %s de ML sincronizado a $%s (objeto %s).',
            item_id, nuevo, getattr(objeto, 'pk', '?'),
        )
        # La respuesta de PUT /items/{id} es un ítem COMPLETO: si trae permalink
        # se persiste (mantiene el enlace de la UI apuntando a la publicación
        # real, sin URLs armadas a mano que devuelven 404).
        actualizar_permalink(publicacion, (respuesta or {}).get('permalink'))
        return True

    except Exception as exc:  # noqa: BLE001 - nunca rompe el guardado del objeto
        logger.error(
            'Error inesperado al sincronizar el precio de ML del objeto %s: %s',
            getattr(objeto, 'pk', '?'), exc,
        )
        return False

