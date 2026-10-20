"""
Permisos y mixins base compartidos entre todos los ViewSets.
"""

from rest_framework import permissions
from ...models import Membresia


class HasRolePermission(permissions.BasePermission):
    """
    Permiso basado en el rol del usuario DENTRO de un Estok.
    El estok_id se obtiene del header X-Estok-Id, query_params, o request body.
    Resuelve el rol via Membresia (usuario + estok), NO via user.role directo.

    Los superusers (is_superuser=True) tienen acceso total a todo,
    sin necesidad de membresia. Esto permite al administrador del sistema
    entrar a cualquier Estok para resolver errores.
    """

    def _get_estok_id(self, request):
        """Obtiene el estok_id del header X-Estok-Id, query param, o request body."""
        estok_id = request.headers.get('X-Estok-Id')
        if not estok_id:
            estok_id = request.query_params.get('estok_id')
        if not estok_id:
            # `multipart/form-data` entrega un QueryDict (no un `dict`): usar
            # `hasattr(..., 'get')` permite leer `estok_id`/`estok` también en
            # las subidas de fotos (subir_foto, contenedores con `foto`).
            datos = getattr(request, 'data', None)
            if datos is not None and hasattr(datos, 'get'):
                try:
                    estok_id = datos.get('estok_id') or datos.get('estok')
                except Exception:
                    estok_id = None
        return estok_id or None

    def _get_membresia(self, user, estok_id):
        """
        Obtiene la Membresia del usuario en el Estok.

        Si la petición NO trae Estok activo (caso típico de la PWA móvil,
        donde el sistema operativo puede limpiar la clave 'estok_activo_id'
        de localStorage conservando el JWT), se resuelve el Estok del propio
        usuario en lugar de devolver 403:
          1. `ultimo_estok_activo_id` (el Estok que el usuario eligió),
          2. su única Membresia, si tiene exactamente una.
        Con varias membresías y sin contexto se mantiene el rechazo: nunca se
        elige un tenant arbitrario.
        """
        try:
            base = Membresia.objects.filter(usuario=user).select_related('role')
            if estok_id:
                return base.filter(estok_id=estok_id).first()

            activo = getattr(user, 'ultimo_estok_activo_id', None)
            if activo:
                membresia = base.filter(estok_id=activo).first()
                if membresia:
                    return membresia

            candidatas = list(base[:2])
            if len(candidatas) == 1:
                return candidatas[0]
            return None
        except Exception:
            return None

    @staticmethod
    def _inyectar_estok(request, estok_id):
        """
        Escribe el Estok resuelto en `HTTP_X_ESTOK_ID` para que el resto del
        ciclo de la petición (get_queryset de cada ViewSet, helpers de fotos,
        validaciones de pertenencia) opere SIEMPRE sobre ese tenant.

        Sin este paso, una petición sin header dejaría los querysets SIN filtro
        (`get_queryset` sólo filtra si encuentra X-Estok-Id) y el fallback de
        membresía podría autorizar recursos de otro Estok. Se invalida la caché
        de `HttpRequest.headers` (cached_property) después de escribir en META.
        """
        django_request = getattr(request, '_request', request)
        django_request.META['HTTP_X_ESTOK_ID'] = str(estok_id)
        django_request.__dict__.pop('headers', None)

    def has_permission(self, request, view):
        user = request.user
        if not user.is_authenticated:
            return False

        # Los superusers tienen acceso total a todo
        if user.is_superuser:
            return True

        estok_id = self._get_estok_id(request)
        membresia = self._get_membresia(user, estok_id)

        if not membresia or not membresia.role:
            return False

        if not estok_id:
            # Se aplicó el fallback: acotar la petición al Estok resuelto.
            self._inyectar_estok(request, membresia.estok_id)

        role = membresia.role

        # Mapear acciones HTTP a permisos
        action_map = {
            'list': 'can_read',
            'retrieve': 'can_read',
            'create': 'can_write',
            'update': 'can_edit',
            'partial_update': 'can_edit',
            'destroy': 'can_delete',
            # Módulo de Decisiones: votar y ver las votaciones pendientes del
            # Estok es un derecho de LECTURA de cualquier miembro (democracia
            # 1-usuario-1-voto). El cierre manual exige capacidad de edición.
            'votar': 'can_read',
            'pendientes': 'can_read',
            'cerrar': 'can_edit',
            # Motor de fusión de espacios en "L": es una edición estructural
            # (une dos Ubicaciones bajo un mismo fusion_grupo), por eso exige
            # capacidad de edición y no el can_read por defecto.
            'fusionar': 'can_edit',
            'separar': 'can_edit',
            # Edición consolidada del bloque fusionado (nombre/geometría de todas
            # las partes en un único PUT atómico).
            'grupo': 'can_edit',
            # Subida de fotos (multipart): es una ESCRITURA sobre el objeto.
            # Se acepta `can_write` O `can_edit` (tupla) para no bloquear a los
            # roles que sólo recibieron permiso de edición. Con el token y el
            # Estok resueltos (_get_membresia) el usuario autenticado no recibe
            # 403 al subir fotos de un espacio convertido en mueble.
            'subir_foto': ('can_write', 'can_edit'),
            # PROPIEDADES DE OBJETO DEL ESPACIO (Dueño/Categoría/Estado/Valor):
            # el GET sigue siendo lectura; el guardado exige escritura/edición.
            'propiedades_objeto': 'can_read',
            'guardar_propiedades_objeto': ('can_write', 'can_edit'),
        }

        action = getattr(view, 'action', None)
        permiso_requerido = action_map.get(action, 'can_read')  # default: can_read para cualquier action custom
        if isinstance(permiso_requerido, (tuple, list, set)):
            return any(getattr(role, permiso, False) for permiso in permiso_requerido)
        return getattr(role, permiso_requerido, False)


class EsAdminDelEstok(permissions.BasePermission):
    """
    Permiso: True solo si el usuario tiene Membresia con role.name='Admin'
    en el estok_id del header X-Estok-Id, O es superuser.
    Se usa para crear/editar/borrar CodigoInvitacion.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user.is_authenticated:
            return False

        # Los superusers pueden gestionar codigos en cualquier Estok
        if user.is_superuser:
            return True

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