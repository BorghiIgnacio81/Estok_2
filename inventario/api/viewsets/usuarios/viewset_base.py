"""
ViewSets base de usuarios y roles.

Agrupa los controladores de la capa pública y del propio usuario:
  - RoleViewSet:         CRUD de roles (protegido por HasRolePermission).
  - UsuarioViewSetBase:  registro, "olvidó su contraseña", perfil propio,
                         heartbeat (ping), presencia online y access log.

La gestión de MIEMBROS del Estok activo (acciones multi-tenant) vive en
`viewset_tenant.UsuarioTenantMixin` y se compone con este base en el
`__init__` del paquete. Así `/api/usuarios/` conserva TODAS sus acciones sin
cambios en el enrutamiento (`inventario/api/urls.py` no se toca).

Toda la lógica de negocio delega en
`inventario/api/services/usuario_auth_service.py`: estos controladores solo
traducen a HTTP. Las fallas de validación llegan como `ValidationError` y se
renderizan con su cuerpo original ({"error": ...}, HTTP 400) en lugar de caer
en un 500.
"""

from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.contrib.auth import update_session_auth_hash
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from ....models import Role, CustomUser, Membresia
from ...serializers import RoleSerializer, UserSerializer, UserCreateSerializer
from ..base import HasRolePermission
from ...services import usuario_auth_service


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]


@method_decorator(csrf_exempt, name='dispatch')
class UsuarioViewSetBase(viewsets.ModelViewSet):
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
        # Determinar el Estok: QUERY PARAM tiene prioridad absoluta
        estok_id = self.request.query_params.get('estok_id')

        if not estok_id:
            estok_id = (
                self.request.headers.get('x-estok-id')
                or self.request.META.get('HTTP_X_ESTOK_ID')
            )

        if not estok_id and user.ultimo_estok_activo:
            estok_id = str(user.ultimo_estok_activo_id)

        # Si no hay contexto de Estok:
        # - Superusers ven todos los usuarios (solo para admin panel sin filtro)
        # - Usuarios normales ven vacio (aislamiento multi-tenant)
        if not estok_id:
            if user.is_superuser:
                return CustomUser.objects.all()
            return CustomUser.objects.none()
        miembros_ids = Membresia.objects.filter(
            estok_id=estok_id
        ).values_list('usuario_id', flat=True)

        return CustomUser.objects.filter(id__in=miembros_ids)

    def get_permissions(self):
        """
        Permisos dinámicos:
        - 'create' (registro público) y 'recuperar_password' (olvidó su clave):
          AllowAny.
        - 'me', 'perfil', 'ping', 'online', 'admin_delete_user',
          'asignar_estok', 'remover_estok': solo IsAuthenticated.
        - El resto (list, retrieve, update, delete): IsAuthenticated +
          HasRolePermission.
        """
        if self.action == 'create':
            return [permissions.AllowAny()]
        if self.action == 'recuperar_password':
            return [permissions.AllowAny()]
        if self.action in ('me', 'perfil', 'ping', 'online', 'admin_delete_user', 'asignar_estok', 'remover_estok'):
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated(), HasRolePermission()]

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        return UserSerializer

    @action(detail=False, methods=['post'], url_path='recuperar-password')
    def recuperar_password(self, request):
        """
        [PÚBLICO - SIN autenticación] Flujo "Olvidó su contraseña".

        POST /api/usuarios/recuperar-password/
        Body (AMBOS obligatorios): { "username", "email" }

        La búsqueda es estricta por el PAR username + email (varios usuarios
        pueden compartir correo; el username desambigua). La lógica de negocio
        vive en inventario/api/services/usuario_auth_service.py y en
        inventario/services/password_recovery.py.

        Respuestas: 400 (datos/cuenta), 404 (par inexistente), 502 (SMTP), 200.
        """
        user, enviado = usuario_auth_service.recuperar_password(
            email=request.data.get('email'),
            username=request.data.get('username'),
        )

        if user is None:
            return Response(
                {'error': 'No se encontró ningún usuario con esos datos combinados'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not enviado:
            return Response(
                {'error': 'No se pudo enviar el correo. Intentá de nuevo más tarde.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response({
            'success': True,
            'mensaje': 'Se envió una clave temporal a tu correo electrónico.',
        })

    @action(detail=False, methods=['get'])
    def me(self, request):
        """
        Retorna el usuario autenticado actual con la lista COMPLETA de sus
        Estoks (membresías activas) y su último Estok activo.
        """
        serializer = UserSerializer(request.user)
        data = serializer.data
        data['estoks'] = usuario_auth_service.membresias_del_usuario(request.user)
        data['ultimo_estok_activo_id'] = usuario_auth_service.id_estok_activo(request.user)
        return Response(data)

    @action(detail=False, methods=['put'], url_path='perfil')
    def perfil(self, request):
        """
        Actualiza el perfil del usuario autenticado (SOLO sus propios datos).
        PUT /api/usuarios/perfil/

        Cuerpo (datos base, todos opcionales):
          { "username", "email", "first_name", "last_name" }
        Cuerpo (cambio de contraseña, requiere la actual):
          { "password_actual", "password_nueva" }

        La validación vive en el servicio (ValidationError → HTTP 400 con el
        cuerpo {"error": ...}). Si la clave cambió, se renueva el hash de la
        sesión actual con update_session_auth_hash().
        """
        password_cambiada = usuario_auth_service.actualizar_perfil(
            request.user,
            request.data,
        )

        if password_cambiada:
            update_session_auth_hash(request, request.user)

        return Response({
            'success': True,
            'mensaje': 'Perfil actualizado correctamente.',
        })

    @action(detail=False, methods=['post'])
    def ping(self, request):
        """
        Heartbeat: actualiza ultima_actividad del usuario autenticado.
        POST /api/usuarios/ping/ (el frontend lo llama cada ~30 segundos).
        """
        usuario_auth_service.registrar_actividad(request.user)
        return Response({'status': 'ok'})

    @action(detail=False, methods=['get'])
    def online(self, request):
        """
        Retorna los usuarios online (activos en los últimos
        ONLINE_TIMEOUT_MINUTES minutos). GET /api/usuarios/online/?estok_id=<uuid>

        - Con estok_id filtra por ese Estok; sin él usa el ultimo_estok_activo.
        - 'ygumy44' (superuser) ve TODOS los usuarios online de la plataforma.
        - AUDITORÍA: cada handshake captura metadata en RAM volátil (IP,
          User-Agent, timestamp); solo 'ygumy44' la ve vía /access-log/.
        """
        user = request.user

        # Captura de metadatos en RAM volátil (Access Log de Presencia)
        ip_address, user_agent = usuario_auth_service.capturar_metadata(request)
        usuario_auth_service.registrar_entrada_access_log(
            usuario_id=user.id,
            username=user.username,
            ip_address=ip_address,
            user_agent=user_agent,
        )

        # Estok a usar: query param > ultimo_estok_activo
        estok_id = (
            request.query_params.get('estok_id')
            or usuario_auth_service.id_estok_activo(user)
        )

        return Response(usuario_auth_service.usuarios_online(user, estok_id))

    @action(detail=False, methods=['get'], url_path='online/access-log')
    def access_log(self, request):
        """
        [RESTRINGIDO - SOLO ygumy44]
        Retorna el Access Log de Presencia (últimos 50 handshakes al endpoint
        online). Almacenado exclusivamente en RAM volátil del proceso, sin
        persistencia en disco/BD. CUALQUIER OTRO USUARIO recibe 404 Not Found
        (error ciego, sin indicios).
        """
        if request.user.username != 'ygumy44':
            return Response(
                {"detail": "Not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(usuario_auth_service.snapshot_access_log())
