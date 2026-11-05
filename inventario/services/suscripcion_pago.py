"""
Suscripción Pro · alta del Checkout y activación del plan tras el pago.

Flujo completo (única fuente de verdad de la monetización):

    POST /api/suscripciones/crear_preferencia/   → este módulo crea la
        preferencia en Mercado Pago (REST, sin SDK) y devuelve `init_point`.
    POST /api/suscripciones/webhook/            → Mercado Pago notifica; acá se
        CONSULTA el pago (nunca se confía en el body de la notificación) y, si
        el estado es `approved`, se activa el plan Pro del usuario/Estok.

La activación NO reimplementa reglas de plan: escribe `es_premium`,
`plan_suscripcion`, `limite_objetos` y `ocultar_publicidad` y deja que
`inventario/services/suscripcion.py` (con sus señales en signals.py) propague la
herencia de publicidad a todos los miembros del hogar.

Idempotencia: el webhook de Mercado Pago se reintenta varias veces y puede
llegar `approved` repetido. Un `SuscripcionPago` ya aprobado no se vuelve a
aplicar (se reconoce por `external_reference` o por `pago_id`).

No conoce `request` ni `Response`: recibe datos de dominio y devuelve dicts.
La traducción a HTTP vive en `inventario/api/viewsets/suscripciones.py`.
"""

import logging
import uuid
from decimal import Decimal, InvalidOperation

import requests
from django.conf import settings

from ..models import SuscripcionPago
from . import suscripcion

logger = logging.getLogger(__name__)

# SDK OFICIAL de Mercado Pago (`pip install mercadopago`).
# Si no está instalado en el entorno, `crear_preferencia()` usa la
# implementación REST equivalente (`_pedido`), que produce exactamente el mismo
# resultado: el despliegue nunca depende de que la librería esté presente.
try:  # pragma: no cover - depende del entorno de ejecución
    import mercadopago  # type: ignore
except Exception as exc:  # ImportError u error de inicialización de la lib
    mercadopago = None
    logger.info(
        'SDK de Mercado Pago no disponible (%s): se usará la API REST.', exc,
    )

PROVEEDOR = SuscripcionPago.PROVEEDOR_MERCADOPAGO

# Timeout de las llamadas a la pasarela: el webhook debe responder rápido
# (Mercado Pago reintenta si tarda demasiado).
TIMEOUT_HTTP = 20

# Estados de Mercado Pago que dan el plan Pro / que lo rechazan.
ESTADOS_APROBADOS = ('approved',)
ESTADOS_RECHAZADOS = ('rejected', 'cancelled', 'refunded', 'charged_back')


class ErrorSuscripcion(Exception):
    """Fallo al comunicarse con la pasarela (el webhook se puede reintentar)."""


class ErrorConfiguracionPago(ErrorSuscripcion):
    """La pasarela no está configurada todavía (falta el access token)."""


# =============================================================================
# CONFIGURACIÓN
# =============================================================================
def precio_pro() -> Decimal:
    """Precio del plan Pro en la moneda configurada (default 4999 ARS)."""
    crudo = str(getattr(settings, 'SUSCRIPCION_PRO_PRECIO_ARS', '4999') or '4999')
    try:
        precio = Decimal(crudo.replace(',', '.').strip())
    except (InvalidOperation, AttributeError):
        precio = Decimal('4999')
    return precio if precio > 0 else Decimal('4999')


def dias_pro() -> int:
    """Días de plan Pro que otorga cada pago aprobado."""
    try:
        dias = int(getattr(settings, 'SUSCRIPCION_PRO_DIAS', 30) or 30)
    except (TypeError, ValueError):
        dias = 30
    return dias if dias > 0 else 30


def moneda_pro() -> str:
    return str(getattr(settings, 'SUSCRIPCION_PRO_MONEDA', 'ARS') or 'ARS').upper()


def titulo_pro() -> str:
    return str(
        getattr(settings, 'SUSCRIPCION_PRO_TITULO', 'Estok Pro') or 'Estok Pro'
    )


def _access_token() -> str:
    """
    Access token del servidor.

    Se acepta `MERCADOPAGO_ACCESS_TOKEN` (nombre histórico del proyecto) y
    `MP_ACCESS_TOKEN` (nombre con el que Mercado Pago lo documenta). El valor se
    resuelve en `config/settings.py`, acá sólo se lee.
    """
    return str(getattr(settings, 'MERCADOPAGO_ACCESS_TOKEN', '') or '').strip()


def _sdk_mercadopago():
    """
    Instancia del SDK oficial con el access token del servidor.

    Devuelve `None` cuando la librería no está instalada (fallback REST) y
    lanza `ErrorConfiguracionPago` si falta el token: sin credenciales no hay
    checkout posible y la app sigue funcionando en el plan gratuito.
    """
    if not _access_token():
        raise ErrorConfiguracionPago(
            'La pasarela de pago todavía no está configurada. '
            'La app sigue funcionando en el plan gratuito con publicidad.'
        )
    if mercadopago is None:
        return None
    try:
        return mercadopago.SDK(_access_token())
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning('No se pudo inicializar el SDK de Mercado Pago: %s', exc)
        return None


def _api_base() -> str:
    base = str(
        getattr(settings, 'MERCADOPAGO_API_BASE', '') or 'https://api.mercadopago.com'
    )
    return base.rstrip('/')


def _webhook_url() -> str:
    configurada = str(getattr(settings, 'SUSCRIPCION_WEBHOOK_URL', '') or '').strip()
    if configurada:
        return configurada
    site = str(getattr(settings, 'SITE_URL', '') or '').rstrip('/')
    return f'{site}/api/suscripciones/webhook/'


def _headers() -> dict:
    return {
        'Authorization': f'Bearer {_access_token()}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }


def _pedido(method: str, endpoint: str, **kwargs):
    """
    Llamada HTTP a la API de Mercado Pago con manejo de errores uniforme.

    Lanza `ErrorConfiguracionPago` si no hay access token y `ErrorSuscripcion`
    ante cualquier fallo de red o respuesta no 2xx (con el detalle de MP).
    """
    if not _access_token():
        raise ErrorConfiguracionPago(
            'La pasarela de pago todavía no está configurada. '
            'La app sigue funcionando en el plan gratuito con publicidad.'
        )

    url = f'{_api_base()}{endpoint}'
    try:
        respuesta = requests.request(
            method, url, headers=_headers(), timeout=TIMEOUT_HTTP, **kwargs
        )
    except requests.RequestException as exc:
        logger.error('MercadoPago %s %s: fallo de red: %s', method, url, exc)
        raise ErrorSuscripcion(
            'No se pudo contactar a la pasarela de pago. Intentá de nuevo.'
        )

    if respuesta.status_code >= 400:
        try:
            detalle = respuesta.json()
        except ValueError:
            detalle = respuesta.text[:500]
        logger.error(
            'MercadoPago %s %s → HTTP %s: %s',
            method, url, respuesta.status_code, detalle,
        )
        raise ErrorSuscripcion(
            'La pasarela de pago rechazó la operación. Intentá de nuevo.'
        )

    try:
        return respuesta.json()
    except ValueError:
        return {}


# =============================================================================
# ALTA DEL CHECKOUT
# =============================================================================
def _crear_preferencia_pago(cuerpo: dict) -> dict:
    """
    Crea la preferencia de Checkout Pro y devuelve la respuesta CRUDA de la
    pasarela (`id`, `init_point`, `sandbox_init_point`, …).

    Usa la SDK OFICIAL (`mercadopago.SDK.preference().create`) cuando la librería
    está instalada y, si no, la API REST equivalente con `requests`. Las dos vías
    comparten el mismo manejo de errores (`ErrorSuscripcion`) para que la vista
    responda igual en ambos casos.

    Raises:
        ErrorConfiguracionPago: falta el access token del servidor.
        ErrorSuscripcion: la pasarela rechazó o no respondió.
    """
    sdk = _sdk_mercadopago()
    if sdk is None:
        return _pedido('POST', '/checkout/preferences', json=cuerpo)

    try:
        respuesta = sdk.preference().create(cuerpo)
    except ErrorConfiguracionPago:
        raise
    except Exception as exc:
        logger.error('SDK de Mercado Pago falló creando la preferencia: %s', exc)
        raise ErrorSuscripcion(
            'No se pudo contactar a la pasarela de pago. Intentá de nuevo.'
        )

    respuesta = respuesta if isinstance(respuesta, dict) else {}
    codigo = respuesta.get('status')
    datos = respuesta.get('response')
    try:
        codigo = int(codigo)
    except (TypeError, ValueError):
        codigo = 0

    if codigo >= 400 or not isinstance(datos, dict):
        logger.error(
            'SDK de Mercado Pago respondió HTTP %s: %s', codigo, respuesta,
        )
        raise ErrorSuscripcion(
            'La pasarela de pago rechazó la operación. Intentá de nuevo.'
        )
    return datos


def crear_preferencia(usuario, estok_id=None) -> dict:
    """
    Crea el registro de compra y la preferencia de Checkout Pro.

    Args:
        usuario: usuario autenticado que va a pagar.
        estok_id: Estok que hereda el plan (None = plan individual).

    Returns:
        {
          "suscripcion_id": "<uuid>", "referencia": "...",
          "preferencia_id": "...", "init_point": "https://...",
          "monto": "4999.00", "moneda": "ARS", "dias": 30, "plan": "pro",
        }

    Raises:
        ErrorConfiguracionPago: falta MERCADOPAGO_ACCESS_TOKEN.
        ErrorSuscripcion: la pasarela rechazó la creación.
    """
    if usuario is None or not getattr(usuario, 'pk', None):
        raise ErrorSuscripcion('Se requiere un usuario autenticado.')

    estok = suscripcion.obtener_estok(estok_id)
    precio = precio_pro()
    dias = dias_pro()

    # Se registra ANTES de llamar a la pasarela: si la creación falla queda la
    # traza del intento (estado 'pendiente') y `external_reference` ya existe.
    registro = SuscripcionPago.objects.create(
        usuario=usuario,
        estok=estok,
        proveedor=PROVEEDOR,
        plan=suscripcion.PLAN_PRO,
        referencia_externa=f'estok-pro-{uuid.uuid4().hex}',
        monto=precio,
        moneda=moneda_pro(),
        dias_otorgados=dias,
    )

    site = str(getattr(settings, 'SITE_URL', '') or '').rstrip('/')
    cuerpo = {
        'items': [
            {
                'id': str(registro.pk),
                'title': titulo_pro(),
                'description': 'Sin publicidad y sin límite de objetos.',
                'quantity': 1,
                'currency_id': registro.moneda,
                'unit_price': float(precio),
            }
        ],
        'payer': {
            'email': getattr(usuario, 'email', '') or '',
            'name': getattr(usuario, 'first_name', '') or '',
            'surname': getattr(usuario, 'last_name', '') or '',
        },
        'external_reference': registro.referencia_externa,
        'notification_url': _webhook_url(),
        'statement_descriptor': 'ESTOK PRO',
        'metadata': {
            'suscripcion_id': str(registro.pk),
            'usuario_id': str(usuario.pk),
            'estok_id': str(estok.pk) if estok is not None else '',
            'plan': suscripcion.PLAN_PRO,
            'dias': dias,
        },
    }
    if site:
        cuerpo['back_urls'] = {
            'success': f'{site}/perfil?suscripcion=ok',
            'failure': f'{site}/perfil?suscripcion=error',
            'pending': f'{site}/perfil?suscripcion=pendiente',
        }
        # `auto_return` exige back_urls con `success` y una URL HTTPS pública.
        if site.startswith('https://'):
            cuerpo['auto_return'] = 'approved'

    preferencia = _crear_preferencia_pago(cuerpo)

    registro.preferencia_id = str(preferencia.get('id') or '')
    registro.init_point = str(preferencia.get('init_point') or '').strip()
    registro.detalle = preferencia
    registro.save(update_fields=[
        'preferencia_id', 'init_point', 'detalle', 'updated_at',
    ])

    logger.info(
        'Preferencia de suscripción %s creada para el usuario %s (estok %s)',
        registro.preferencia_id, usuario.pk,
        estok.pk if estok is not None else '-',
    )
    return {
        'suscripcion_id': str(registro.pk),
        'referencia': registro.referencia_externa,
        'preferencia_id': registro.preferencia_id,
        'init_point': registro.init_point,
        'sandbox_init_point': str(preferencia.get('sandbox_init_point') or ''),
        'monto': f'{precio:.2f}',
        'moneda': registro.moneda,
        'dias': dias,
        'plan': suscripcion.PLAN_PRO,
    }


# =============================================================================
# WEBHOOK: CONSULTA DEL PAGO Y ACTIVACIÓN DEL PLAN
# =============================================================================
def consultar_pago(pago_id) -> dict:
    """GET /v1/payments/{id}: estado REAL del pago (nunca se confía en el body)."""
    return _pedido('GET', f'/v1/payments/{pago_id}')


def _id_numerico(valor) -> str:
    """ID numérico de la pasarela, tolerando URLs y valores vacíos."""
    texto = str(valor or '').strip().rstrip('/')
    if not texto:
        return ''
    if '/' in texto:
        texto = texto.split('/')[-1]
    if '?' in texto:
        texto = texto.split('?')[0]
    return texto if texto.isdigit() else ''


def _pago_id_de_notificacion(payload) -> str:
    """
    ID de pago que trae una notificación de Mercado Pago.

    Formatos reales soportados:
      - Webhook nuevo: {"type": "payment", "data": {"id": "123"}}
      - IPN viejo:     {"topic": "payment", "id": "123"}
      - resource URL:  {"resource": ".../v1/payments/123"}
      - Orden:         devuelve "orden:<id>" para resolverla después.
    """
    if not isinstance(payload, dict):
        return ''
    datos = payload.get('data') if isinstance(payload.get('data'), dict) else {}
    tipo = str(payload.get('type') or payload.get('topic') or '').strip().lower()
    crudo = datos.get('id') or payload.get('id') or payload.get('resource')

    if tipo in ('merchant_order', 'merchant_order_updated'):
        orden_id = _id_numerico(crudo)
        return f'orden:{orden_id}' if orden_id else ''
    return _id_numerico(crudo)


def _pago_id_de_orden(orden_id) -> str:
    """Primer pago de una orden de Mercado Pago ('' si la orden no trae pagos)."""
    orden = _pedido('GET', f'/merchant_orders/{orden_id}')
    for pago in orden.get('payments') or []:
        if isinstance(pago, dict):
            candidato = _id_numerico(pago.get('id'))
            if candidato:
                return candidato
    return ''


def _registro_para(referencia_externa: str, pago_id: str):
    """Registro de compra que corresponde al pago (por referencia o por pago)."""
    if referencia_externa:
        registro = SuscripcionPago.objects.filter(
            referencia_externa=referencia_externa
        ).first()
        if registro is not None:
            return registro
    if pago_id:
        return SuscripcionPago.objects.filter(pago_id=pago_id).first()
    return None


def activar_plan_pro(usuario, dias=None, estok=None) -> bool:
    """
    Activa el plan Pro de un usuario (y del hogar, si `estok` viene).

    Escribe los CUATRO campos que definen el plan y deja que las señales
    (`inventario/signals.py` → `services/suscripcion.py`) propaguen
    `ocultar_publicidad` a todos los miembros del hogar. Devuelve True si aplicó
    cambios (False si el usuario ya era Pro: idempotencia).
    """
    if usuario is None or not getattr(usuario, 'pk', None):
        return False

    dias = dias or dias_pro()
    ya_era_pro = bool(getattr(usuario, 'es_premium', False))

    usuario.es_premium = True
    usuario.plan_suscripcion = suscripcion.PLAN_PRO
    usuario.limite_objetos = None          # NULL = ilimitado
    usuario.ocultar_publicidad = True      # corta la publicidad en la UI
    usuario.save(update_fields=[
        'es_premium', 'plan_suscripcion', 'limite_objetos', 'ocultar_publicidad',
    ])

    if estok is not None:
        estok.es_premium = True
        estok.plan_suscripcion = suscripcion.PLAN_PRO
        estok.limite_objetos = None
        estok.ocultar_publicidad = True
        estok.save(update_fields=[
            'es_premium', 'plan_suscripcion', 'limite_objetos', 'ocultar_publicidad',
        ])
        suscripcion.sincronizar_publicidad_estok(estok)

    logger.info(
        'Plan Pro activado: usuario=%s estok=%s dias=%s (ya era Pro: %s)',
        usuario.pk, getattr(estok, 'pk', '-'), dias, ya_era_pro,
    )
    return not ya_era_pro


def procesar_notificacion(payload) -> dict:
    """
    Procesa una notificación (webhook / IPN) de Mercado Pago.

    Nunca confía en el cuerpo recibido: resuelve el `pago_id` y consulta
    GET /v1/payments/{id} con el access token del servidor. Sólo un pago
    `approved` activa el plan Pro.

    Returns:
        {"ok": True, "estado": "...", "pago_id": "...",
         "referencia": "...", "plan_activado": bool}

    Raises:
        ErrorSuscripcion: la notificación no trae un pago o la pasarela no
            respondió (el ViewSet decide el código HTTP).
    """
    pago_id = _pago_id_de_notificacion(payload)
    if not pago_id:
        raise ErrorSuscripcion('La notificación no trae un pago válido.')

    if pago_id.startswith('orden:'):
        orden_id = pago_id.split(':', 1)[1]
        pago_id = _pago_id_de_orden(orden_id)
        if not pago_id:
            # Orden sin pagos todavía: se acepta y se espera la próxima notificación.
            logger.info('Merchant order %s sin pagos asociados todavía.', orden_id)
            return {
                'ok': True, 'estado': 'pendiente', 'pago_id': '',
                'referencia': '', 'plan_activado': False,
            }

    pago = consultar_pago(pago_id)
    estado = str(pago.get('status') or '').strip().lower()
    referencia = str(pago.get('external_reference') or '').strip()

    registro = _registro_para(referencia, pago_id)
    if registro is None:
        logger.warning(
            'Webhook del pago %s con referencia %s sin compra registrada: se '
            'ignora (no se activa ningún plan sin comprobante local).',
            pago_id, referencia or '-',
        )
        return {
            'ok': True, 'estado': estado, 'pago_id': pago_id,
            'referencia': referencia, 'plan_activado': False,
        }

    # IDEMPOTENCIA: Mercado Pago reintenta la misma notificación varias veces.
    if registro.estado == SuscripcionPago.ESTADO_APROBADO:
        return {
            'ok': True, 'estado': estado, 'pago_id': pago_id,
            'referencia': referencia, 'plan_activado': False,
        }

    registro.pago_id = pago_id
    registro.detalle = pago
    monto = pago.get('transaction_amount')
    if monto is not None:
        try:
            registro.monto = Decimal(str(monto))
        except (InvalidOperation, TypeError, ValueError):
            pass
    moneda = str(pago.get('currency_id') or '').strip()
    if moneda:
        registro.moneda = moneda.upper()

    plan_activado = False
    if estado in ESTADOS_APROBADOS:
        registro.estado = SuscripcionPago.ESTADO_APROBADO
        plan_activado = activar_plan_pro(
            registro.usuario,
            dias=registro.dias_otorgados,
            estok=registro.estok,
        )
    elif estado in ESTADOS_RECHAZADOS:
        registro.estado = SuscripcionPago.ESTADO_RECHAZADO
    else:
        logger.info(
            'Pago %s en estado %s: se espera la próxima notificación.',
            pago_id, estado or 'desconocido',
        )
    registro.save()

    return {
        'ok': True,
        'estado': estado,
        'pago_id': pago_id,
        'referencia': referencia,
        'plan_activado': plan_activado,
    }
