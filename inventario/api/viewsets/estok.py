"""
ViewSet para Estok (cuentas multi-usuario) y Membresías.
"""

import logging

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

from ...models import Estok, Membresia, CustomUser
from ..serializers import EstokSerializer, EstokCreateSerializer, MembresiaSerializer
from .base import HasRolePermission

logger = logging.getLogger(__name__)


class EstokViewSet(viewsets.ModelViewSet):
    """
    ViewSet para gestionar Estoks (cuentas multi-usuario).
    - list/retrieve: solo los Estoks donde el usuario es miembro
    - create: crea un Estok y asigna al creador como admin
    - update/destroy: solo admin del Estok
    """
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_serializer_class(self):
        if self.action == 'create':
            return EstokCreateSerializer
        return EstokSerializer

    def get_queryset(self):
        """Filtra para mostrar solo los Estoks donde el usuario es miembro."""
        user = self.request.user
        if user.is_superuser:
            return Estok.objects.all()
        return Estok.objects.filter(miembros__usuario=user)

    def perform_create(self, serializer):
        """El create ya está manejado por EstokCreateSerializer."""
        serializer.save()

    @action(detail=True, methods=['post'])
    def invitar(self, request, pk=None):
        """
        Invita a un usuario a unirse al Estok.
        Solo el admin del Estok puede invitar.
        """
        estok = self.get_object()
        username = request.data.get('username')
        email = request.data.get('email')
        rol = request.data.get('rol', 'visualizador')

        if not username and not email:
            return Response(
                {"error": "Debes proporcionar 'username' o 'email' del usuario a invitar"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Buscar usuario
        user = None
        if username:
            try:
                user = CustomUser.objects.get(username=username)
            except CustomUser.DoesNotExist:
                return Response(
                    {"error": f"Usuario '{username}' no encontrado"},
                    status=status.HTTP_404_NOT_FOUND
                )
        elif email:
            try:
                user = CustomUser.objects.get(email=email)
            except CustomUser.DoesNotExist:
                return Response(
                    {"error": f"Usuario con email '{email}' no encontrado"},
                    status=status.HTTP_404_NOT_FOUND
                )

        # Verificar que no sea ya miembro
        if Membresia.objects.filter(estok=estok, usuario=user).exists():
            return Response(
                {"error": f"El usuario '{user.username}' ya es miembro de este Estok"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Crear membresía
        membresia = Membresia.objects.create(
            estok=estok,
            usuario=user,
            rol_en_estok=rol,
            invitacion_aceptada=True,  # Auto-aceptar por ahora
        )

        serializer = MembresiaSerializer(membresia)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def remover_miembro(self, request, pk=None):
        """Remueve un miembro del Estok."""
        estok = self.get_object()
        usuario_id = request.data.get('usuario_id')

        if not usuario_id:
            return Response(
                {"error": "Debes proporcionar 'usuario_id'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            membresia = Membresia.objects.get(estok=estok, usuario_id=usuario_id)
            membresia.delete()
            return Response({"mensaje": "Miembro removido correctamente"})
        except Membresia.DoesNotExist:
            return Response(
                {"error": "El usuario no es miembro de este Estok"},
                status=status.HTTP_404_NOT_FOUND
            )

    @action(detail=True, methods=['post'])
    def cambiar_rol(self, request, pk=None):
        """Cambia el rol de un miembro del Estok."""
        estok = self.get_object()
        usuario_id = request.data.get('usuario_id')
        nuevo_rol = request.data.get('rol')

        if not usuario_id or not nuevo_rol:
            return Response(
                {"error": "Debes proporcionar 'usuario_id' y 'rol'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        roles_validos = [r[0] for r in Membresia.ROLES_EN_ESTOK]
        if nuevo_rol not in roles_validos:
            return Response(
                {"error": f"Rol inválido. Válidos: {', '.join(roles_validos)}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            membresia = Membresia.objects.get(estok=estok, usuario_id=usuario_id)
            membresia.rol_en_estok = nuevo_rol
            membresia.save()
            serializer = MembresiaSerializer(membresia)
            return Response(serializer.data)
        except Membresia.DoesNotExist:
            return Response(
                {"error": "El usuario no es miembro de este Estok"},
                status=status.HTTP_404_NOT_FOUND
            )

    @action(detail=False, methods=['get'])
    def mi_estok(self, request):
        """
        Retorna el primer Estok del usuario (para compatibilidad con
        la UI actual que asume un solo Estok por usuario).
        """
        user = request.user
        membresia = Membresia.objects.filter(usuario=user).first()
        if not membresia:
            return Response(
                {"error": "No tienes ningún Estok. Crea uno primero."},
                status=status.HTTP_404_NOT_FOUND
            )
        serializer = EstokSerializer(membresia.estok)
        return Response(serializer.data)
