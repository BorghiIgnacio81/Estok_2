"""
Tokens firmados para las decisiones remotas del dueño (puente del 403).

El correo de notificación incluye 3 botones (Vender / Conservar / Tirar) que
apuntan al endpoint público `/api/public/objeto-remoto-decision/`. Cada botón
lleva un token firmado con `django.core.signing` (HMAC-SHA256 con
`settings.SECRET_KEY`) que empaqueta:

    { "objeto_id": "<uuid>", "user_id": "<uuid del dueño>", "action": "vender" }

La firma hace imposible falsificar el contenido: sin el SECRET_KEY del servidor
no se puede alterar el objeto, el dueño ni la acción. El enlace caduca a los
3 días (72 h) — `VIGENCIA_SEGUNDOS` — y el `salt` aísla esta firma del resto de
los usos de `signing` del proyecto.

SEMÁNTICA DE USO: el token codifica UNA sola acción y el endpoint es IDEMPOTENTE
(un `owner_action` ya fijado no se pisa), por lo que reutilizar el mismo enlace
dentro de su vigencia jamás vuelve a aplicar ni cambia la decisión.
"""

import logging
from urllib.parse import quote

from django.conf import settings
from django.core import signing

logger = logging.getLogger(__name__)

# Sal ESPECÍFICO de este flujo (aísla la firma del resto de usos de signing).
SALT = 'objeto-decision-remota'

# Vida útil ESTRICTA del enlace: 3 días (72 horas).
VIGENCIA_SEGUNDOS = 259200

# Acciones válidas del dueño. Espejo reducido de Objeto.OWNER_ACTION_CHOICES:
# 'mudar' NO viaja por correo porque la mudanza es una operación interna del
# tablero (requiere membresía), no una decisión remota de un clic.
ACCIONES_VALIDAS = ('vender', 'conservar', 'tirar')


class TokenInvalido(Exception):
    """Token ausente, vencido o alterado. Su `str` es el aviso en español."""


def firmar_token_decision(objeto, dueno, action):
    """Firma el token del dueño para UNA acción concreta."""
    action = (action or '').strip().lower()
    if action not in ACCIONES_VALIDAS:
        raise ValueError(f'Acción no válida para el token: {action!r}')

    payload = {
        'objeto_id': str(objeto.id),
        'user_id': str(getattr(dueno, 'id', '') or objeto.dueno_original_id),
        'action': action,
    }
    return signing.dumps(payload, salt=SALT)


def url_publica_decision(objeto, dueno, action):
    """URL absoluta del enlace firmado que viaja dentro del correo."""
    token = quote(firmar_token_decision(objeto, dueno, action), safe='')
    base = (getattr(settings, 'SITE_URL', '') or 'https://eeestok.duckdns.org').rstrip('/')
    return f'{base}/api/public/objeto-remoto-decision/?token={token}&action={action}'


def verificar_token_decision(token):
    """
    Valida la firma y la vigencia del token y devuelve su payload.

    Lanza `TokenInvalido` (con aviso en español) si el token está ausente,
    vencido, alterado o no trae los datos mínimos.
    """
    try:
        payload = signing.loads(token, salt=SALT, max_age=VIGENCIA_SEGUNDOS)
    except signing.SignatureExpired:
        raise TokenInvalido(
            'El enlace venció (su validez es de 3 días). Pedile al Estok que te '
            'reenvíe la invitación.'
        )
    except signing.BadSignature:
        raise TokenInvalido('El enlace no es válido.')
    except Exception:  # noqa: BLE001 - cualquier token ilegible se rechaza igual
        logger.exception('Token de decisión remota ilegible')
        raise TokenInvalido('El enlace no es válido.')

    if not isinstance(payload, dict) or payload.get('action') not in ACCIONES_VALIDAS:
        raise TokenInvalido('El enlace no es válido.')
    if not payload.get('objeto_id') or not payload.get('user_id'):
        raise TokenInvalido('El enlace no es válido.')
    return payload
