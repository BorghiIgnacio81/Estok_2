"""
Servicio de correo transaccional de Estok.

Fuente ÚNICA del correo de bienvenida: lo usa el registro público
(UserCreateSerializer) y el panel de superadmin (Modo Dios) vía
POST /api/admin/usuarios/{id}/enviar_mail/.

Además permite emitir comunicaciones alternativas (actualización de cuenta,
facturación, reseteo de clave) sin duplicar la lógica de envío.
"""

import logging
from typing import Optional

from django.core.mail import send_mail

logger = logging.getLogger(__name__)

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
        lineas.append('Link de acceso: https://duckdns.org')
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
        return (
            f'¡Hola, {nombre}!\n'
            'Se procesó una solicitud de restablecimiento de acceso a Estok.\n'
            'Si no la realizaste, contactanos de inmediato.'
        )
    return f'¡Hola, {nombre}!\nComunicación oficial de Estok.'


def enviar_email_usuario(
    user,
    tipo: str = TIPO_BIENVENIDA,
    password: Optional[str] = None,
) -> bool:
    """
    Envía un correo transaccional al usuario.

    Devuelve True si el envío se efectuó y False si falló o el usuario no
    tiene email. La excepción nunca se propaga (fail_silently + try/except).

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
        enviados = send_mail(
            subject=subject,
            message=cuerpo,
            from_email=None,
            recipient_list=[email],
            fail_silently=True,
        )
    except Exception as e:  # noqa: BLE001 - nunca romper el flujo por email
        logger.warning('No se pudo enviar email "%s" a %s: %s', tipo, email, e)
        return False

    if not enviados:
        logger.warning(
            'No se pudo enviar email "%s" a %s (send_mail devolvió 0).',
            tipo,
            email,
        )
        return False

    logger.info('Email "%s" enviado a %s', tipo, email)
    return True
