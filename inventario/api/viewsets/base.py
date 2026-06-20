"""
Permisos y mixins base compartidos entre todos los ViewSets.
"""

from rest_framework import permissions


class HasRolePermission(permissions.BasePermission):
    """
    Permiso basado en el rol del usuario.
    Verifica los campos booleanos del Role asociado.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user.is_authenticated:
            return False
        if user.is_superuser:
            return True

        role = getattr(user, 'role', None)
        if not role:
            return False

        # Mapear acciones HTTP a permisos
        action_map = {
            'list': 'can_read',
            'retrieve': 'can_read',
            'create': 'can_write',
            'update': 'can_edit',
            'partial_update': 'can_edit',
            'destroy': 'can_delete',
        }

        action = getattr(view, 'action', None)
        if action in action_map:
            return getattr(role, action_map[action], False)

        return False
