"""
Servicio de autenticación y presencia de usuarios.

Concentra la lógica de negocio PURA que antes vivía embebida en el ViewSet
`inventario/api/viewsets/usuarios.py`. NO conoce `request` ni `Response`:
recibe datos primitivos u objetos de dominio y lanza excepciones nativas de
DRF (`ValidationError`) para que las vistas las traduzcan a HTTP 400/404/502
en lugar de caer en un error 500.

Reglas de negocio preservadas SIN CAMBIOS:
- Heartbeat de presencia y ventana ONLINE_TIMEOUT_MINUTES.
- Access Log en RAM volátil (sin persistencia), thread-safe, tope de 50.
- Regla de privacidad: 'ygumy44' ve todo; el resto exige `estok_id`.
- Alias "Yamza" visible SOLO para 'SoledadMartinez'.
- Recuperación de acceso por el PAR username + email (delegada en
  inventario/services/password_recovery.py, única fuente de verdad).
"""

import threading
from collections import OrderedDict

from django.utils import timezone
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ValidationError as DRFValidationError

from ...models import CustomUser, Membresia
from ...services.password_recovery import recuperar_password_usuario


# Tiempo máximo desde última actividad para considerar a un usuario "online".
ONLINE_TIMEOUT_MINUTES = 2

# =============================================================================
# ACCESS LOG DE PRESENCIA EN RAM VOLÁTIL (Anti-forense local)
# =============================================================================
# Almacena los últimos 50 handshakes al endpoint /api/usuarios/online/ en la
# memoria del proceso. NO persiste en disco/BD: al reiniciar el contenedor los
# datos se destruyen automáticamente. Solo visible para el usuario 'ygumy44'.
# =============================================================================
_ACCESS_LOG = OrderedDict()  # {idx: {...}}
_ACCESS_LOG_LOCK = threading.Lock()
_ACCESS_LOG_MAX = 50
_ACCESS_LOG_COUNTER = 0


def registrar_entrada_access_log(usuario_id, username, ip_address, user_agent):
    """
    Agrega una entrada al access log en RAM volátil.
    Thread-safe. Mantiene un máximo de _ACCESS_LOG_MAX entradas (FIFO).
    """
    global _ACCESS_LOG_COUNTER
    with _ACCESS_LOG_LOCK:
        _ACCESS_LOG_COUNTER += 1
        entry = {
            "id": _ACCESS_LOG_COUNTER,
            "usuario_id": str(usuario_id),
            "username": username,
            "ip_address": ip_address,
            "user_agent": user_agent[:500] if user_agent else "",  # Truncar UA largo
            "timestamp_utc": timezone.now().isoformat(),
        }
        _ACCESS_LOG[_ACCESS_LOG_COUNTER] = entry
        # Mantener solo los últimos N registros
        while len(_ACCESS_LOG) > _ACCESS_LOG_MAX:
            _ACCESS_LOG.popitem(last=False)


def snapshot_access_log():
    """Entradas del access log (más recientes primero) + capacidad máxima."""
    with _ACCESS_LOG_LOCK:
        entries = list(reversed(list(_ACCESS_LOG.values())))
    return {
        "total": len(entries),
        "max_capacity": _ACCESS_LOG_MAX,
        "entries": entries,
    }


def capturar_metadata(request):
    """Captura la IP real (X-Forwarded-For / REMOTE_ADDR) y el User-Agent."""
    ip_address = (
        request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip()
        or request.META.get('REMOTE_ADDR', '')
    )
    user_agent = request.META.get('HTTP_USER_AGENT', '')
    return ip_address, user_agent


def registrar_actividad(user):
    """Heartbeat: actualiza `ultima_actividad` del usuario autenticado."""
    user.ultima_actividad = timezone.now()
    user.save(update_fields=['ultima_actividad'])


def recuperar_password(email=None, username=None):
    """
    Flujo "Olvidó su contraseña": genera y envía una clave temporal.

    Delega la lógica en inventario/services/password_recovery.py y devuelve
    (user, enviado):
      - user: instancia de CustomUser o None si el par no existe (la vista
        responde 404).
      - enviado: bool, True si el correo se despachó (la vista responde 502
        cuando es False).
    Lanza ValidationError (HTTP 400) si falta un dato, la cuenta está inactiva
    o no tiene email configurado.
    """
    try:
        user, _clave_temporal, enviado = recuperar_password_usuario(
            email=email,
            username=username,
        )
    except ValueError as exc:
        raise DRFValidationError({'error': str(exc)})
    return user, enviado


def membresias_del_usuario(user):
    """
    Estoks donde el usuario tiene membresía activa (contract `estoks[]`).

    Devuelve la lista COMPLETA de inquilinatos (no solo el activo): el selector
    "MIS ESTOKS" del Navbar necesita TODOS, incluidos los sumados por código de
    invitación o asignación de administración.
    """
    membresias = Membresia.objects.filter(
        usuario=user,
    ).select_related('estok', 'role')
    return [
        {
            "id": str(m.estok.id),
            "nombre": m.estok.nombre,
            "role": m.role.name if m.role else None,
            "role_id": str(m.role.id) if m.role else None,
        }
        for m in membresias
    ]


def id_estok_activo(user):
    """UUID del último Estok activo como string, o None si no hay ninguno."""
    ultimo = getattr(user, 'ultimo_estok_activo_id', None)
    return str(ultimo) if ultimo else None


def actualizar_perfil(user, data):
    """
    Actualiza los datos base y/o la contraseña del PROPIO usuario.

    Devuelve `password_cambiada` (bool) para que la vista renueve el hash de la
    sesión con update_session_auth_hash(): sin esa llamada, los demás workers
    de Gunicorn conservan el hash viejo cacheado y desloguean al usuario.

    Lanza ValidationError (HTTP 400) con cuerpo {"error": ...} —idéntico al
    contrato previo— ante cualquier dato inválido.
    """
    data = data or {}
    cambios = False
    password_cambiada = False

    # --- 1) Datos base ---
    for campo in ('username', 'email', 'first_name', 'last_name'):
        if campo in data:
            valor = str(data[campo]).strip()
            if not valor:
                raise DRFValidationError(
                    {'error': f'El campo "{campo}" no puede quedar vacío.'}
                )
            setattr(user, campo, valor)
            cambios = True

    # Validar unicidad de username/email (evita colisiones con otros usuarios)
    if cambios:
        try:
            user.validate_unique()
        except DjangoValidationError as e:
            raise DRFValidationError({
                'error': '; '.join(
                    f'{campo}: {", ".join(mensajes)}'
                    for campo, mensajes in e.message_dict.items()
                )
            })

    # --- 2) Cambio de contraseña (valida la actual antes de set_password) ---
    password_actual = data.get('password_actual')
    password_nueva = data.get('password_nueva')
    if password_actual or password_nueva:
        if not password_actual or not password_nueva:
            raise DRFValidationError(
                {'error': 'Para cambiar la contraseña debés ingresar la actual y la nueva.'}
            )
        if not user.check_password(password_actual):
            raise DRFValidationError({'error': 'La contraseña actual es incorrecta.'})
        if len(str(password_nueva)) < 8:
            raise DRFValidationError(
                {'error': 'La contraseña nueva debe tener al menos 8 caracteres.'}
            )
        user.set_password(password_nueva)
        password_cambiada = True
        # Flujo "Olvidó su contraseña": el usuario entró con clave temporal y
        # acaba de definir una propia → se apaga el flag de bloqueo.
        user.tiene_clave_temporal = False
        cambios = True

    if not cambios:
        raise DRFValidationError({'error': 'No se enviaron campos para actualizar.'})

    user.save()
    return password_cambiada


def usuarios_online(user, estok_id):
    """
    Usuarios activos en los últimos ONLINE_TIMEOUT_MINUTES minutos.

    REGLAS:
    - 'ygumy44' (superuser) ve TODOS los usuarios online de la plataforma.
    - El resto necesita `estok_id` OBLIGATORIO; sin él devuelve [].
    - Se excluye al propio usuario que hace la petición.
    - PRIVACIDAD: solo 'SoledadMartinez' ve a 'ygumy44' como alias "Yamza".
    """
    cutoff = timezone.now() - timezone.timedelta(minutes=ONLINE_TIMEOUT_MINUTES)

    if user.username != 'ygumy44' and not estok_id:
        return []

    miembros_ids = Membresia.objects.filter(
        estok_id=estok_id
    ).values_list('usuario_id', flat=True)
    online_users = CustomUser.objects.filter(
        id__in=miembros_ids,
        ultima_actividad__gte=cutoff,
        is_active=True,
    )

    data = []
    for u in online_users:
        # No incluir al propio usuario que hace la petición
        if u.id == user.id:
            continue

        user_data = {
            "id": str(u.id),
            "username": u.username,
            "first_name": u.first_name or '',
            "last_name": u.last_name or '',
            "display_name": u.get_full_name() or u.username,
            "ultima_actividad": u.ultima_actividad.isoformat() if u.ultima_actividad else None,
        }

        if user.username == 'SoledadMartinez':
            remitente_str = f"{u.username} {u.first_name or ''} {u.last_name or ''}".lower()
            if u.username == 'ygumy44' or 'borghi' in remitente_str or 'ignacio' in remitente_str:
                user_data['username'] = 'Yamza'
                user_data['first_name'] = 'Yamza'
                user_data['last_name'] = ''
                user_data['display_name'] = 'Yamza'

        data.append(user_data)

    return data
