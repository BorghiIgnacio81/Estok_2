"""
Super Admin (Modo Dios) - CRUD global de auditoría.

Endpoints protegidos exclusivos del usuario 'ygumy44':
- CRUD completo e independiente de CustomUser (/api/admin/usuarios/).
- CRUD de Estok, inquilinos (/api/admin/estoks/).

Cualquier otra persona (autenticada o no) recibe HTTP 403 Forbidden de
inmediato vía IsYgumyMaster. No hay cruce de datos de inquilinos fuera de
esta vista de auditoría global: los queries NO filtran por Estok ni por
membresías del usuario autenticado.
"""

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from ...models import CustomUser, Estok
from ..serializers import (
    SuperAdminUserSerializer,
    SuperAdminUserCreateSerializer,
    SuperAdminEstokSerializer,
)


class IsYgumyMaster(permissions.BasePermission):
    """
    Permiso estricto: SOLO el usuario con username EXACTAMENTE 'ygumy44'.
    Cualquier otra persona (logueada o no) recibe HTTP 403 Forbidden al
    instante. Se lanza PermissionDenied directamente para garantizar el 403
    incluso para peticiones anónimas.
    """

    message = 'Acceso denegado. No tienes permisos de administración global.'

    def has_permission(self, request, view):
        username = getattr(request.user, 'username', None)
        if username != 'ygumy44':
            raise PermissionDenied(detail=self.message)
        return True


class SuperAdminUserViewSet(viewsets.ModelViewSet):
    """
    CRUD global de CustomUser (Modo Dios).

    - GET    /api/admin/usuarios/                → lista TODOS los usuarios
    - POST   /api/admin/usuarios/                → crea usuario (con password)
    - GET    /api/admin/usuarios/{id}/           → detalle
    - PUT    /api/admin/usuarios/{id}/           → edición completa
    - PATCH  /api/admin/usuarios/{id}/           → edición parcial
    - DELETE /api/admin/usuarios/{id}/           → DESACTIVA (is_active=False)
    - POST   /api/admin/usuarios/{id}/reactivar/ → reactiva el usuario

    DELETE es una desactivación lógica para preservar la integridad
    referencial (objetos, membresías e historial asociados al usuario).
    """

    permission_classes = [IsYgumyMaster]
    http_method_names = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        return CustomUser.objects.all().order_by('-date_joined')

    def get_serializer_class(self):
        if self.action == 'create':
            return SuperAdminUserCreateSerializer
        return SuperAdminUserSerializer

    def destroy(self, request, pk=None):
        """Desactiva un usuario (borrado lógico). Protege a ygumy44."""
        user = self.get_object()
        if user.id == request.user.id:
            return Response(
                {'detail': 'No puedes desactivar tu propia cuenta de administración.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.is_active = False
        user.save(update_fields=['is_active'])
        return Response(
            {'detail': f'Usuario "{user.username}" desactivado correctamente.'},
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=['post'])
    def reactivar(self, request, pk=None):
        """Reactivar un usuario previamente desactivado."""
        user = self.get_object()
        user.is_active = True
        user.save(update_fields=['is_active'])
        return Response(
            {'detail': f'Usuario "{user.username}" reactivado correctamente.'},
            status=status.HTTP_200_OK,
        )


class SuperAdminEstokViewSet(viewsets.ModelViewSet):
    """
    CRUD global de Estok (inquilinos) - Modo Dios.

    - GET    /api/admin/estoks/        → lista TODOS los Estoks del sistema
    - POST   /api/admin/estoks/        → crea inquilino
    - GET    /api/admin/estoks/{id}/   → detalle
    - PUT    /api/admin/estoks/{id}/   → edición completa
    - PATCH  /api/admin/estoks/{id}/   → edición parcial
    - DELETE /api/admin/estoks/{id}/   → borrado físico (cascade)

    A diferencia de los usuarios, el borrado de un inquilino es físico
    (cascada de Objeto, Membresia, CodigoInvitacion, Ubicacion, etc.).
    """

    permission_classes = [IsYgumyMaster]
    queryset = Estok.objects.all().order_by('nombre')
    serializer_class = SuperAdminEstokSerializer
