"""
Acciones de gestión de MIEMBROS del Estok activo (multi-tenant).

Todas operan bajo validación estricta del header X-Estok-Id / `estok_id` y del
blindaje máster del usuario 'ygumy44'. Se exponen como un mixin para
componerse con `UsuarioViewSetBase` en el `__init__` del paquete: DRF recolecta
los `@action` heredados, de modo que `/api/usuarios/` conserva TODAS sus rutas
sin cambios en `inventario/api/urls.py`.
"""

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from ....models import CustomUser, Membresia, Estok, Role


class UsuarioTenantMixin:
    """Acciones de membresía/asignación de usuarios a Estoks (solo 'ygumy44')."""

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
        - Usa get_or_create(): hermético e idempotente (no duplica filas ni pisa
          el rol de una membresía existente).
        - El usuario se localiza por su pk de la URL con una query directa (NO
          self.get_object()) para no chocar con el filtro multi-tenant de
          get_queryset, que excluye a los usuarios aún no miembros del Estok.
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

        # Resolver rol: por nombre (default 'Editor') o por UUID. `role_id` se
        # acepta como alias de `rol` para compatibilidad con llamadas viejas.
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

        # Hermético e idempotente: crea si no existe; si ya es miembro, devuelve
        # la membresía existente sin duplicar ni pisar su rol.
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
