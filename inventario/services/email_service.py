"""
Servicio de correo transaccional de Estok.

Fuente ÚNICA del correo de bienvenida: lo usa el registro público
(UserCreateSerializer) y el panel de superadmin (Modo Dios) vía
POST /api/admin/usuarios/{id}/enviar_mail/.

Además permite emitir comunicaciones alternativas (actualización de cuenta,
facturación, reseteo de clave e invitación a un Estok) sin duplicar la lógica
de envío: todo pasa por _enviar_mensaje(), que es el único punto donde se
manejan los errores SMTP.
"""

import logging
import re
import smtplib
from typing import Optional, Tuple

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
TIPO_INVITACION = 'invitacion'

TIPOS_SOPORTADOS = (
    TIPO_BIENVENIDA,
    TIPO_ACTUALIZACION,
    TIPO_FACTURACION,
    TIPO_RESETEO,
    TIPO_INVITACION,
)

# Asuntos por tipo
_SUBJECTS = {
    TIPO_BIENVENIDA: '¡Bienvenido a Estok!',
    TIPO_ACTUALIZACION: 'Actualización de tu cuenta en Estok',
    TIPO_FACTURACION: 'Estado de tu facturación en Estok',
    TIPO_RESETEO: 'Restablecimiento de acceso a Estok',
    TIPO_INVITACION: 'Invitación para unirte a un Estok',
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


def _enviar_mensaje(asunto: str, cuerpo: str, destinatario: str, tipo: str) -> bool:
    """
    Punto ÚNICO de envío de correo del servicio (bienvenida, reseteo, invitación).

    NUNCA propaga excepciones: todo fallo de red o rechazo del servidor SMTP se
    captura, se loguea con el error CRUDO de Google y se reporta devolviendo
    False, de modo que el endpoint responda un código HTTP controlado en lugar
    de colapsar (502 / worker colgado).

    Se usa `fail_silently=False` a propósito: con `True`, Django traga la
    excepción del servidor SMTP y `send` devuelve 0 sin explicación (así se
    ocultaba el "550 Daily user sending limit exceeded" de Gmail). El silencio
    se maneja ACÁ, devolviendo False, nunca propagando.
    """
    try:
        mensaje = EmailMessage(
            subject=asunto,
            body=cuerpo,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[destinatario],
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
            'SMTP rechazó el mensaje "%s" para %s: %s', tipo, destinatario, exc,
        )
        return False
    except (smtplib.SMTPException, OSError) as exc:
        # SMTPException cubre fallos del protocolo; OSError cubre DNS,
        # conexión rechazada y timeout (socket.timeout es subclase de OSError).
        logger.error(
            'Falló la conexión SMTP al enviar "%s" a %s: %s', tipo, destinatario, exc,
        )
        return False
    except Exception:  # noqa: BLE001 - el email nunca rompe el flujo
        logger.exception(
            'Error inesperado enviando email "%s" a %s', tipo, destinatario,
        )
        return False

    if not enviados:
        logger.warning(
            'No se pudo enviar email "%s" a %s (send devolvió 0).',
            tipo,
            destinatario,
        )
        return False

    logger.info('Email "%s" enviado a %s', tipo, destinatario)
    return True


def enviar_email_usuario(
    user,
    tipo: str = TIPO_BIENVENIDA,
    password: Optional[str] = None,
) -> bool:
    """
    Envía un correo transaccional al usuario.

    Devuelve True si el envío se efectuó y False si falló o el usuario no
    tiene email. Delega el envío (y TODO el manejo de errores SMTP) en
    _enviar_mensaje(): acá solo se valida el destinatario y se arma el cuerpo.

    - tipo='bienvenida': incluye las credenciales SOLO si se recibe
      `password` (el registro público lo tiene en claro; el panel admin no).
    """
    email = getattr(user, 'email', None)
    if not email:
        logger.warning('enviar_email_usuario: %s no tiene email asignado.', user)
        return False

    nombre = user.first_name or user.username or ''
    username = getattr(user, 'username', '') or ''
    return _enviar_mensaje(
        asunto=_SUBJECTS.get(tipo, _SUBJECTS[TIPO_BIENVENIDA]),
        cuerpo=_cuerpo_email(tipo, nombre, username, password),
        destinatario=email,
        tipo=tipo,
    )


# =============================================================================
# INVITACIÓN A UN ESTOK (modal "Invitar miembros" del navbar)
# =============================================================================

# Validación deliberadamente laxa: se usa solo para distinguir "es un email" de
# "es un nombre de usuario", no para bloquear direcciones exóticas pero válidas.
_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$')

# Página con el formulario "Unirme con código" (frontend /estoks).
ENLACE_UNIRSE = 'https://eeestok.duckdns.org/estoks'

# Mensaje ÚNICO que se devuelve cuando el campo unificado del modal no
# corresponde a ninguna cuenta registrada. Vive acá (y no en la vista) porque
# forma parte del contrato del servicio de invitaciones.
MENSAJE_DESTINATARIO_INEXISTENTE = (
    'El usuario o correo electrónico ingresado no corresponde a ninguna '
    'cuenta registrada en ESTOK.'
)


def _buscar_usuario_por_username(valor: str):
    """
    Busca una cuenta por NOMBRE DE USUARIO (sin distinguir mayúsculas).

    Devuelve None si no existe o si la consulta falla: el llamador decide el
    mensaje, acá nunca se propaga una excepción del ORM.
    """
    from django.contrib.auth import get_user_model

    try:
        return get_user_model().objects.filter(username__iexact=valor).first()
    except Exception:  # noqa: BLE001 - la búsqueda no puede tumbar el endpoint
        logger.exception('Falló la búsqueda del invitado por username (%r)', valor)
        return None


def _buscar_usuario_por_email(valor: str):
    """
    Busca una cuenta por EMAIL (sin distinguir mayúsculas).

    Devuelve None si no existe o si la consulta falla (mismo criterio que
    _buscar_usuario_por_username).
    """
    from django.contrib.auth import get_user_model

    try:
        return get_user_model().objects.filter(email__iexact=valor).first()
    except Exception:  # noqa: BLE001 - la búsqueda no puede tumbar el endpoint
        logger.exception('Falló la búsqueda del invitado por email (%r)', valor)
        return None


def resolver_destinatario_invitacion(
    invitado: str, es_usuario_estok: bool = False
) -> Tuple[Optional[str], Optional[str]]:
    """
    Punto ÚNICO de resolución del destinatario del modal "Invitar miembros".

    Normaliza el dato cargado en el campo unificado (switch "Es usuario de
    Estok") a una dirección de correo concreta de una cuenta REGISTRADA: el
    administrador puede escribir el EMAIL del invitado o, si ya tiene cuenta, su
    NOMBRE DE USUARIO, y acá se resuelve al email real para que la invitación
    llegue igual.

    Devuelve (email, aviso); con email None, `aviso` explica el motivo en
    lenguaje llano. NUNCA propaga excepciones: cualquier fallo del ORM se
    loguea acá y el endpoint responde HTTP 400 controlado en lugar de un 500.
    """
    invitado = (invitado or '').strip()
    if not invitado:
        return None, 'Indicá un email o un nombre de usuario para enviar la invitación.'

    try:
        if es_usuario_estok:
            # Switch ON: el campo es el NOMBRE DE USUARIO, pero el modal avisa
            # que también se acepta el email del invitado.
            usuario = (
                _buscar_usuario_por_username(invitado)
                or _buscar_usuario_por_email(invitado)
            )
            if usuario is None:
                return None, MENSAJE_DESTINATARIO_INEXISTENTE
            if not usuario.email:
                return None, f'El usuario "{invitado}" no tiene email cargado en su perfil.'
            return usuario.email, None

        # Switch OFF: el campo es un EMAIL, y también debe corresponder a una
        # cuenta registrada (mismo contrato unificado del formulario).
        if not _EMAIL_RE.match(invitado):
            return None, f'"{invitado}" no parece una dirección de email válida.'
        usuario = _buscar_usuario_por_email(invitado)
        if usuario is None:
            return None, MENSAJE_DESTINATARIO_INEXISTENTE
        return usuario.email or invitado, None
    except Exception:  # noqa: BLE001 - el modal recibe aviso, nunca un 500
        logger.exception(
            'No se pudo resolver el destinatario de la invitación (%r)', invitado
        )
        return None, MENSAJE_DESTINATARIO_INEXISTENTE


def _cuerpo_invitacion(
    codigo: str, estok_nombre: str, invitado_por: str, usos_maximos: int
) -> str:
    """Cuerpo del correo de invitación: código + pasos para unirse al Estok."""
    quien = f'{invitado_por} te invita' if invitado_por else 'Te invitan'
    lineas = [
        '¡Hola!',
        f'{quien} a unirte al Estok "{estok_nombre}".',
        '',
        f'🔑 Código de invitación: {codigo}',
        '',
        'Pasos para unirte:',
        f'1. Ingresá a {ENLACE_UNIRSE}',
        '2. Escribí el código en "Unirme con código" y presioná Unirme.',
    ]
    if usos_maximos > 0:
        lineas += ['', f'⚠️ El código caduca automáticamente tras {usos_maximos} usos.']
    return '\n'.join(lineas)


def enviar_invitacion_estok(
    invitado: str,
    codigo: str,
    estok_nombre: str,
    es_usuario_estok: bool = False,
    usos_maximos: int = 0,
    invitado_por: str = '',
    destinatario: Optional[str] = None,
) -> Tuple[bool, Optional[str]]:
    """
    Despacha por SMTP el código de invitación a un Estok.

    Acepta indistintamente el EMAIL o el NOMBRE DE USUARIO del invitado, tal
    como lo permite el modal "Invitar miembros". `destinatario` permite pasar la
    dirección YA resuelta (la vista la calcula antes de crear el código) y así
    no repetir la búsqueda en la base.

    Devuelve (enviado, aviso) y NUNCA propaga excepciones: el código ya fue
    creado en la base, así que un fallo de correo se reporta como aviso y la
    respuesta HTTP sigue siendo exitosa (el frontend muestra el código igual).
    """
    if destinatario is None:
        destinatario, aviso = resolver_destinatario_invitacion(invitado, es_usuario_estok)
        if not destinatario:
            return False, aviso

    enviado = _enviar_mensaje(
        asunto=_SUBJECTS[TIPO_INVITACION],
        cuerpo=_cuerpo_invitacion(codigo, estok_nombre, invitado_por, usos_maximos),
        destinatario=destinatario,
        tipo=TIPO_INVITACION,
    )
    if not enviado:
        return False, 'El servidor de correo rechazó el envío. Compartí el código manualmente.'
    return True, None
