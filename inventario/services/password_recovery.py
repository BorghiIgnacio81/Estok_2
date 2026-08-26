"""
Servicio del flujo "Olvidó su contraseña".

Centraliza:
- `generar_clave_temporal()`: generación de claves temporales seguras
  (criptográficamente aleatorias). Reutilizada por el panel de superadmin
  (Modo Dios) para el primer envío de credenciales de bienvenida.
- `recuperar_password_usuario()`: lógica completa de recuperación de acceso
  usada por el endpoint público POST /api/usuarios/recuperar-password/.
"""

import logging
import secrets
import string

logger = logging.getLogger(__name__)


def generar_clave_temporal(longitud: int = 8) -> str:
    """
    Genera una contraseña temporal segura (criptográficamente aleatoria).

    Garantiza al menos una mayúscula, una minúscula y un dígito, y mezcla el
    resultado con Fisher-Yates sobre SystemRandom (fuente criptográfica).
    """
    if longitud < 4:
        longitud = 8
    alfabeto = string.ascii_letters + string.digits
    caracteres = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
    ]
    caracteres += [secrets.choice(alfabeto) for _ in range(longitud - 3)]

    # Mezcla Fisher-Yates con fuente criptográfica (evita patrón de prefijo)
    rng = secrets.SystemRandom()
    for i in range(len(caracteres) - 1, 0, -1):
        j = rng.randrange(i + 1)
        caracteres[i], caracteres[j] = caracteres[j], caracteres[i]
    return ''.join(caracteres)


def recuperar_password_usuario(email=None, username=None):
    """
    Procesa una solicitud de recuperación de acceso.

    Encuentra la cuenta por email (prioritario) o username, genera una clave
    temporal de 8 caracteres, la aplica con set_password(), activa el flag
    `tiene_clave_temporal = True` y dispara el envío del correo SMTP con la
    clave temporal (el usuario podrá loguearse y será redirigido a /perfil
    para definir una clave nueva).

    Retorna (user, clave_temporal, enviado):
      - user: instancia de CustomUser, o None si la cuenta no existe.
      - clave_temporal: str en claro (None si no se generó).
      - enviado: bool, True si el correo se despachó correctamente.

    Levanta ValueError con mensaje amigable ante datos inválidos, cuenta
    inactiva o cuenta sin email configurado. El fallo de SMTP NO se propaga:
    se reporta vía `enviado=False`.
    """
    from ..models import CustomUser
    from .email_service import TIPO_RESETEO, enviar_email_usuario

    email = (email or '').strip().lower()
    username = (username or '').strip()

    if not email and not username:
        raise ValueError('Debés indicar tu email o tu nombre de usuario.')

    # Búsqueda con prioridad al email (identificador único real).
    user = None
    if email:
        user = CustomUser.objects.filter(email__iexact=email).first()
    if user is None and username:
        user = CustomUser.objects.filter(username__iexact=username).first()

    # Anti-enumeración: la respuesta la decide el endpoint (genérica).
    if user is None:
        logger.info(
            'Recuperación solicitada para cuenta inexistente '
            '(email=%s, username=%s).',
            email or '-', username or '-',
        )
        return None, None, False

    if not user.is_active:
        raise ValueError('La cuenta está desactivada. Contactá al administrador.')

    if not user.email:
        logger.warning(
            'Recuperación de %s: la cuenta no tiene email configurado.',
            user.username,
        )
        raise ValueError('La cuenta no tiene un email configurado para el envío.')

    clave_temporal = generar_clave_temporal()
    user.set_password(clave_temporal)
    user.tiene_clave_temporal = True
    user.save(update_fields=['password', 'tiene_clave_temporal'])
    logger.info(
        'Clave temporal generada e inyectada para %s (recuperación).',
        user.username,
    )

    enviado = enviar_email_usuario(user, tipo=TIPO_RESETEO, password=clave_temporal)
    if not enviado:
        logger.warning(
            'No se pudo enviar la clave temporal de %s a %s.',
            user.username, user.email,
        )

    return user, clave_temporal, enviado
