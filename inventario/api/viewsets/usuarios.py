"""
ViewSets para usuarios y roles.
"""

import threading
from collections import OrderedDict
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from ...models import Role, CustomUser, Membresia, Estok
from ..serializers import RoleSerializer, UserSerializer, UserCreateSerializer
from .base import HasRolePermission
from ...services.password_recovery import recuperar_password_usuario
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.core.exceptions import ValidationError


# Tiempo máximo desde última actividad para considerar a un usuario "online"
ONLINE_TIMEOUT_MINUTES = 2

# =============================================================================
# ACCESS LOG DE PRESENCIA EN RAM VOLÁTIL (Anti-forense local)
# =============================================================================
# Almacena los últimos 50 registros de conexión al endpoint /api/usuarios/online/
# en memoria RAM del proceso. NO persiste en disco/BD. Al reiniciar el contenedor
# los datos se destruyen automáticamente.
# Solo accesible para el usuario 'ygumy44'.
# =============================================================================
_ACCESS_LOG = OrderedDict()  # {idx: {...}}
_ACCESS_LOG_LOCK = threading.Lock()
_ACCESS_LOG_MAX = 50
_ACCESS_LOG_COUNTER = 0


def _add_access_log_entry(usuario_id, username, ip_address, user_agent):
    """
    Agrega una entrada al access log en RAM volátil.
    Thread-safe. Mantiene un máximo de _ACCESS_LOG_MAX entradas.
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


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]


@method_decorator(csrf_exempt, name='dispatch')
class UserViewSet(viewsets.ModelViewSet):
    queryset = CustomUser.objects.all()

    def get_queryset(self):
        """
        Filtra los usuarios según el Estok activo del usuario autenticado.
        - Superusers ven TODOS los usuarios (solo para panel de administración).
        - El Estok se determina en este orden:
          1. Header X-Estok-Id o HTTP_X_ESTOK_ID (enviado por getAuthHeaders())
          2. Query param 'estok_id' (explícito desde el frontend)
          3. user.ultimo_estok_activo (sesión del backend)
        - Si no hay ningún contexto de Estok, devuelve queryset vacío (.none())
          para garantizar el aislamiento multi-tenant.
        """
        user = self.request.user
        # Determinar el Estok: QUERY PARAM tiene prioridad absoluta
        estok_id = self.request.query_params.get('estok_id')
        
        if not estok_id:
            estok_id = (
                self.request.headers.get('x-estok-id')
                or self.request.META.get('HTTP_X_ESTOK_ID')
            )
        
        if not estok_id and user.ultimo_estok_activo:
            estok_id = str(user.ultimo_estok_activo_id)
            
        # Si no hay contexto de Estok:
        # - Superusers ven todos los usuarios (solo para admin panel sin filtro)
        # - Usuarios normales ven vacio (aislamiento multi-tenant)
        if not estok_id:
            if user.is_superuser:
                return CustomUser.objects.all()
            return CustomUser.objects.none()
        miembros_ids = Membresia.objects.filter(
            estok_id=estok_id
        ).values_list('usuario_id', flat=True)
        
        return CustomUser.objects.filter(id__in=miembros_ids)


    def get_permissions(self):
        """
        Permisos dinámicos:
        - 'create' (registro público): AllowAny
        - 'me' (perfil propio): solo IsAuthenticated (sin HasRolePermission)
        - 'ping', 'online': solo IsAuthenticated (sin HasRolePermission)
        - El resto (list, retrieve, update, delete): IsAuthenticated + HasRolePermission
        """
        if self.action == 'create':
            return [permissions.AllowAny()]
        if self.action == 'recuperar_password':
            # Endpoint público de "Olvidó su contraseña": NO requiere
            # autenticación (el usuario olvidó su clave, no puede loguearse).
            return [permissions.AllowAny()]
        if self.action in ('me', 'perfil', 'ping', 'online', 'admin_delete_user', 'asignar_estok', 'remover_estok'):
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated(), HasRolePermission()]

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        return UserSerializer

    @action(detail=False, methods=['post'], url_path='recuperar-password')
    def recuperar_password(self, request):
        """
        [PÚBLICO - SIN autenticación]
        Flujo "Olvidó su contraseña": genera una clave temporal de 8
        caracteres, la aplica con set_password(), activa el flag
        `tiene_clave_temporal = True` y la envía por email al usuario.

        POST /api/usuarios/recuperar-password/
        Body (uno de los dos):
          { "email": "user@example.com" }
          { "username": "mi_usuario" }

        La lógica de negocio vive en inventario/services/password_recovery.py.
        Al loguearse con la clave temporal, el frontend detecta el flag y
        redirige de forma obligatoria a /perfil para definir una clave nueva.
        """
        try:
            user, _clave_temporal, enviado = recuperar_password_usuario(
                email=request.data.get('email'),
                username=request.data.get('username'),
            )
        except ValueError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Anti-enumeración: si la cuenta no existe, la respuesta es genérica.
        if user is None:
            return Response({
                'success': True,
                'mensaje': (
                    'Si el dato coincide con una cuenta registrada, '
                    'recibirás un correo con tu clave temporal.'
                ),
            })

        if not enviado:
            return Response(
                {'error': 'No se pudo enviar el correo. Intentá de nuevo más tarde.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response({
            'success': True,
            'mensaje': 'Se envió una clave temporal a tu correo electrónico.',
        })

    @action(detail=False, methods=['get'])
    def me(self, request):
        """Retorna el usuario autenticado actual con sus Estoks."""
        user = request.user
        serializer = UserSerializer(user)

        # Incluir TODAS las membresías del usuario: la lista COMPLETA de Estoks
        # donde el usuario tiene una membresía activa. El selector del Navbar
        # ("MIS ESTOKS") necesita mostrar TODOS los inquilinatos (p.ej. los
        # sumados por código de invitación o asignación de administración),
        # no solo el Estok activo. Estructura contract: estoks[] = {id, nombre, role, role_id}.
        membresias = Membresia.objects.filter(
            usuario=user,
        ).select_related('estok', 'role')

        estoks_data = [
            {
                "id": str(m.estok.id),
                "nombre": m.estok.nombre,
                "role": m.role.name if m.role else None,
                "role_id": str(m.role.id) if m.role else None,
            }
            for m in membresias
        ]

        data = serializer.data
        data['estoks'] = estoks_data
        data['ultimo_estok_activo_id'] = str(user.ultimo_estok_activo_id) if user.ultimo_estok_activo_id else None

        return Response(data)

    @action(detail=False, methods=['put'], url_path='perfil')
    def perfil(self, request):
        """
        Actualiza el perfil del usuario autenticado (SOLO sus propios datos).
        PUT /api/usuarios/perfil/

        Cuerpo (datos base, todos opcionales):
          { "username", "email", "first_name", "last_name" }

        Cuerpo (cambio de contraseña, requiere la actual):
          { "password_actual", "password_nueva" }

        No requiere permisos de superusuario: CUALQUIER usuario autenticado
        actualiza estrictamente su propio perfil. La contraseña se aplica con
        set_password() solo si la actual ingresada coincide.
        """
        user = request.user
        data = request.data or {}
        cambios = False

        # --- 1) Datos base ---
        for campo in ('username', 'email', 'first_name', 'last_name'):
            if campo in data:
                valor = str(data[campo]).strip()
                if not valor:
                    return Response(
                        {'error': f'El campo "{campo}" no puede quedar vacío.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                setattr(user, campo, valor)
                cambios = True

        # Validar unicidad de username/email (evita colisiones con otros usuarios)
        if cambios:
            try:
                user.validate_unique()
            except ValidationError as e:
                return Response(
                    {
                        'error': '; '.join(
                            f'{campo}: {", ".join(mensajes)}'
                            for campo, mensajes in e.message_dict.items()
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # --- 2) Cambio de contraseña (valida la actual antes de set_password) ---
        password_actual = data.get('password_actual')
        password_nueva = data.get('password_nueva')
        if password_actual or password_nueva:
            if not password_actual or not password_nueva:
                return Response(
                    {'error': 'Para cambiar la contraseña debés ingresar la actual y la nueva.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not user.check_password(password_actual):
                return Response(
                    {'error': 'La contraseña actual es incorrecta.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if len(str(password_nueva)) < 8:
                return Response(
                    {'error': 'La contraseña nueva debe tener al menos 8 caracteres.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            user.set_password(password_nueva)
            # Flujo "Olvidó su contraseña": el usuario entró con clave
            # temporal y acaba de definir una clave propia → se apaga el
            # flag para desbloquear el acceso al Dashboard general.
            user.tiene_clave_temporal = False
            cambios = True

        if not cambios:
            return Response(
                {'error': 'No se enviaron campos para actualizar.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.save()

        return Response({
            'success': True,
            'mensaje': 'Perfil actualizado correctamente.',
        })

    @action(detail=False, methods=['post'])
    def ping(self, request):
        """
        Heartbeat: actualiza ultima_actividad del usuario autenticado.
        POST /api/usuarios/ping/
        El frontend llama a esto cada ~30 segundos.
        """
        request.user.ultima_actividad = timezone.now()
        request.user.save(update_fields=['ultima_actividad'])
        return Response({'status': 'ok'})

    @action(detail=False, methods=['get'])
    def online(self, request):
        """
        Retorna los usuarios online (activos en los últimos ONLINE_TIMEOUT_MINUTES minutos).
        GET /api/usuarios/online/?estok_id=<uuid>

        REGLA:
        - Si se pasa estok_id como query param, filtra por ese Estok específico.
        - Si no se pasa estok_id, usa el ultimo_estok_activo del usuario.
        - ygumy44 (superuser) ve TODOS los usuarios online de la plataforma
          (a menos que se pase un estok_id específico).

        AUDITORÍA FORENSE:
        - Cada handshake captura metadata en RAM volátil (IP, User-Agent, timestamp).
        - El registro histórico solo es visible para ygumy44 vía /access-log/.
        """
        user = request.user

        # =====================================================================
        # CAPTURA DE METADATOS EN RAM VOLÁTIL (Access Log de Presencia)
        # =====================================================================
        ip_address = (
            request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip()
            or request.META.get('REMOTE_ADDR', '')
        )
        user_agent = request.META.get('HTTP_USER_AGENT', '')
        _add_access_log_entry(
            usuario_id=user.id,
            username=user.username,
            ip_address=ip_address,
            user_agent=user_agent,
        )

        cutoff = timezone.now() - timezone.timedelta(minutes=ONLINE_TIMEOUT_MINUTES)

        # Determinar el estok_id a usar: query param > ultimo_estok_activo
        estok_id = request.query_params.get('estok_id') or (str(user.ultimo_estok_activo_id) if user.ultimo_estok_activo_id else None)

        # REGLA DE PRIVACIDAD: ygumy44 ve todos los usuarios online (control técnico)
        # El resto de usuarios necesitan estok_id OBLIGATORIO
        if user.username != 'ygumy44' and not estok_id:
            return Response([])
        else:
            # Filtrar por miembros del Estok específico
            miembros_ids = Membresia.objects.filter(
                estok_id=estok_id
            ).values_list('usuario_id', flat=True)
            online_users = CustomUser.objects.filter(
                id__in=miembros_ids,
                ultima_actividad__gte=cutoff,
                is_active=True
            )

        # Construir lista de usuarios online, excluyendo al propio usuario
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

            # REGLA DE PRIVACIDAD: Solo SoledadMartinez ve "Yamza" para ygumy44
            if request.user.username == 'SoledadMartinez':
                remitente_str = f"{u.username} {u.first_name or ''} {u.last_name or ''}".lower()
                if u.username == 'ygumy44' or 'borghi' in remitente_str or 'ignacio' in remitente_str:
                    user_data['username'] = 'Yamza'
                    user_data['first_name'] = 'Yamza'
                    user_data['last_name'] = ''
                    user_data['display_name'] = 'Yamza'

            data.append(user_data)

        return Response(data)

    @action(detail=False, methods=['get'], url_path='online/access-log')
    def access_log(self, request):
        """
        [RESTRINGIDO - SOLO ygumy44]
        Retorna el Access Log de Presencia (últimos 50 handshakes al endpoint online).
        Almacenado exclusivamente en RAM volátil del proceso. Sin persistencia en disco/BD.

        CUALQUIER OTRO USUARIO recibe 404 Not Found (error ciego, sin indicios).
        """
        # RESTRICCIÓN DE VISIBILIDAD ABSOLUTA
        if request.user.username != 'ygumy44':
            return Response(
                {"detail": "Not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        with _ACCESS_LOG_LOCK:
            entries = list(reversed(list(_ACCESS_LOG.values())))

        return Response({
            "total": len(entries),
            "max_capacity": _ACCESS_LOG_MAX,
            "entries": entries,
        })

    @action(detail=True, methods=['delete'], url_path='admin-delete')
    def admin_delete_user(self, request, pk=None):
        """
        [RESTRINGIDO - SOLO ygumy44]
        Elimina físicamente a cualquier usuario del sistema.
        DELETE /api/usuarios/{id}/admin-delete/

        CUALQUIER OTRO USUARIO recibe 404 Not Found (error ciego, sin indicios).
        El usuario ygumy44 NO puede eliminarse a sí mismo.
        """
        # RESTRICCIÓN DE VISIBILIDAD ABSOLUTA
        if request.user.username != 'ygumy44':
            return Response(
                {"detail": "Not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            target_user = self.get_object()
        except Exception:
            return Response(
                {"detail": "Not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # No permitir que ygumy44 se elimine a sí mismo
        if target_user.id == request.user.id:
            return Response(
                {"error": "No puedes eliminarte a ti mismo."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        username = target_user.username
        user_id = str(target_user.id)

        # Eliminar físicamente al usuario (CASCADE eliminará membresías, etc.)
        target_user.delete()

        return Response({
            "success": True,
            "mensaje": f"Usuario '{username}' eliminado correctamente.",
            "usuario_id": user_id,
            "username": username,
        })

    @action(detail=True, methods=['post'], url_path='asignar-estok')
    def asignar_estok(self, request, pk=None):
        """
        [RESTRINGIDO - SOLO ygumy44]
        Asigna un usuario a un Estok con un rol específico.

        POST /api/usuarios/{id}/asignar-estok/
        Body: { "estok_id": "<uuid>", "rol": "Editor" | "<role_uuid>" }

        - `estok_id` es obligatorio.
        - `rol` es opcional (default 'Editor'); acepta el nombre del rol
          ('Editor', 'Admin', 'Visualizador') o su UUID. Se acepta también
          `role_id` como alias para no romper llamadas previas.
        - Usa Membresia.objects.get_or_create(): hermético e idempotente
          (no duplica filas ni pisa el rol de una membresía existente).
        - El usuario se localiza por su pk de la URL con una query directa
          (NO self.get_object()) para no chocar con el filtro multi-tenant
          de get_queryset, que excluye a los usuarios aún no miembros del
          Estok de contexto.
        """
        # BLINDAJE MÁSTER: SOLO el usuario 'ygumy44' puede ejecutar esto.
        if request.user.username != 'ygumy44':
            return Response(
                {"detail": "No autorizado."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Localizar el usuario por su pk (ID de la URL) sin el filtro
        # multi-tenant del queryset.
        try:
            user = CustomUser.objects.get(pk=pk)
        except CustomUser.DoesNotExist:
            return Response(
                {"detail": "Usuario no encontrado."},
                status=status.HTTP_404_NOT_FOUND,
            )

        estok_id = request.data.get('estok_id')
        if not estok_id:
            return Response(
                {"error": "estok_id es requerido."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            estok = Estok.objects.get(id=estok_id)
        except Estok.DoesNotExist:
            return Response(
                {"error": "El Estok especificado no existe."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Resolver rol: por nombre (default 'Editor') o por UUID. `role_id`
        # se acepta como alias de `rol` para compatibilidad con llamadas viejas.
        rol = request.data.get('rol') or request.data.get('role_id') or 'Editor'
        role = None
        if rol:
            role = (
                Role.objects.filter(name=rol).first()
                or Role.objects.filter(id=rol).first()
            )
            if role is None:
                return Response(
                    {"error": f"El Role '{rol}' no existe."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Hermético e idempotente: crea si no existe; si ya es miembro,
        # devuelve la membresía existente sin duplicar ni pisar su rol.
        membresia, created = Membresia.objects.get_or_create(
            usuario=user,
            estok=estok,
            defaults={'role': role},
        )

        return Response({
            "success": True,
            "creada": created,
            "mensaje": (
                f"Usuario '{user.username}' asignado a '{estok.nombre}' correctamente."
                if created
                else f"El usuario '{user.username}' ya era miembro de '{estok.nombre}'."
            ),
            "membresia": {
                "id": str(membresia.id),
                "estok_id": str(estok.id),
                "estok_nombre": estok.nombre,
                "role": membresia.role.name if membresia.role else None,
                "role_id": str(membresia.role.id) if membresia.role else None,
                "joined_at": membresia.joined_at.isoformat() if membresia.joined_at else None,
            },
        })

    @action(detail=True, methods=['delete'], url_path='remover-estok')
    def remover_estok(self, request, pk=None):
        """
        [RESTRINGIDO - SOLO ygumy44]
        Quita un usuario de un Estok (elimina la membresía).
        DELETE /api/usuarios/{id}/remover-estok/?estok_id=<uuid>

        CUALQUIER OTRO USUARIO recibe 404 Not Found.
        El usuario ygumy44 NO puede quitarse a sí mismo.
        """
        if request.user.username != 'ygumy44':
            return Response(
                {"detail": "Not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            user = self.get_object()
        except Exception:
            return Response(
                {"detail": "Not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # No permitir que ygumy44 se quite a sí mismo
        if user.id == request.user.id:
            return Response(
                {"error": "No puedes quitarte a ti mismo de un Estok."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        estok_id = request.query_params.get('estok_id') or request.data.get('estok_id')

        if not estok_id:
            return Response(
                {"error": "estok_id es requerido."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        deleted_count, _ = Membresia.objects.filter(
            usuario=user,
            estok_id=estok_id,
        ).delete()

        if deleted_count == 0:
            return Response(
                {"error": "El usuario no es miembro de ese Estok."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({
            "success": True,
            "mensaje": f"Usuario '{user.username}' removido del Estok correctamente.",
        })