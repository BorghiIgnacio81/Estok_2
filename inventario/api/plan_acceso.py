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
"""

from rest_framework import status
from rest_framework.response import Response

from ..services import feature_flags as flags_service
from ..services import suscripcion

# Códigos estables para el frontend (no traducir ni renombrar).
CODIGO_FUNCIONALIDAD = 'funcionalidad_no_disponible'
CODIGO_CUPO = 'limite_objetos_alcanzado'


def estok_id_de(request):
    """
    Estok activo del request, en el mismo orden que usa el resto de la API:
      1. header X-Estok-Id (lo envía getAuthHeaders)
      2. query param `estok_id`
      3. `user.ultimo_estok_activo` (sesión del backend)
    """
    if request is None:
        return None

    estok_id = (
        request.headers.get('X-Estok-Id')
        or request.query_params.get('estok_id')
    )
    if estok_id:
        return str(estok_id)

    usuario = getattr(request, 'user', None)
    ultimo = getattr(usuario, 'ultimo_estok_activo_id', None)
    return str(ultimo) if ultimo else None


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
    }
