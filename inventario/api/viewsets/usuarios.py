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
        
        # Superusers ven todos los usuarios (admin panel)
        if user.is_superuser:
            return CustomUser.objects.all()
            
        # Determinar el Estok: QUERY PARAM tiene prioridad absoluta
        estok_id = self.request.query_params.get('estok_id')
        
        if not estok_id:
            estok_id = (
                self.request.headers.get('x-estok-id')
                or self.request.META.get('HTTP_X_ESTOK_ID')
            )
        
        if not estok_id and user.ultimo_estok_activo:
            estok_id = str(user.ultimo_estok_activo_id)
            
        # Si no hay contexto de Estok, devolver vacío (aislamiento multi-tenant)
        if not estok_id:
            return CustomUser.objects.none()
            
        # Filtrar por miembros de ese Estok
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
        if self.action in ('me', 'ping', 'online', 'admin_delete_user', 'asignar_estok', 'remover_estok'):
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated(), HasRolePermission()]

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        return UserSerializer

    @action(detail=False, methods=['get'])
    def me(self, request):
        """Retorna el usuario autenticado actual con sus Estoks."""
        user = request.user
        serializer = UserSerializer(user)

        # Incluir datos de Estok activo y membresías
        # SOLO membresías con privacidad 'compartido' (las 'privado' son internas/ocultas)
        membresias = Membresia.objects.filter(
            usuario=user,
            privacidad='compartido'
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
        Body: { "estok_id": "<uuid>", "role_id": "<uuid>" }

        CUALQUIER OTRO USUARIO recibe 404 Not Found.
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

        estok_id = request.data.get('estok_id')
        role_id = request.data.get('role_id')

        if not estok_id:
            return Response(
                {"error": "estok_id es requerido."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Verificar que el Estok existe
        try:
            estok = Estok.objects.get(id=estok_id)
        except Estok.DoesNotExist:
            return Response(
                {"error": "El Estok especificado no existe."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Verificar que el Role existe (si se especificó)
        role = None
        if role_id:
            try:
                role = Role.objects.get(id=role_id)
            except Role.DoesNotExist:
                return Response(
                    {"error": "El Role especificado no existe."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Verificar si ya es miembro
        if Membresia.objects.filter(usuario=user, estok_id=estok_id).exists():
            return Response(
                {"error": "El usuario ya es miembro de este Estok."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Crear membresía
        membresia = Membresia.objects.create(
            usuario=user,
            estok=estok,
            role=role,
        )

        return Response({
            "success": True,
            "mensaje": f"Usuario '{user.username}' asignado a '{estok.nombre}' correctamente.",
            "membresia": {
                "id": str(membresia.id),
                "estok_id": str(estok_id),
                "estok_nombre": estok.nombre,
                "role": role.name if role else None,
                "role_id": str(role_id) if role_id else None,
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