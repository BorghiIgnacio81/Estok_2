"""
Traducción a HTTP del control de funcionalidades (Feature Flags) y del plan de
monetización (Gratuito con Ads vs. Pro).

Los ViewSets llaman a estos helpers al inicio de la acción:

    bloqueo = exigir_funcionalidad(request, CLAVE_EXPORTACION_PDF)
    if bloqueo is not None:
        return bloqueo

La lógica de negocio (evaluación de flags, herencia de publicidad y cuotas) vive
en `inventario/services/`. Acá sólo se resuelve el Estok activo del request, se
arma la respuesta HTTP 403 y se compone el estado que consume el frontend.

Contrato del 403 (lo lee el frontend para mostrar el aviso correcto):
    { "error": "...", "codigo": "funcionalidad_no_disponible",
      "motivo": "requiere_plan_pro", "feature_flag": "ia_ilimitada" }

Contrato del bloqueo por PERMISO/CUOTA de botón (`exigir_boton`, punto 3 del
Panel de Permisos):
    HTTP 403 → { "codigo": "permiso_boton_denegado", "boton": {...} }
    HTTP 402 → { "codigo": "cuota_boton_agotada",   "boton": {...} }
El 402 (Payment Required) es el que usa el frontend para ofrecer «Pásate a Pro
o solicita más cuota».
"""

from rest_framework import permissions, status
from rest_framework.response import Response

from ..services import cuotas_botones as cuotas_service
from ..services import feature_flags as flags_service
from ..services import permisos_botones as permisos_service
from ..services import suscripcion
from .tenant_activo import estok_id_de as _estok_id_de

# Códigos estables para el frontend (no traducir ni renombrar).
CODIGO_FUNCIONALIDAD = 'funcionalidad_no_disponible'
CODIGO_CUPO = 'limite_objetos_alcanzado'
CODIGO_PERMISO_BOTON = 'permiso_boton_denegado'
CODIGO_CUOTA_BOTON = 'cuota_boton_agotada'


def estok_id_de(request):
    """
    Estok activo del request, en el mismo orden que usa el resto de la API:
      1. header X-Estok-Id (lo envía getAuthHeaders)
      2. query param `estok_id`
      3. `user.ultimo_estok_activo` (sesión del backend)

    La resolución vive en `api/tenant_activo.py` (helper único multi-tenant).
    """
    return _estok_id_de(request)


def exigir_funcionalidad(request, clave, estok_id=None):
    """
    Verifica Feature Flag + plan antes de ejecutar una acción.

    Devuelve `None` si la acción puede continuar, o un `Response` 403 con el
    detalle del bloqueo. Nunca lanza excepciones: los ViewSets hacen

        if (bloqueo := exigir_funcionalidad(request, CLAVE_X)) is not None:

    (sin walrus, por compatibilidad de estilo: se asigna y se compara).
    """
    decision = flags_service.evaluar(
        clave,
        getattr(request, 'user', None),
        estok_id or estok_id_de(request),
    )
    if decision['permitido']:
        return None

    return Response(
        {
            'error': decision['mensaje'],
            'codigo': CODIGO_FUNCIONALIDAD,
            'motivo': decision['motivo'],
            'feature_flag': decision['clave'],
            'detalle': {
                'activo_global': decision['activo_global'],
                'modo_promocional': decision['modo_promocional'],
                'requiere_premium': decision['requiere_premium'],
                'es_premium': decision['es_premium'],
            },
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def exigir_cupo_objetos(request, estok_id=None):
    """
    Verifica la cuota de objetos del plan (100 en el plan gratuito).

    Devuelve `None` si todavía hay lugar (o el plan es ilimitado), o un
    `Response` 403 con el estado completo de la cuota para que el frontend
    muestre el aviso de upgrade.
    """
    usuario = getattr(request, 'user', None)
    cupo = suscripcion.cupo_objetos(usuario, estok_id or estok_id_de(request))
    if cupo['ilimitado'] or not cupo['agotado']:
        return None

    return Response(
        {
            'error': suscripcion.mensaje_cupo_agotado(cupo),
            'codigo': CODIGO_CUPO,
            'cupo': cupo,
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def exigir_boton(request, identificador_boton, estok_id=None):
    """
    Control de acceso de un BOTÓN del sistema (Feature Flag + permiso + cuota).

    Es el helper que usan los endpoints asociados a un botón (IA, Mercado Libre,
    exportaciones, comparar precio). Orden de verificación:

      1. FEATURE FLAG del botón (maestro → promocional → plan), vía
         `exigir_funcionalidad`. Si está apagado, 403 de funcionalidad.
      2. PERMISO de `BotonPermiso` (plan del usuario o regla personalizada).
         Deshabilitado → 403 con `codigo='permiso_boton_denegado'`.
      3. CUOTA de `CuotaUsoUsuario`: si se agotaron los usos del período,
         402 con `codigo='cuota_boton_agotada'` y el mensaje
         «Has agotado tus N usos permitidos…».

    Devuelve None si la acción puede ejecutarse (y CONSUME un uso), o un
    `Response` con el bloqueo. Nunca lanza excepciones.
    """
    clave = permisos_service.clave_feature_flag(identificador_boton)
    if clave:
        bloqueo = exigir_funcionalidad(request, clave, estok_id)
        if bloqueo is not None:
            return bloqueo

    decision = cuotas_service.consumir_uso(
        getattr(request, 'user', None), identificador_boton,
    )
    if decision['permitido']:
        return None

    cuota_agotada = decision['motivo'] == cuotas_service.MOTIVO_CUOTA_AGOTADA
    return Response(
        {
            'error': decision['mensaje'],
            'codigo': CODIGO_CUOTA_BOTON if cuota_agotada else CODIGO_PERMISO_BOTON,
            'motivo': decision['motivo'],
            'boton': {
                'identificador': decision['identificador'],
                'nombre': decision['nombre'],
                'permitido': decision['permitido'],
                'limite_usos': decision['limite_usos'],
                'ilimitado': decision['ilimitado'],
                'periodo': decision['periodo'],
                'usos': decision['usos'],
                'usos_totales': decision['usos_totales'],
                'restantes': decision['restantes'],
            },
        },
        status=(
            status.HTTP_402_PAYMENT_REQUIRED if cuota_agotada
            else status.HTTP_403_FORBIDDEN
        ),
    )


class PermisoBotonHabilitado(permissions.BasePermission):
    """
    Clase de permiso DRF para declarar el botón en la vista:

        class MiVista(APIView):
            permission_classes = [IsAuthenticated, PermisoBotonHabilitado]
            boton_requerido = BOTON_IA_GEMINI

    SÓLO VERIFICA (no consume cuota): está pensada para vistas donde el consumo
    se hace explícitamente con `exigir_boton()`, o para endpoints de lectura que
    deben respetar el permiso sin gastar usos.
    """

    boton_requerido = None
    message = 'No tenés permiso para usar esta función.'

    def has_permission(self, request, view):
        identificador = getattr(view, 'boton_requerido', None) or self.boton_requerido
        if not identificador:
            return True

        estado = cuotas_service.estado_uso(
            getattr(request, 'user', None), identificador,
        )
        if estado['permitido'] and (estado['restantes'] is None or estado['restantes'] > 0):
            return True

        if estado['permitido']:
            self.message = cuotas_service.mensaje_cuota_agotada(estado)
        else:
            self.message = cuotas_service.MENSAJE_PERMISO_DESHABILITADO.format(
                nombre=estado['nombre'],
            )
        return False


def estado_plan_usuario(request, estok_id=None):
    """
    Bloque de plan + flags que se anexa a `GET /api/usuarios/me/`.

    El frontend usa `ocultar_publicidad` para ocultar los anuncios y
    `feature_flags` para habilitar/deshabilitar botones (IA, exportación, ML).
    """
    usuario = getattr(request, 'user', None)
    contexto = estok_id or estok_id_de(request)
    es_premium = suscripcion.usuario_es_premium(usuario, contexto)

    return {
        'es_premium': es_premium,
        'plan_suscripcion': suscripcion.PLAN_PRO if es_premium else suscripcion.PLAN_FREE,
        'limite_objetos': suscripcion.limite_objetos_efectivo(usuario, contexto),
        'ocultar_publicidad': suscripcion.ocultar_publicidad_efectivo(usuario, contexto),
        'cupo_objetos': suscripcion.cupo_objetos(usuario, contexto),
        'estok_id': contexto,
        'feature_flags': flags_service.estado_para_usuario(usuario, contexto),
        # Permisos y cuotas por botón (Panel de Permisos del Admin Global):
        # el frontend deshabilita el botón y muestra «te quedan N usos» sin
        # gastar la cuota (el consumo real lo hace exigir_boton en el endpoint).
        'permisos_botones': cuotas_service.resumen_usuario(usuario),
    }
