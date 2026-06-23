"""
ViewSets para usuarios y roles.
"""

from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response

from ...models import Role, CustomUser, Membresia
from ..serializers import RoleSerializer, UserSerializer, UserCreateSerializer
from .base import HasRolePermission


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]


class UserViewSet(viewsets.ModelViewSet):
    queryset = CustomUser.objects.all()

    def get_permissions(self):
        """
        Permisos dinámicos:
        - 'create' (registro público): AllowAny
        - 'me' (perfil propio): solo IsAuthenticated (sin HasRolePermission)
        - El resto (list, retrieve, update, delete): IsAuthenticated + HasRolePermission
        """
        if self.action == 'create':
            return [permissions.AllowAny()]
        if self.action == 'me':
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
    def cambiar_estok_activo(self, request):
        """
        Cambia el Estok activo del usuario autenticado.
        Recibe: { "estok_id": "uuid" }
        Verifica que el usuario tenga membresía en ese Estok.
        """
        user = request.user
        estok_id = request.data.get('estok_id')

        if not estok_id:
            return Response(
                {"error": "estok_id es requerido"},
                status=400,
            )

        # Verificar que el usuario tenga membresía en ese Estok
        membresia = Membresia.objects.filter(
            usuario=user,
            estok_id=estok_id,
        ).select_related('estok', 'role').first()

        if not membresia:
            return Response(
                {"error": "No tienes membresía en este Estok"},
                status=403,
            )

        # Actualizar el campo persistente en el usuario
        user.ultimo_estok_activo = membresia.estok
        user.save(update_fields=['ultimo_estok_activo'])

        return Response({
            "estok_id": str(membresia.estok.id),
            "nombre": membresia.estok.nombre,
            "role": membresia.role.name if membresia.role else None,
            "role_id": str(membresia.role.id) if membresia.role else None,
        })
