"""
Cuotas de uso por botón — decisión y CONSUMO atómico.

Segunda mitad del control granular (la configuración de reglas vive en
`services/permisos_botones.py`):

    - `estado_uso()`      → foto SIN consumir (la expone `GET /usuarios/me/`).
    - `consumir_uso()`    → verifica permiso + cuota y suma un uso.
    - `_registrar_uso()`  → bloqueo de fila (`select_for_update`) + ventana.

Ventana de conteo: `diario` / `mensual` se reinician en hora LOCAL (no UTC);
`total` no se reinicia nunca y compara contra `usos_totales`.

La traducción a HTTP (403 permiso / 402 cuota agotada) vive en
`inventario/api/plan_acceso.py`.
"""

import logging

from django.db import transaction
from django.utils import timezone

from ..models import CuotaUsoUsuario
from ..models.permisos_botones import (
    PERIODO_DIARIO,
    PERIODO_MENSUAL,
    PERIODO_TOTAL,
)
from . import permisos_botones, suscripcion

logger = logging.getLogger(__name__)

# Motivos de la decisión (los consume la API para pintar el aviso correcto).
MOTIVO_OK = 'ok'
MOTIVO_PERMISO_DESHABILITADO = 'permiso_deshabilitado'
MOTIVO_CUOTA_AGOTADA = 'cuota_agotada'
MOTIVO_SIN_SESION = 'sin_sesion'

MENSAJE_PERMISO_DESHABILITADO = (
    'El botón «{nombre}» no está habilitado para tu cuenta. '
    'Pásate a Pro o solicita acceso al administrador.'
)
MENSAJE_CUOTA_AGOTADA = (
    'Has agotado tus {limite} usos permitidos para este botón ({nombre}) en el '
    'período {periodo}. Pásate a Pro o solicita más cuota.'
)
MENSAJE_SIN_SESION = 'Necesitás iniciar sesión para usar esta función.'

__all__ = [
    'MOTIVO_CUOTA_AGOTADA',
    'MOTIVO_OK',
    'MOTIVO_PERMISO_DESHABILITADO',
    'MOTIVO_SIN_SESION',
    'MENSAJE_CUOTA_AGOTADA',
    'MENSAJE_PERMISO_DESHABILITADO',
    'MENSAJE_SIN_SESION',
    'consumir_uso',
    'estado_uso',
    'inicio_ventana',
    'mensaje_cuota_agotada',
    'resumen_usuario',
]


# =============================================================================
# VENTANA DE CONTEO
# =============================================================================
def inicio_ventana(periodo, ahora=None):
    """
    Inicio de la ventana vigente según el período (`None` = período «total»).

    Se calcula en hora LOCAL (día/mes del usuario), no en UTC: de lo contrario
    la cuota «diaria» se reiniciaría a las 21:00 en Argentina.
    """
    if periodo == PERIODO_TOTAL:
        return None

    referencia = ahora or timezone.now()
    try:
        referencia = timezone.localtime(referencia)
    except (ValueError, AttributeError):  # USE_TZ=False o datetime naive
        pass

    if periodo == PERIODO_DIARIO:
        return referencia.replace(hour=0, minute=0, second=0, microsecond=0)
    return referencia.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _usos_vigentes(cuota, regla, ahora=None):
    """Usos que cuentan para el límite (ventana reiniciada o histórico)."""
    if cuota is None:
        return 0
    inicio = inicio_ventana(regla['periodo'], ahora)
    if inicio is None:
        return cuota.usos_totales
    if cuota.periodo_inicio is None or cuota.periodo_inicio < inicio:
        return 0
    return cuota.usos


def _restantes(regla, usados):
    """Usos que le quedan al usuario (None si la regla es ilimitada)."""
    if regla['ilimitado']:
        return None
    limite = int(regla['limite_usos'])
    return max(limite - usados, 0)


def estado_uso(usuario, identificador_boton, regla=None):
    """
    Foto (SIN consumir) del permiso y la cuota de un botón para un usuario.

    Es lo que expone `GET /api/usuarios/me/` en `permisos_botones` para que la
    UI pueda deshabilitar un botón y mostrar «te quedan N usos» sin gastarlo.
    """
    regla = regla or permisos_botones.regla_efectiva(usuario, identificador_boton)
    estado = {
        'identificador': regla['identificador'],
        'nombre': regla['nombre'],
        'permitido': regla['permitido'],
        'limite_usos': regla['limite_usos'],
        'ilimitado': regla['ilimitado'],
        'periodo': regla['periodo'],
        'origen': regla['origen'],
        'usos': 0,
        'usos_totales': 0,
        'restantes': None,
        'ultimo_uso': None,
    }
    if not getattr(usuario, 'pk', None):
        estado['restantes'] = _restantes(regla, 0)
        return estado

    cuota = CuotaUsoUsuario.objects.filter(
        usuario_id=usuario.pk, identificador_boton=regla['identificador'],
    ).first()
    if cuota is None:
        estado['restantes'] = _restantes(regla, 0)
        return estado

    usados = _usos_vigentes(cuota, regla)
    estado.update({
        'usos': usados,
        'usos_totales': cuota.usos_totales,
        'restantes': _restantes(regla, usados),
        'ultimo_uso': cuota.ultimo_uso.isoformat() if cuota.ultimo_uso else None,
    })
    return estado


def resumen_usuario(usuario):
    """
    Estado de TODOS los botones del catálogo para un usuario (bloque
    `permisos_botones` de `GET /api/usuarios/me/`).

    Optimizado para el endpoint más caliente: resuelve las cuotas en UNA query
    y las reglas en como máximo dos (plan base + reglas propias).
    """
    if not getattr(usuario, 'pk', None):
        return {}

    plan = permisos_botones.plan_para_permisos(usuario)
    plan_base = plan
    if plan == suscripcion.PLAN_PERSONALIZADO:
        # Usuario personalizado: hereda del plan base y lo pisa con sus filas.
        plan_base = (
            permisos_botones.PLAN_REGLA_PRO
            if suscripcion.usuario_es_premium(usuario)
            else permisos_botones.PLAN_REGLA_FREE
        )

    reglas = permisos_botones.reglas_del_objetivo(plan_base, None)
    if plan == suscripcion.PLAN_PERSONALIZADO:
        propias = permisos_botones.reglas_del_objetivo(plan, usuario)
        reglas.update({
            identificador: regla
            for identificador, regla in propias.items()
            if regla['origen'] == 'usuario'
        })

    cuotas = {
        cuota.identificador_boton: cuota
        for cuota in CuotaUsoUsuario.objects.filter(usuario_id=usuario.pk)
    }

    resumen = {}
    for identificador, regla in reglas.items():
        cuota = cuotas.get(identificador)
        usados = _usos_vigentes(cuota, regla)
        resumen[identificador] = {
            'nombre': regla['nombre'],
            'permitido': regla['permitido'],
            'limite_usos': regla['limite_usos'],
            'ilimitado': regla['ilimitado'],
            'periodo': regla['periodo'],
            'origen': regla['origen'],
            'usos': usados,
            'usos_totales': cuota.usos_totales if cuota else 0,
            'restantes': _restantes(regla, usados),
        }
    return resumen


# =============================================================================
# CONSUMO ATÓMICO DE LA CUOTA
# =============================================================================
def _registrar_uso(usuario, identificador_boton, regla, cantidad=1):
    """
    Bloquea la fila de cuota, aplica el reinicio de la ventana y suma el uso.

    Devuelve `(cuota, agotado, usados, restantes)` sin lanzar excepciones: el
    llamador decide qué responder. Si la cuota ya está agotada NO incrementa.
    """
    ahora = timezone.now()
    inicio = inicio_ventana(regla['periodo'], ahora)
    limite = None if regla['ilimitado'] else int(regla['limite_usos'])

    with transaction.atomic():
        cuota, creada = CuotaUsoUsuario.objects.get_or_create(
            usuario=usuario, identificador_boton=identificador_boton,
        )
        if not creada:
            cuota = CuotaUsoUsuario.objects.select_for_update().get(pk=cuota.pk)

        if inicio is None:
            # Período «total»: la ventana no se reinicia nunca.
            cuota.periodo_inicio = None
        elif cuota.periodo_inicio is None or cuota.periodo_inicio < inicio:
            cuota.periodo_inicio = inicio
            cuota.usos = 0

        usados = cuota.usos_totales if inicio is None else cuota.usos
        if limite is not None and usados + cantidad > limite:
            cuota.save(update_fields=['periodo_inicio', 'usos', 'updated_at'])
            return cuota, True, usados, max(limite - usados, 0)

        cuota.usos += cantidad
        cuota.usos_totales += cantidad
        cuota.ultimo_uso = ahora
        cuota.save(update_fields=[
            'periodo_inicio', 'usos', 'usos_totales', 'ultimo_uso', 'updated_at',
        ])
        restantes = None if limite is None else max(limite - (usados + cantidad), 0)
        return cuota, False, usados + cantidad, restantes


def consumir_uso(usuario, identificador_boton, cantidad=1):
    """
    Verifica permiso + cuota y, si corresponde, CONSUME un uso.

    Devuelve un dict con toda la decisión:

        {'permitido': bool, 'motivo': 'ok' | 'permiso_deshabilitado' |
         'cuota_agotada' | 'sin_sesion', 'mensaje': str, 'nombre': str,
         'identificador': str, 'limite_usos', 'periodo', 'usos',
         'usos_totales', 'restantes', 'ilimitado', 'origen'}

    El superusuario (Admin Global) siempre pasa y no consume cuota: el panel de
    administración nunca se autobloquea.
    """
    regla = permisos_botones.regla_efectiva(usuario, identificador_boton)
    resultado = {
        'identificador': regla['identificador'],
        'nombre': regla['nombre'],
        'permitido': True,
        'motivo': MOTIVO_OK,
        'mensaje': '',
        'limite_usos': regla['limite_usos'],
        'ilimitado': regla['ilimitado'],
        'periodo': regla['periodo'],
        'origen': regla['origen'],
        'usos': 0,
        'usos_totales': 0,
        'restantes': None,
    }

    if usuario is None or not getattr(usuario, 'is_authenticated', False):
        resultado.update(
            permitido=False, motivo=MOTIVO_SIN_SESION, mensaje=MENSAJE_SIN_SESION,
        )
        return resultado

    if getattr(usuario, 'is_superuser', False) or not getattr(usuario, 'pk', None):
        return resultado

    if not regla['permitido']:
        resultado.update(
            permitido=False,
            motivo=MOTIVO_PERMISO_DESHABILITADO,
            mensaje=MENSAJE_PERMISO_DESHABILITADO.format(nombre=regla['nombre']),
        )
        return resultado

    cuota, agotado, usados, restantes = _registrar_uso(
        usuario, regla['identificador'], regla, cantidad,
    )
    resultado.update(
        usos=usados,
        usos_totales=cuota.usos_totales,
        restantes=restantes,
    )
    if agotado:
        resultado.update(
            permitido=False,
            motivo=MOTIVO_CUOTA_AGOTADA,
            mensaje=mensaje_cuota_agotada(regla),
        )
    return resultado


def mensaje_cuota_agotada(regla):
    """Mensaje explicativo listo para la UI cuando la cuota del botón se agotó."""
    return MENSAJE_CUOTA_AGOTADA.format(
        limite=regla.get('limite_usos'),
        nombre=regla.get('nombre') or regla.get('identificador'),
        periodo=regla.get('periodo') or PERIODO_MENSUAL,
    )
