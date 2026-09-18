"""
Servicio de correo transaccional de Estok.

Fuente ÚNICA del correo de bienvenida: lo usa el registro público
(UserCreateSerializer) y el panel de superadmin (Modo Dios) vía
POST /api/admin/usuarios/{id}/enviar_mail/.

Además permite emitir comunicaciones alternativas (actualización de cuenta,
facturación, reseteo de clave) sin duplicar la lógica de envío.
"""

import logging
import smtplib
from typing import Optional

from django.conf import settings
from django.core.mail import EmailMessage, get_connection

logger = logging.getLogger(__name__)

# =============================================================================
# CONEXIÓN SMTP
# =============================================================================
# El detalle CRUDO del error SMTP nunca se filtra al cliente HTTP (sería una
# fuga de información de la cuenta de correo): queda en el log con
# logger.error desde enviar_email_usuario() para diagnóstico en producción.
# =============================================================================


def _crear_conexion():
    """
    Crea una conexión SMTP con timeout EXPLÍCITO (settings.EMAIL_TIMEOUT).

    El timeout es la defensa contra el 502 por timeout: sin él, un cuelgue de
    Gmail deja al worker de Gunicorn bloqueado hasta que el proxy corta la
    petición (el cliente interpreta eso como "Bad Gateway").
    """
    return get_connection(
        backend=settings.EMAIL_BACKEND,
        fail_silently=False,
        timeout=getattr(settings, 'EMAIL_TIMEOUT', 10),
    )

# =============================================================================
# Tipos de notificación soportados (contrato con el frontend)
# =============================================================================
TIPO_BIENVENIDA = 'bienvenida'
TIPO_ACTUALIZACION = 'actualizacion'
TIPO_FACTURACION = 'facturacion'
TIPO_RESETEO = 'reseteo'

TIPOS_SOPORTADOS = (
    TIPO_BIENVENIDA,
    TIPO_ACTUALIZACION,
    TIPO_FACTURACION,
    TIPO_RESETEO,
)

# Asuntos por tipo
_SUBJECTS = {
    TIPO_BIENVENIDA: '¡Bienvenido a Estok!',
    TIPO_ACTUALIZACION: 'Actualización de tu cuenta en Estok',
    TIPO_FACTURACION: 'Estado de tu facturación en Estok',
    TIPO_RESETEO: 'Restablecimiento de acceso a Estok',
}


def _cuerpo_email(tipo: str, nombre: str, username: str, password: Optional[str]) -> str:
    """Construye el cuerpo del correo según el tipo de notificación."""
    if tipo == TIPO_BIENVENIDA:
        lineas = [
            f'¡Hola, {nombre}!',
            'Tu cuenta ha sido creada con éxito.',
        ]
        if password:
            # El registro público tiene la contraseña en claro.
            lineas += [
                'Aquí tienes tus datos de acceso:',
                f'👤 Usuario: {username}',
                f'🔑 Contraseña: {password}',
            ]
        else:
            # El panel admin no conoce la contraseña en claro (está hasheada).
            lineas.append(f'👤 Usuario: {username}')
        lineas.append('Link de acceso: https://eeestok.duckdns.org/')
        return '\n'.join(lineas)

    if tipo == TIPO_ACTUALIZACION:
        return (
            f'¡Hola, {nombre}!\n'
            'Te informamos novedades importantes sobre tu cuenta en Estok.\n'
            'Ingresá a tu panel para revisar los cambios.'
        )
    if tipo == TIPO_FACTURACION:
        return (
            f'¡Hola, {nombre}!\n'
            'Actualizamos el estado de tu facturación en Estok.\n'
            'Ingresá a tu panel para ver los detalles.'
        )
    if tipo == TIPO_RESETEO:
        lineas = [
            f'¡Hola, {nombre}!',
            'Se procesó una solicitud de restablecimiento de acceso a Estok.',
        ]
        if password:
            # El flujo "Olvidó su contraseña" genera una clave temporal
            # en claro que DEBE viajar en el correo para que el usuario
            # pueda ingresar. Al loguearse, el sistema lo redirige a su
            # perfil para que defina una clave nueva definitiva.
            lineas += [
                'Aquí tienes tus credenciales temporales de acceso:',
                f'👤 Usuario: {username}',
                f'🔑 Contraseña temporal: {password}',
                '',
                '⚠️ IMPORTANTE: al ingresar serás redirigido a tu perfil',
                'para que definas una contraseña nueva definitiva.',
            ]
        else:
            lineas.append('Si no la realizaste, contactanos de inmediato.')
        return '\n'.join(lineas)
    return f'¡Hola, {nombre}!\nComunicación oficial de Estok.'


def enviar_email_usuario(
    user,
    tipo: str = TIPO_BIENVENIDA,
    password: Optional[str] = None,
) -> bool:
    """
    Envía un correo transaccional al usuario.

    Devuelve True si el envío se efectuó y False si falló o el usuario no
    tiene email. NUNCA propaga excepciones: todo fallo de red o rechazo del
    servidor SMTP se captura, se loguea con el error CRUDO de Google y se
    reporta devolviendo False, de modo que el endpoint responda un código
    HTTP controlado en lugar de colapsar (502 / worker colgado).

    Se usa `fail_silently=False` a propósito: con `True`, Django traga la
    excepción del servidor SMTP y `send_mail` devuelve 0 sin explicación
    (así se ocultaba el "550 Daily user sending limit exceeded" de Gmail).
    El silencio se maneja ACÁ, devolviendo False, nunca propagando.

    - tipo='bienvenida': incluye las credenciales SOLO si se recibe
      `password` (el registro público lo tiene en claro; el panel admin no).
    """
    email = getattr(user, 'email', None)
    if not email:
        logger.warning('enviar_email_usuario: %s no tiene email asignado.', user)
        return False

    nombre = user.first_name or user.username or ''
    username = getattr(user, 'username', '') or ''
    subject = _SUBJECTS.get(tipo, _SUBJECTS[TIPO_BIENVENIDA])
    cuerpo = _cuerpo_email(tipo, nombre, username, password)

    try:
        mensaje = EmailMessage(
            subject=subject,
            body=cuerpo,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[email],
            connection=_crear_conexion(),
        )
        enviados = mensaje.send(fail_silently=False)
    except smtplib.SMTPAuthenticationError as exc:
        # App password revocada, 2FA desactivada o usuario mal configurado.
        logger.error(
            'SMTP rechazó las credenciales de "%s" (%s): %s',
            settings.EMAIL_HOST_USER, settings.EMAIL_HOST, exc,
        )
        return False
    except smtplib.SMTPDataError as exc:
        # Ej: 550 "Daily user sending limit exceeded" (cuota diaria de Gmail)
        # o mensaje rechazado por políticas del destinatario.
        logger.error(
            'SMTP rechazó el mensaje "%s" para %s: %s', tipo, email, exc,
        )
        return False
    except (smtplib.SMTPException, OSError) as exc:
        # SMTPException cubre fallos del protocolo; OSError cubre DNS,
        # conexión rechazada y timeout (socket.timeout es subclase de OSError).
        logger.error(
            'Falló la conexión SMTP al enviar "%s" a %s: %s', tipo, email, exc,
        )
        return False
    except Exception:  # noqa: BLE001 - el email nunca rompe el flujo
        logger.exception(
            'Error inesperado enviando email "%s" a %s', tipo, email,
        )
        return False

    if not enviados:
        logger.warning(
            'No se pudo enviar email "%s" a %s (send devolvió 0).',
            tipo,
            email,
        )
        return False

    logger.info('Email "%s" enviado a %s', tipo, email)
    return True
