"""
Suscripciones y planes de monetización (Gratuito con Ads vs. Pro).

ÚNICA FUENTE DE VERDAD para resolver:
  - si un usuario/Estok es premium (incluida la HERENCIA desde el creador del
    hogar: si el creador es premium, todos sus miembros lo son a efectos de UI),
  - cuántos objetos puede registrar el hogar (cuota del plan gratuito = 100),
  - si la UI debe ocultar la publicidad.

No conoce `request` ni `Response`: recibe objetos de dominio y devuelve datos
primitivos, igual que el resto de `inventario/services/`. La traducción a HTTP
vive en `inventario/api/plan_acceso.py`; la evaluación de Feature Flags en
`inventario/services/feature_flags.py`.
"""

import logging

from django.core.exceptions import ValidationError
from django.db.models import Q

from ..models import CustomUser, Estok, Membresia, Objeto

logger = logging.getLogger(__name__)

# Planes válidos (los mismos `choices` de CustomUser.plan_suscripcion y
# Estok.plan_suscripcion).
PLAN_FREE = 'free'
PLAN_PRO = 'pro'

# Cuota por defecto del plan gratuito (coincide con el default del modelo).
LIMITE_OBJETOS_FREE = 100

MENSAJE_LIMITE_OBJETOS = (
    'Alcanzaste el límite de {limite} objetos del plan gratuito '
    '({usados} registrados). Pasate al plan Pro para seguir cargando.'
)


# =============================================================================
# RESOLUCIÓN DE PLANES
# =============================================================================
def obtener_estok(estok_id):
    """
    Devuelve el Estok con su creador precargado, o None.

    Tolera ids inválidos (str no-UUID, None): la resolución de plan NUNCA debe
    romper una petición por un header malformado.
    """
    if not estok_id:
        return None
    try:
        return Estok.objects.select_related('creador').filter(pk=estok_id).first()
    except (ValidationError, ValueError, TypeError):
        return None


def estok_es_premium(estok):
    """
    True si el HOGAR es premium.

    Dos caminos válidos (el Admin Global puede usar cualquiera):
      1. El Estok tiene el plan Pro cargado directamente (`estok.es_premium`).
      2. El CREADOR del Estok tiene plan Pro (`estok.creador.es_premium`): es la
         regla de herencia pedida — el hogar del suscriptor navega sin ads.
    """
    if estok is None:
        return False
    if estok.es_premium:
        return True
    creador = getattr(estok, 'creador', None)
    return bool(creador is not None and creador.es_premium)


def usuario_es_premium(usuario, estok_id=None):
    """
    True si el usuario opera con plan Pro en el contexto dado.

    Reglas, en orden:
      1. Sin usuario autenticado → False.
      2. Superusuario (Admin Global) → True: nunca se autobloquea el panel.
      3. `usuario.es_premium` → True.
      4. Con Estok activo: el plan del hogar (propio o de su creador).
      5. Sin Estok activo: cualquier hogar premium del que sea miembro.
    """
    if usuario is None or not getattr(usuario, 'is_authenticated', False):
        return False

    if getattr(usuario, 'is_superuser', False):
        return True

    if getattr(usuario, 'es_premium', False):
        return True

    estok = obtener_estok(estok_id)
    if estok is not None:
        return estok_es_premium(estok)

    try:
        return Estok.objects.filter(
            Q(es_premium=True) | Q(creador__es_premium=True),
            miembros__usuario=usuario,
        ).exists()
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning(
            'No se pudo resolver el plan premium de %s: %s',
            getattr(usuario, 'username', '?'), exc,
        )
        return False


def plan_efectivo(usuario, estok_id=None):
    """Plan canónico ('free' / 'pro') que debe mostrar la UI."""
    return PLAN_PRO if usuario_es_premium(usuario, estok_id) else PLAN_FREE


def ocultar_publicidad_efectivo(usuario, estok_id=None):
    """
    True si la UI debe ocultar la publicidad para este usuario.

    Se resuelve DINÁMICAMENTE (no sólo por el campo persistido) para que la
    herencia del hogar premium aplique incluso antes de que la señal de
    sincronización haya corrido.
    """
    if usuario is None:
        return False
    if getattr(usuario, 'ocultar_publicidad', False):
        return True
    return usuario_es_premium(usuario, estok_id)


# =============================================================================
# CUOTA DE OBJETOS
# =============================================================================
def limite_objetos_efectivo(usuario, estok_id=None):
    """
    Tope de objetos del contexto actual, o None si es ilimitado (plan Pro).

    Orden de precedencia: plan Pro (ilimitado) → límite del hogar → límite del
    usuario → cuota estándar del plan gratuito (100).
    """
    if usuario_es_premium(usuario, estok_id):
        return None

    estok = obtener_estok(estok_id)
    candidatos = (
        getattr(estok, 'limite_objetos', None),
        getattr(usuario, 'limite_objetos', None),
    )
    for candidato in candidatos:
        if candidato is not None:
            return int(candidato)
    return LIMITE_OBJETOS_FREE


def objetos_registrados(estok_id):
    """Objetos vivos (sin soft delete) del Estok. Sin Estok no se cuenta nada."""
    if not estok_id:
        return 0
    try:
        return Objeto.objects.filter(
            estok_id=estok_id, deleted_at__isnull=True,
        ).count()
    except (ValidationError, ValueError, TypeError):
        return 0


def cupo_objetos(usuario, estok_id=None):
    """
    Estado de la cuota para el frontend:

        { 'usados': n, 'limite': 100 | None, 'restantes': n | None,
          'ilimitado': bool, 'agotado': bool }
    """
    limite = limite_objetos_efectivo(usuario, estok_id)
    usados = objetos_registrados(estok_id)

    if limite is None:
        return {
            'usados': usados,
            'limite': None,
            'restantes': None,
            'ilimitado': True,
            'agotado': False,
        }

    restantes = max(limite - usados, 0)
    return {
        'usados': usados,
        'limite': limite,
        'restantes': restantes,
        'ilimitado': False,
        'agotado': restantes <= 0,
    }


def mensaje_cupo_agotado(cupo):
    """Mensaje listo para mostrar cuando la cuota del plan gratuito se agotó."""
    return MENSAJE_LIMITE_OBJETOS.format(
        limite=cupo.get('limite') or LIMITE_OBJETOS_FREE,
        usados=cupo.get('usados') or 0,
    )


# =============================================================================
# SINCRONIZACIÓN DE LA PUBLICIDAD (HERENCIA DEL PLAN PRO)
# =============================================================================
def sincronizar_publicidad_estok(estok):
    """
    Propaga `ocultar_publicidad` a TODOS los miembros de un Estok.

    - Hogar premium → todos los miembros quedan con `ocultar_publicidad=True`.
    - Hogar gratuito → cada miembro conserva su propio plan (sólo los usuarios
      con `es_premium=True` mantienen la publicidad oculta).

    Usa `queryset.update()` a propósito: es una sola sentencia por grupo, NO
    dispara señales y por lo tanto no puede entrar en recursión. Devuelve la
    cantidad de filas actualizadas.
    """
    if estok is None or not getattr(estok, 'pk', None):
        return 0

    ids = list(
        Membresia.objects.filter(estok=estok).values_list('usuario_id', flat=True)
    )
    if not ids:
        return 0

    try:
        if estok_es_premium(estok):
            return CustomUser.objects.filter(id__in=ids).update(
                ocultar_publicidad=True,
            )
        CustomUser.objects.filter(id__in=ids, es_premium=True).update(
            ocultar_publicidad=True,
        )
        return CustomUser.objects.filter(id__in=ids, es_premium=False).update(
            ocultar_publicidad=False,
        )
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning(
            'No se pudo sincronizar la publicidad del Estok %s: %s',
            getattr(estok, 'pk', '?'), exc,
        )
        return 0


def sincronizar_publicidad_usuario(usuario):
    """
    Alinea `ocultar_publicidad` del usuario con el plan de TODOS sus hogares.

    Es la regla de herencia pedida: pertenecer a un Estok cuyo creador es
    premium alcanza para que el miembro no vea publicidad. Devuelve 1 si hubo
    que corregir el campo, 0 si ya estaba correcto (idempotente).
    """
    if usuario is None or not getattr(usuario, 'pk', None):
        return 0

    try:
        hereda = Estok.objects.filter(
            Q(es_premium=True) | Q(creador__es_premium=True),
            miembros__usuario=usuario,
        ).exists()
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning(
            'No se pudo resolver la herencia de publicidad de %s: %s',
            getattr(usuario, 'username', '?'), exc,
        )
        return 0

    ocultar = bool(getattr(usuario, 'es_premium', False) or hereda)
    if bool(getattr(usuario, 'ocultar_publicidad', False)) == ocultar:
        return 0

    try:
        # `.update()` no dispara señales: corta cualquier posible recursión.
        CustomUser.objects.filter(pk=usuario.pk).update(
            ocultar_publicidad=ocultar,
        )
        usuario.ocultar_publicidad = ocultar
        return 1
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning(
            'No se pudo actualizar ocultar_publicidad de %s: %s',
            getattr(usuario, 'username', '?'), exc,
        )
        return 0
