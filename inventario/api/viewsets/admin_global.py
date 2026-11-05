"""
Admin Global · endpoints de las pestañas INTERNAS del panel del frontend.

El panel se abre desde el ÚNICO botón «Administración Global» del navbar
(solo 'ygumy44') y vive en el Dashboard (`index.astro` →
`components/dashboard/AdminGlobalPanel.astro`). Estas vistas alimentan sus
pestañas SIN abrir pestañas ni ventanas del navegador hacia `/admin/`:

    - `GET        /api/admin/planes/`            → catálogo de los 5 planes.
    - `GET|PATCH  /api/admin/feature-flags/`     → toggles de funcionalidades.
    - `GET|POST   /api/admin/permisos-botones/`  → matriz de permisos/cuotas.

La LÓGICA no vive acá: `services/suscripcion.py` (planes),
`services/permisos_botones.py` (reglas) y `models/feature_flags.py` (estado de
los flags) son la única fuente de verdad. Este módulo sólo traduce a HTTP.

Todas las rutas quedan protegidas por `IsYgumyMaster` (403 inmediato para
cualquier otro usuario autenticado o anónimo).
"""

import logging
import uuid

from django.core.exceptions import ValidationError

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ...models import BotonPermiso, CustomUser, FeatureFlag
from ...models.feature_flags import FLAGS_ESTANDAR
from ...models.permisos_botones import (
    BOTONES_CATALOGO,
    IDENTIFICADORES_BOTONES,
    PERIODOS,
    PERIODO_MENSUAL,
)
from ...services import permisos_botones, suscripcion
from .super_admin import IsYgumyMaster

logger = logging.getLogger(__name__)


# =============================================================================
# HELPERS COMPARTIDOS
# =============================================================================
def planes_serializados():
    """Catálogo de planes listo para un `<select>` (valor estable + etiqueta)."""
    return [
        {'valor': valor, 'etiqueta': etiqueta}
        for valor, etiqueta in suscripcion.PLANES_ETIQUETAS
    ]


def _a_bool(valor):
    """
    Normaliza el cuerpo de un toggle.

    Acepta booleanos JSON y las representaciones típicas de un checkbox
    ('on', 'true', '1', 'si'). Cualquier otra cosa es False: un valor raro nunca
    enciende una funcionalidad por accidente.
    """
    if isinstance(valor, bool):
        return valor
    return str(valor or '').strip().lower() in ('1', 'true', 'on', 'si', 'sí', 'yes')


# =============================================================================
# PLANES
# =============================================================================
class AdminGlobalPlanesView(APIView):
    """
    GET /api/admin/planes/

    Devuelve el catálogo de planes de `plan_suscripcion` (fuente única:
    `services/suscripcion.PLANES_ETIQUETAS`). Lo usa el combobox «Plan de
    Suscripción» de la tabla de usuarios para no hardcodear las etiquetas en el
    frontend.
    """

    permission_classes = [IsYgumyMaster]

    def get(self, request):
        return Response({'planes': planes_serializados()})



# =============================================================================
# FEATURE FLAGS
# =============================================================================
def _serializar_flag(flag):
    """Feature Flag → dict JSON-friendly (mismo contrato para GET y PATCH)."""
    return {
        'clave': flag.clave,
        'nombre': flag.nombre,
        'descripcion': flag.descripcion or '',
        'activo_global': bool(flag.activo_global),
        'modo_promocional': bool(flag.modo_promocional),
    }


class AdminGlobalFeatureFlagsView(APIView):
    """
    GET   /api/admin/feature-flags/   → lista TODAS las funcionalidades.
    PATCH /api/admin/feature-flags/   → Body: { clave, activo_global?, modo_promocional? }

    `FeatureFlag.obtener()` devuelve la fila persistida o la definición estándar
    transitoria, así el panel siempre ve las funcionalidades del catálogo aunque
    la fila todavía no exista en la base. El PATCH persiste el cambio (crea la
    fila si era transitoria) y la evaluación real sigue viviendo en
    `services/feature_flags.py`.
    """

    permission_classes = [IsYgumyMaster]

    def get(self, request):
        claves = [definicion['clave'] for definicion in FLAGS_ESTANDAR]
        try:
            persistidas = list(FeatureFlag.objects.values_list('clave', flat=True))
        except Exception:  # pragma: no cover - defensivo
            persistidas = []
        for clave in persistidas:
            if clave and clave not in claves:
                claves.append(clave)

        flags = [
            _serializar_flag(flag)
            for flag in (FeatureFlag.obtener(clave) for clave in claves)
            if flag is not None
        ]
        return Response({'results': flags})

    def patch(self, request):
        datos = getattr(request, 'data', None) or {}
        clave = str(datos.get('clave') or '').strip().lower()
        if not clave:
            return Response(
                {'error': "El campo 'clave' es obligatorio."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        campos = [
            campo for campo in ('activo_global', 'modo_promocional')
            if campo in datos
        ]
        if not campos:
            return Response(
                {'error': 'Nada para actualizar (activo_global / modo_promocional).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        flag = FeatureFlag.obtener(clave)
        if flag is None:
            return Response(
                {'error': f'Feature Flag inválido: {clave!r}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        for campo in campos:
            setattr(flag, campo, _a_bool(datos.get(campo)))
        flag.save()

        logger.info(
            'Feature Flag %s actualizado por %s: %s',
            clave, getattr(request.user, 'username', '?'), campos,
        )
        return Response({'success': True, 'flag': _serializar_flag(flag)})


# =============================================================================
# PERMISOS Y CUOTAS POR BOTÓN
# =============================================================================
def _resolver_objetivo(valor):
    """
    `'free' | 'pro' | 'familiar' | 'empresas' | 'personalizado' | 'usuario:<uuid>'`
    → `(plan, usuario)`. Cualquier valor inválido cae al plan Free.

    «Personalizado» necesita SIEMPRE un usuario (sus reglas son por usuario);
    el POST lo rechaza explícitamente si llega sin usuario.
    """
    crudo = str(valor or '').strip()

    if crudo.startswith('usuario:'):
        crudo_id = crudo.split(':', 1)[1].strip()
        try:
            usuario = CustomUser.objects.filter(pk=uuid.UUID(crudo_id)).first()
        except (ValueError, AttributeError, TypeError, ValidationError):
            usuario = None
        if usuario is not None:
            return suscripcion.PLAN_PERSONALIZADO, usuario

    planes_validos = {valor_plan for valor_plan, _ in suscripcion.PLANES_ETIQUETAS}
    if crudo in planes_validos:
        return crudo, None
    return suscripcion.PLAN_FREE, None


def _valor_objetivo(plan, usuario):
    """Valor del `<select>` que representa al objetivo resuelto."""
    if usuario is not None:
        return f'usuario:{usuario.pk}'
    return plan


def _parsear_limite(texto):
    """Vacío / negativo → -1 (ILIMITADO). `0` → bloqueado. Entero → tal cual."""
    crudo = str(texto if texto is not None else '').strip()
    if not crudo:
        return -1
    try:
        valor = int(crudo)
    except (TypeError, ValueError):
        return -1
    return valor if valor >= 0 else -1


def _filas_matriz(plan, usuario):
    """Una fila por botón del catálogo con la regla EFECTIVA del objetivo."""
    reglas = permisos_botones.reglas_del_objetivo(plan, usuario)
    filas = []
    for definicion in BOTONES_CATALOGO:
        regla = reglas.get(definicion['identificador'])
        if not regla:
            continue
        filas.append({
            'identificador': regla['identificador'],
            'nombre': definicion['nombre'],
            'descripcion': definicion['descripcion'],
            'feature_flag': definicion.get('feature_flag') or '',
            'permitido': regla['permitido'],
            'limite_usos': regla['limite_usos'],
            'ilimitado': regla['ilimitado'],
            'periodo': regla['periodo'],
            'origen': regla['origen'],
        })
    return filas


def _detalle_usuario(usuario):
    """Datos mínimos del usuario objetivo (None si la regla es de un plan)."""
    if usuario is None:
        return None
    try:
        nombre = usuario.get_full_name() or usuario.username
    except Exception:  # pragma: no cover - defensivo
        nombre = getattr(usuario, 'username', '')
    plan = suscripcion.plan_declarado(usuario)
    return {
        'id': str(usuario.pk),
        'username': usuario.username,
        'display_name': nombre,
        'plan_suscripcion': plan,
        'plan_etiqueta': suscripcion.etiqueta_plan(plan),
    }


class AdminGlobalPermisosBotonesView(APIView):
    """
    GET  /api/admin/permisos-botones/?objetivo=<valor>
         → matriz completa del objetivo (plan o usuario).
    POST /api/admin/permisos-botones/
         Body: { objetivo, botones: [{ identificador, permitido, limite_usos, periodo }] }
         → guarda la matriz y la devuelve actualizada.

    Tocar la matriz de un USUARIO lo pasa a plan «Personalizado», igual que el
    panel del Django Admin: sus reglas propias mandan sobre las del plan base.
    """

    permission_classes = [IsYgumyMaster]

    def get(self, request):
        plan, usuario = _resolver_objetivo(request.query_params.get('objetivo'))
        return Response(self._respuesta(plan, usuario))

    def post(self, request):
        datos = getattr(request, 'data', None) or {}
        plan, usuario = _resolver_objetivo(datos.get('objetivo'))
        botones = datos.get('botones')

        if plan == suscripcion.PLAN_PERSONALIZADO and usuario is None:
            return Response(
                {'error': 'El plan «Personalizado» se configura por usuario: '
                          'elegí un usuario concreto.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not isinstance(botones, list) or not botones:
            return Response(
                {'error': "El campo 'botones' es obligatorio y no puede estar vacío."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        guardados = 0
        for item in botones:
            if not isinstance(item, dict):
                continue
            identificador = str(item.get('identificador') or '').strip()
            if identificador not in IDENTIFICADORES_BOTONES:
                continue

            periodo = str(item.get('periodo') or PERIODO_MENSUAL).strip()
            if periodo not in dict(PERIODOS):
                periodo = PERIODO_MENSUAL

            BotonPermiso.objects.update_or_create(
                identificador_boton=identificador,
                plan=plan,
                usuario=usuario,
                defaults={
                    'permitido': _a_bool(item.get('permitido')),
                    'limite_usos': _parsear_limite(item.get('limite_usos')),
                    'periodo': periodo,
                },
            )
            guardados += 1

        if usuario is not None:
            suscripcion.aplicar_plan_usuario(
                usuario, suscripcion.PLAN_PERSONALIZADO,
            )

        logger.info(
            'Matriz de permisos guardada por %s (objetivo=%s, botones=%d).',
            getattr(request.user, 'username', '?'),
            _valor_objetivo(plan, usuario),
            guardados,
        )

        respuesta = self._respuesta(plan, usuario)
        respuesta.update({
            'success': True,
            'guardados': guardados,
            'mensaje': (
                f'Permisos de {usuario.username} guardados ({guardados} botones). '
                'Su plan quedó en «Personalizado».'
                if usuario is not None
                else f'Permisos del plan «{suscripcion.etiqueta_plan(plan)}» '
                     f'guardados ({guardados} botones).'
            ),
        })
        return Response(respuesta)

    @staticmethod
    def _respuesta(plan, usuario):
        """Cuerpo común de GET y POST para que el frontend redibuje igual."""
        return {
            'objetivo': _valor_objetivo(plan, usuario),
            'tipo': 'usuario' if usuario is not None else 'plan',
            'plan': plan,
            'plan_etiqueta': suscripcion.etiqueta_plan(plan),
            'usuario': _detalle_usuario(usuario),
            'planes': planes_serializados(),
            'periodos': [
                {'valor': valor, 'etiqueta': etiqueta}
                for valor, etiqueta in PERIODOS
            ],
            'botones': _filas_matriz(plan, usuario),
        }

