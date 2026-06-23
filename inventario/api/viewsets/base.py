"""
Permisos y mixins base compartidos entre todos los ViewSets.
"""

from rest_framework import permissions
from ...models import Membresia


class HasRolePermission(permissions.BasePermission):
    """
    Permiso basado en el rol del usuario DENTRO de un Estok.
    El estok_id se obtiene del header X-Estok-Id o query_params.
    Resuelve el rol vía Membresia (usuario + estok), NO vía user.role directo.
    """

    def _get_estok_id(self, request):
        """Obtiene el estok_id del header X-Estok-Id o query param."""
        estok_id = request.headers.get('X-Estok-Id')
        if not estok_id:
            estok_id = request.query_params.get('estok_id')
        return estok_id

    def _get_membresia(self, user, estok_id):
        """Obtiene la Membresia del usuario en el Estok, o None."""
        if not estok_id:
            return None
        try:
            return Membresia.objects.filter(
                usuario=user,
                estok_id=estok_id
            ).select_related('role').first()
        except Exception:
            return None

    def has_permission(self, request, view):
        user = request.user
        if not user.is_authenticated:
            return False

        estok_id = self._get_estok_id(request)
        membresia = self._get_membresia(user, estok_id)

        if not membresia or not membresia.role:
            return False

        role = membresia.role

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
        permiso_requerido = action_map.get(action, 'can_read')  # default: can_read para cualquier action custom
        return getattr(role, permiso_requerido, False)


class EsAdminDelEstok(permissions.BasePermission):
    """
    Permiso: True solo si el usuario tiene Membresia con role.name='Admin'
    en el estok_id del header X-Estok-Id.
    Se usa para crear/editar/borrar CodigoInvitacion.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user.is_authenticated:
            return False

        estok_id = request.headers.get('X-Estok-Id') or request.query_params.get('estok_id')
        if not estok_id:
            return False

        try:
            membresia = Membresia.objects.filter(
                usuario=user,
                estok_id=estok_id
            ).select_related('role').first()

            if not membresia or not membresia.role:
                return False

            return membresia.role.name == 'Admin'
        except Exception:
            return False
