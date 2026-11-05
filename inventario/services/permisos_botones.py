"""
Permisos GRANULARES por botón — catálogo, resolución de reglas y siembra.

Mitad de CONFIGURACIÓN del control granular; el CONTEO y la decisión de uso
viven en `services/cuotas_botones.py`.

Orden de resolución de la regla (el mismo que muestra el Panel de Permisos):

    a) Plan `personalizado`  → fila de `BotonPermiso` del USUARIO
    b) Si no hay fila propia → fila del PLAN base que le corresponde por su
                               estado premium (pro si es premium, free si no)
    c) Si no hay fila        → definición del catálogo (permitido + ilimitado)

No conoce `request` ni `Response`: recibe objetos de dominio y devuelve datos
primitivos, igual que el resto de `inventario/services/`. La traducción a HTTP
(403 permiso / 402 cuota agotada) vive en `inventario/api/plan_acceso.py`.
"""

import logging

from ..models import BotonPermiso
from ..models.permisos_botones import (
    BOTONES_CATALOGO,
    IDENTIFICADORES_BOTONES,
    PERIODO_MENSUAL,
    PERIODOS,
    PLAN_REGLA_FREE,
    PLAN_REGLA_PERSONALIZADO,
    PLAN_REGLA_PRO,
)
from . import suscripcion

logger = logging.getLogger(__name__)

__all__ = [
    'BOTONES_CATALOGO',
    'IDENTIFICADORES_BOTONES',
    'PERIODOS',
    'PLAN_REGLA_FREE',
    'PLAN_REGLA_PERSONALIZADO',
    'PLAN_REGLA_PRO',
    'clave_feature_flag',
    'definicion_boton',
    'nombre_boton',
    'plan_para_permisos',
    'regla_efectiva',
    'reglas_del_objetivo',
    'sembrar_permisos_botones',
]


# =============================================================================
# CATÁLOGO
# =============================================================================
def definicion_boton(identificador_boton):
    """Definición del catálogo (nombre, descripción, Feature Flag) o None."""
    buscado = str(identificador_boton or '').strip()
    for definicion in BOTONES_CATALOGO:
        if definicion['identificador'] == buscado:
            return definicion
    return None


def nombre_boton(identificador_boton):
    """Nombre legible del botón (el identificador si no está en el catálogo)."""
    definicion = definicion_boton(identificador_boton)
    return definicion['nombre'] if definicion else str(identificador_boton or '')


def clave_feature_flag(identificador_boton):
    """Feature Flag asociado al botón ('' si el botón no tiene flag propio)."""
    definicion = definicion_boton(identificador_boton)
    return str(definicion.get('feature_flag') or '') if definicion else ''


# =============================================================================
# PLAN Y REGLA EFECTIVA
# =============================================================================
def plan_para_permisos(usuario):
    """
    Plan con el que se resuelven las cuotas del usuario.

    `personalizado` se respeta tal cual (tiene sus propias filas); cualquier
    otro valor se resuelve con la fuente de verdad del plan
    (`services/suscripcion.plan_efectivo`, que incluye la herencia del hogar).
    """
    if usuario is None:
        return PLAN_REGLA_FREE

    declarado = str(getattr(usuario, 'plan_suscripcion', '') or '').strip().lower()
    if declarado == suscripcion.PLAN_PERSONALIZADO:
        return PLAN_REGLA_PERSONALIZADO
    return suscripcion.plan_efectivo(usuario)


def _regla_desde_fila(fila, origen):
    """Dict JSON-friendly con la regla de una fila persistida."""
    return {
        'identificador': fila.identificador_boton,
        'nombre': nombre_boton(fila.identificador_boton),
        'permitido': bool(fila.permitido) and fila.limite_usos != 0,
        'limite_usos': fila.limite_usos,
        'ilimitado': fila.es_ilimitado,
        'periodo': fila.periodo,
        'origen': origen,
        'plan': fila.plan,
    }


def _regla_por_defecto(identificador_boton):
    """Regla permisiva del catálogo (sin fila configurada): permitido + ilimitado."""
    return {
        'identificador': identificador_boton,
        'nombre': nombre_boton(identificador_boton),
        'permitido': True,
        'limite_usos': -1,
        'ilimitado': True,
        'periodo': PERIODO_MENSUAL,
        'origen': 'catalogo',
        'plan': '',
    }


def regla_efectiva(usuario, identificador_boton):
    """
    Regla que aplica a `usuario` para `identificador_boton`.

    Fail-open ante un identificador desconocido: un error de tipeo en una vista
    nunca debe apagar una función en producción.
    """
    identificador = str(identificador_boton or '').strip()
    if not identificador:
        return _regla_por_defecto(identificador)

    plan = plan_para_permisos(usuario)

    # a) Regla propia del usuario (plan «Personalizado»).
    if plan == PLAN_REGLA_PERSONALIZADO and getattr(usuario, 'pk', None):
        fila = BotonPermiso.objects.filter(
            identificador_boton=identificador, usuario_id=usuario.pk,
        ).first()
        if fila is not None:
            return _regla_desde_fila(fila, 'usuario')

    # b) Regla del plan base.
    plan_base = plan
    if plan == PLAN_REGLA_PERSONALIZADO:
        # Usuario personalizado sin fila propia: hereda de su plan efectivo.
        plan_base = (
            PLAN_REGLA_PRO if suscripcion.usuario_es_premium(usuario) else PLAN_REGLA_FREE
        )
    fila = BotonPermiso.objects.filter(
        identificador_boton=identificador, plan=plan_base, usuario__isnull=True,
    ).first()
    if fila is not None:
        return _regla_desde_fila(fila, 'plan')

    # c) Sin configuración: catálogo permisivo.
    return _regla_por_defecto(identificador)


def reglas_del_objetivo(plan, usuario=None):
    """
    Todas las reglas del objetivo (usuario puntual o plan base), por botón.

    Las usa el Panel de Permisos del Admin para dibujar la matriz completa: una
    fila por botón del catálogo, con la regla persistida o la de por defecto.
    """
    if usuario is not None:
        filas = {
            fila.identificador_boton: fila
            for fila in BotonPermiso.objects.filter(usuario=usuario)
        }
        origen = 'usuario'
    else:
        filas = {
            fila.identificador_boton: fila
            for fila in BotonPermiso.objects.filter(plan=plan, usuario__isnull=True)
        }
        origen = 'plan'

    reglas = {}
    for definicion in BOTONES_CATALOGO:
        identificador = definicion['identificador']
        fila = filas.get(identificador)
        reglas[identificador] = (
            _regla_desde_fila(fila, origen) if fila is not None
            else _regla_por_defecto(identificador)
        )
    return reglas


# =============================================================================
# SIEMBRA (IDEMPOTENTE) DE LAS REGLAS BASE
# =============================================================================
def sembrar_permisos_botones():
    """
    Crea las reglas base de los planes Free y Pro que falten (idempotente).

    Lo usa `python manage.py seed_data` en cada deploy: así el Panel de Permisos
    siempre tiene las filas de ambos planes. Nace PERMISIVO
    (`permitido=True`, `limite_usos=-1`) y NUNCA pisa lo que el Admin ya
    configuró: nadie pierde una función al desplegar.
    """
    creados, existentes = [], []
    for plan in (PLAN_REGLA_FREE, PLAN_REGLA_PRO):
        for definicion in BOTONES_CATALOGO:
            _, creado = BotonPermiso.objects.get_or_create(
                identificador_boton=definicion['identificador'],
                plan=plan,
                usuario=None,
                defaults={
                    'permitido': True,
                    'limite_usos': -1,
                    'periodo': PERIODO_MENSUAL,
                },
            )
            etiqueta = f"{plan}:{definicion['identificador']}"
            (creados if creado else existentes).append(etiqueta)
    return {'creados': creados, 'existentes': existentes}
