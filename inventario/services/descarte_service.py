"""
Servicio de DESCARTE CON PERÍODO DE GRACIA y ADMINISTRACIÓN FÍSICA del espacio.

Reglas de negocio que centraliza este módulo (ÚNICA fuente de verdad, sin
duplicar lógica en viewsets, serializers ni frontend):

1. TIEMPO DE GRACIA
   Cuando en el Estok hay MÁS DE UN usuario activo, ordenar tirar un objeto
   exige elegir un tiempo de gracia (24 Horas / 3 Días / 1 Semana). El descarte
   NO es inmediato: se persiste la fecha y hora EXACTA de finalización en
   `Objeto.fecha_limite_descarte`, el objeto sigue visible y cualquier miembro
   puede reclamarlo (Conservar / Mudar) mientras el plazo esté vigente.
   Con un solo usuario activo no hay nadie que reclame: el descarte se ordena
   sin plazo y queda listo para la ejecución física.

2. ADMINISTRADOR FÍSICO
   Confirmar el descarte definitivo (cuando venció la gracia) y despachar los
   envíos de objetos vendidos son acciones que exigen presencia física en el
   espacio real: solo las puede ejecutar quien tiene un rol con
   `Role.es_administrador_fisico` (o un superusuario).

3. RECLAMO
   `cancelar_descarte()` muta el estado del objeto a 'conservar' (queda en la
   lista de protección del Bloque 5) o a 'mudar' (el dueño lo traslada de
   Estok por el módulo de Mudanza) y limpia el plazo.
"""

import logging
from datetime import timedelta

from django.utils import timezone

from ..models import Membresia

logger = logging.getLogger(__name__)


# =============================================================================
# TIEMPOS DE GRACIA (la UI NO los hardcodea: los pide a
# GET /api/objetos/contexto_descarte/)
# =============================================================================

TIEMPOS_GRACIA = (
    {'valor': '24_horas', 'etiqueta': '24 Horas', 'horas': 24},
    {'valor': '3_dias', 'etiqueta': '3 Días', 'horas': 72},
    {'valor': '1_semana', 'etiqueta': '1 Semana', 'horas': 168},
)

# Acciones válidas para RECLAMAR un objeto antes de que venza su descarte.
ACCIONES_RECLAMO = ('conservar', 'mudar')

# Nombres de rol que actúan como Administrador Físico aunque el flag booleano
# no esté marcado (compatibilidad con los roles ya existentes en producción).
ROLES_ADMIN_FISICO = (
    'admin',
    'administrador',
    'administrador fisico',
    'administrador físico',
    'encargado de almacen',
    'encargado de almacén',
)


def tiempos_gracia():
    """Copia serializable de las opciones de gracia ofrecidas al usuario."""
    return [dict(tiempo) for tiempo in TIEMPOS_GRACIA]


def duracion_gracia(valor):
    """timedelta del tiempo de gracia indicado, o None si el valor no es válido."""
    for tiempo in TIEMPOS_GRACIA:
        if tiempo['valor'] == valor:
            return timedelta(hours=tiempo['horas'])
    return None


def etiqueta_gracia(valor):
    """Etiqueta legible ('3 Días') del tiempo de gracia, o cadena vacía."""
    for tiempo in TIEMPOS_GRACIA:
        if tiempo['valor'] == valor:
            return tiempo['etiqueta']
    return ''


# =============================================================================
# PADRÓN Y PERMISOS
# =============================================================================

def total_usuarios_activos(estok_id):
    """
    Usuarios activos del Estok: MISMO padrón democrático del módulo Decisiones
    (inventario/services/decisiones_service.py). No se duplica la consulta.
    """
    from . import decisiones_service

    return decisiones_service.total_votantes(estok_id)


def requiere_tiempo_gracia(estok_id):
    """Con más de un usuario activo el descarte obliga a elegir tiempo de gracia."""
    return total_usuarios_activos(estok_id) > 1


def _membresia_activa(usuario, estok_id):
    """Membresía del usuario en el Estok (con su Rol), o None."""
    if not usuario or not getattr(usuario, 'is_authenticated', False) or not estok_id:
        return None
    return (
        Membresia.objects.filter(usuario=usuario, estok_id=estok_id)
        .select_related('role')
        .first()
    )


def es_administrador_fisico(usuario, estok_id):
    """
    True si el usuario puede ejecutar acciones FÍSICAS en el espacio del Estok.

    Criterios (en orden): superusuario, rol con `es_administrador_fisico`
    marcado, o rol cuyo nombre corresponda a un gestor del espacio
    (Admin / Administrador Físico / Encargado de Almacén).
    """
    if not usuario or not getattr(usuario, 'is_authenticated', False):
        return False
    if usuario.is_superuser:
        return True

    membresia = _membresia_activa(usuario, estok_id)
    if not membresia or not membresia.role:
        return False

    role = membresia.role
    if getattr(role, 'es_administrador_fisico', False):
        return True
    return (role.name or '').strip().lower() in ROLES_ADMIN_FISICO


def puede_decidir_descarte(usuario, objeto):
    """
    True si el usuario puede ORDENAR o RECLAMAR el descarte de este objeto.

    Son los mismos habilitados que en el resto de la pestaña Decisiones:
    el dueño original, el beneficiario o cualquier miembro con capacidad de
    edición en el Estok activo.
    """
    if not usuario or not getattr(usuario, 'is_authenticated', False):
        return False
    if usuario.is_superuser:
        return True

    usuario_id = getattr(usuario, 'id', None)
    if usuario_id in (objeto.dueno_original_id, objeto.beneficiario_id):
        return True

    membresia = _membresia_activa(usuario, objeto.estok_id)
    return bool(membresia and membresia.role and membresia.role.can_edit)


# =============================================================================
# ORDEN DE DESCARTE (con período de gracia si hay más de un usuario activo)
# =============================================================================

def ordenar_descarte(objeto, tiempo_gracia=None, usuario=None):
    """
    Ordena tirar el objeto persistiendo el fin EXACTO del período de gracia.

    Lanza ValueError (la vista lo traduce a HTTP 400) cuando falta el tiempo de
    gracia obligatorio o cuando el valor recibido no es válido.
    """
    tiempo_gracia = (tiempo_gracia or '').strip().lower() or None
    if tiempo_gracia and duracion_gracia(tiempo_gracia) is None:
        opciones = ', '.join(t['etiqueta'] for t in TIEMPOS_GRACIA)
        raise ValueError(f"Tiempo de gracia inválido. Opciones: {opciones}.")

    delta = duracion_gracia(tiempo_gracia)
    if requiere_tiempo_gracia(objeto.estok_id) and delta is None:
        opciones = ', '.join(t['etiqueta'] for t in TIEMPOS_GRACIA)
        raise ValueError(
            'Este Estok tiene más de un usuario activo: elegí un tiempo de gracia '
            f'({opciones}) antes de tirar el objeto.'
        )

    ahora = timezone.now()
    objeto.owner_action = 'tirar'
    objeto.descartado_en = ahora
    objeto.fecha_limite_descarte = ahora + delta if delta else None
    objeto.save(
        update_fields=['owner_action', 'descartado_en', 'fecha_limite_descarte', 'updated_at']
    )

    logger.info(
        "Orden de descarte del objeto %s (Estok %s) — gracia: %s",
        objeto.id, objeto.estok_id, etiqueta_gracia(tiempo_gracia) or 'sin gracia',
    )
    return objeto


def cancelar_descarte(objeto, accion):
    """
    RECLAMA el objeto antes del vencimiento: muta el estado a 'conservar' o
    'mudar' y limpia el plazo de gracia.
    """
    accion = (accion or '').strip().lower()
    if accion not in ACCIONES_RECLAMO:
        raise ValueError('Acción de reclamo inválida. Opciones: conservar, mudar.')

    if objeto.owner_action != 'tirar':
        raise ValueError('El objeto no tiene una orden de descarte activa.')

    objeto.owner_action = accion
    objeto.descartado_en = None
    objeto.fecha_limite_descarte = None
    objeto.save(
        update_fields=[
            'owner_action', 'descartado_en', 'fecha_limite_descarte', 'updated_at',
        ]
    )
    logger.info(
        "Descarte cancelado del objeto %s (Estok %s) → %s",
        objeto.id, objeto.estok_id, accion,
    )
    return objeto


# =============================================================================
# EJECUCIÓN FÍSICA (exclusiva del Administrador Físico)
# =============================================================================

def confirmar_descarte(objeto, usuario=None):
    """
    CONFIRMA el descarte definitivo (baja lógica del objeto).

    Exige que la gracia ya haya vencido (o que no exista plazo): mientras el
    plazo esté vigente, el dueño remoto todavía puede reclamar el objeto.
    El permiso de Administrador Físico lo valida el endpoint.
    """
    if objeto.owner_action != 'tirar':
        raise ValueError('El objeto no tiene una orden de descarte activa.')
    if objeto.en_periodo_gracia:
        raise ValueError(
            'El período de gracia sigue activo: el objeto todavía puede ser reclamado.'
        )

    objeto.deleted_at = timezone.now()
    objeto.fecha_limite_descarte = None
    objeto.save(
        update_fields=['deleted_at', 'fecha_limite_descarte', 'owner_action', 'updated_at']
    )
    logger.info(
        "Descarte físico confirmado del objeto %s (Estok %s) por %s",
        objeto.id, objeto.estok_id, getattr(usuario, 'username', 'sistema'),
    )
    return objeto


def despachar_envio(objeto, usuario=None):
    """
    Marca como DESPACHADO el envío de un objeto vendido (solo Administrador
    Físico). Evita dobles despachos y deja auditoría de quién lo hizo.
    """
    if objeto.owner_action != 'vender':
        raise ValueError('Solo se pueden despachar objetos con decisión de Vender.')
    if objeto.despachado_en:
        raise ValueError('El envío de este objeto ya fue despachado.')

    objeto.despachado_en = timezone.now()
    if usuario is not None and getattr(usuario, 'is_authenticated', False):
        objeto.despachado_por = usuario
    objeto.save(update_fields=['despachado_en', 'despachado_por', 'updated_at'])
    logger.info(
        "Envío despachado del objeto %s (Estok %s) por %s",
        objeto.id, objeto.estok_id, getattr(usuario, 'username', 'sistema'),
    )
    return objeto


# =============================================================================
# CONSULTAS DEL TABLERO (Alerta Rojo y Bloque 4)
# =============================================================================

def descartes_en_gracia(estok_id=None):
    """
    Objetos con orden de tirar ACTIVA y plazo de reclamo vigente: alimentan el
    Alerta Rojo con contador regresivo del Bloque 2 de la pestaña Decisiones.
    """
    from ..models import Objeto

    qs = (
        Objeto.objects.filter(
            deleted_at__isnull=True,
            owner_action='tirar',
            fecha_limite_descarte__gt=timezone.now(),
        )
        .select_related(
            'ubicacion', 'contenedor', 'dueno_original', 'beneficiario', 'categoria',
        )
        .prefetch_related('fotos')
        .order_by('fecha_limite_descarte')
    )
    if estok_id:
        qs = qs.filter(estok_id=estok_id)
    return qs
