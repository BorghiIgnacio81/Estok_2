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

import logging
import secrets
import string

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

logger = logging.getLogger(__name__)

from ...models import CustomUser, Estok
from ...services.email_service import (
    TIPO_BIENVENIDA,
    TIPOS_SOPORTADOS,
    enviar_email_usuario,
)
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


def _generar_clave_temporal(longitud: int = 8) -> str:
    """
    Genera una contraseña temporal segura (criptográficamente aleatoria).

    Garantiza al menos una mayúscula, una minúscula y un dígito, y mezcla el
    resultado con Fisher-Yates sobre SystemRandom (fuente criptográfica).
    """
    if longitud < 4:
        longitud = 8
    alfabeto = string.ascii_letters + string.digits
    caracteres = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
    ]
    caracteres += [secrets.choice(alfabeto) for _ in range(longitud - 3)]

    # Mezcla Fisher-Yates con fuente criptográfica (evita patrón de prefijo)
    rng = secrets.SystemRandom()
    for i in range(len(caracteres) - 1, 0, -1):
        j = rng.randrange(i + 1)
        caracteres[i], caracteres[j] = caracteres[j], caracteres[i]
    return ''.join(caracteres)


class SuperAdminUserViewSet(viewsets.ModelViewSet):
    """
    CRUD global de CustomUser (Modo Dios).

    - GET    /api/admin/usuarios/                → lista TODOS los usuarios
    - POST   /api/admin/usuarios/                → crea usuario (con password)
    - GET    /api/admin/usuarios/{id}/           → detalle
    - PUT    /api/admin/usuarios/{id}/           → edición completa
    - PATCH  /api/admin/usuarios/{id}/           → edición parcial
    - DELETE /api/admin/usuarios/{id}/           → borrado físico (instance.delete())
    - POST   /api/admin/usuarios/{id}/reactivar/ → reactiva el usuario

    DELETE es un borrado físico completo (instance.delete()): elimina el
    registro de CustomUser. Las relaciones con CASCADE se borran en cascada
    (membresías, token de MercadoLibre) y las referencias con SET_NULL
    (objetos, chat, notificaciones) quedan con valor nulo.
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
        """Elimina físicamente (borrado real en BD) a un usuario. Protege a ygumy44."""
        instance = self.get_object()
        if instance == request.user:
            raise PermissionDenied("No puedes eliminar tu propio usuario maestro.")
        username = instance.username
        instance.delete()
        return Response(
            {'detail': f'Usuario "{username}" eliminado correctamente.'},
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

    @action(detail=True, methods=['post'])
    def enviar_mail(self, request, pk=None):
        """
        Envía un correo transaccional al usuario (solo ygumy44).

        Body: {"tipo": "bienvenida" | "actualizacion" | "facturacion" | "reseteo"}

        Reutiliza el MISMO servicio de bienvenida del registro público
        (inventario/services/email_service.py).

        - tipo='bienvenida': solo se ejecuta si es el PRIMER envío (el usuario
          nunca inició sesión: last_login es nulo). Si ya recibió la bienvenida,
          el endpoint responde sin bloquear (HTTP 200) y sugiere otro tipo.
        - Otros tipos: siempre se procesan (comunicaciones futuras: actualización,
          facturación o reseteo de clave).
        """
        user = self.get_object()
        tipo = str(request.data.get('tipo') or TIPO_BIENVENIDA).strip().lower()

        if tipo not in TIPOS_SOPORTADOS:
            return Response(
                {
                    'enviado': False,
                    'detail': (
                        f'Tipo de correo "{tipo}" no soportado. '
                        f'Opciones: {", ".join(TIPOS_SOPORTADOS)}.'
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        primer_envio = user.last_login is None

        if tipo == TIPO_BIENVENIDA and not primer_envio:
            # Ya recibió la bienvenida: no se reenvía, pero el endpoint sigue
            # respondiendo para comunicaciones alternativas (no bloquear).
            return Response(
                {
                    'enviado': False,
                    'detail': (
                        f'El usuario "{user.username}" ya recibió su correo de '
                        'bienvenida. Usá tipo="actualizacion" para comunicaciones '
                        'futuras.'
                    ),
                },
                status=status.HTTP_200_OK,
            )

        # Primer envío de bienvenida: se genera e inyecta una contraseña
        # temporal segura de 8 caracteres que viajará en el cuerpo del correo.
        clave_temporal = None
        if tipo == TIPO_BIENVENIDA:
            clave_temporal = _generar_clave_temporal()
            user.set_password(clave_temporal)
            user.save(update_fields=['password'])
            logger.info(
                'Clave temporal generada e inyectada para %s (primer envío).',
                user.username,
            )

        enviado = enviar_email_usuario(user, tipo=tipo, password=clave_temporal)
        if not enviado:
            return Response(
                {
                    'enviado': False,
                    'detail': (
                        f'No se pudo enviar el correo de tipo "{tipo}" a '
                        f'{user.email or "(sin email)"}. '
                        'Verificá la configuración SMTP.'
                    ),
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response(
            {
                'enviado': True,
                'detail': f'Correo de tipo "{tipo}" enviado a {user.email}.',
            },
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
