"""
ViewSets para usuarios y roles.
"""

import threading
from collections import OrderedDict
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from ...models import Role, CustomUser, Membresia
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
        - Si el usuario tiene un Estok activo (ultimo_estok_activo), solo devuelve
          los usuarios que son miembros de ese mismo Estok.
        - Si no tiene Estok activo, devuelve todos los usuarios (comportamiento legacy).
        - Incluso superusers/staff respetan el filtro del Estok activo, para que
          en los combobox de dueño/beneficiario solo aparezcan los miembros del Estok.
        """
        user = self.request.user
        # Si tiene Estok activo, filtrar por miembros de ese Estok
        if user.ultimo_estok_activo:
            miembros_ids = Membresia.objects.filter(
                estok=user.ultimo_estok_activo
            ).values_list('usuario_id', flat=True)
            return CustomUser.objects.filter(id__in=miembros_ids)
        # Fallback: todos los usuarios
        return CustomUser.objects.all()

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
        if self.action in ('me', 'ping', 'online', 'admin_delete_user'):
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

