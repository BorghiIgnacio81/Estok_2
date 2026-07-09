"""
ViewSets para usuarios y roles.
"""

from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from ...models import Role, CustomUser, Membresia
from ..serializers import RoleSerializer, UserSerializer, UserCreateSerializer
from .base import HasRolePermission


# Tiempo máximo desde última actividad para considerar a un usuario "online"
ONLINE_TIMEOUT_MINUTES = 2


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
        if self.action in ('me', 'ping', 'online'):
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
        membresias = Membresia.objects.filter(usuario=user).select_related('estok', 'role')
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
        """
        user = request.user
        cutoff = timezone.now() - timezone.timedelta(minutes=ONLINE_TIMEOUT_MINUTES)

        # Determinar el estok_id a usar: query param > ultimo_estok_activo
        estok_id = request.query_params.get('estok_id') or (str(user.ultimo_estok_activo_id) if user.ultimo_estok_activo_id else None)

        if not estok_id:
            # Sin Estok definido: devolver vacío (excepto superuser)
            if user.is_superuser:
                online_users = CustomUser.objects.filter(
                    ultima_actividad__gte=cutoff,
                    is_active=True
                )
            else:
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

        data = [
            {
                "id": str(u.id),
                "username": u.username,
                "display_name": u.get_full_name() or u.username,
                "ultima_actividad": u.ultima_actividad.isoformat() if u.ultima_actividad else None,
            }
            for u in online_users
        ]
        return Response(data)

