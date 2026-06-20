"""
ViewSets para usuarios y roles.
"""

from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response

from ...models import Role, CustomUser
from ..serializers import RoleSerializer, UserSerializer, UserCreateSerializer
from .base import HasRolePermission


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]


class UserViewSet(viewsets.ModelViewSet):
    queryset = CustomUser.objects.all()
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        return UserSerializer

    @action(detail=False, methods=['get'])
    def me(self, request):
        """Retorna el usuario autenticado actual."""
        serializer = UserSerializer(request.user)
        return Response(serializer.data)
