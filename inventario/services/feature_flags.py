"""
Control de Funcionalidades (Feature Flags) — evaluación de acceso.

Traduce el estado de un `FeatureFlag` + el plan del usuario a una DECISIÓN. Es la
única fuente de verdad: ninguna vista debe reimplementar estas reglas.

Orden de evaluación (el mismo que documenta la API):
  1. INTERRUPTOR MAESTRO — `FeatureFlag.is_active(clave)`. Si está apagado la
     funcionalidad no existe para nadie, ni siquiera para el plan Pro.
  2. MODO PROMOCIONAL — si está encendido, la funcionalidad se libera para TODOS
     los usuarios, incluidos los del plan gratuito.
  3. RESTRICCIÓN DE PLAN — si el flag está activo y NO está en modo promocional,
     las claves marcadas como premium exigen plan Pro (`es_premium`).

`evaluar()` devuelve un dict JSON-friendly listo para viajar en la respuesta de
`GET /api/usuarios/me/` y en el cuerpo del 403.
"""

import logging

from ..models import FeatureFlag
from ..models.feature_flags import (
    CAMPOS_MODELO,
    CLAVE_EXPORTACION_CSV,
    CLAVE_EXPORTACION_PDF,
    CLAVE_IA_ILIMITADA,
    CLAVE_SYNC_MERCADOLIBRE,
    FLAGS_ESTANDAR,
    clave_requiere_premium,
)
from . import suscripcion

logger = logging.getLogger(__name__)

# Motivos de la decisión (los consume el frontend para pintar el aviso correcto).
MOTIVO_OK = 'ok'
MOTIVO_DESHABILITADA = 'funcionalidad_deshabilitada'
MOTIVO_PREMIUM = 'requiere_plan_pro'

MENSAJE_DESHABILITADA = (
    'Esta función está deshabilitada temporalmente por el administrador.'
)
MENSAJE_PREMIUM = (
    'Esta función es exclusiva del plan Pro. Activá tu plan para usarla.'
)

__all__ = [
    'CLAVE_EXPORTACION_CSV',
    'CLAVE_EXPORTACION_PDF',
    'CLAVE_IA_ILIMITADA',
    'CLAVE_SYNC_MERCADOLIBRE',
    'MOTIVO_DESHABILITADA',
    'MOTIVO_OK',
    'MOTIVO_PREMIUM',
    'en_modo_promocional',
    'estado_para_usuario',
    'evaluar',
    'flag_activo',
    'sembrar_flags_estandar',
]


def flag_activo(clave):
    """Atajo: True si el interruptor maestro de la funcionalidad está encendido."""
    return FeatureFlag.is_active(clave)


def en_modo_promocional(clave):
    """Atajo: True si la funcionalidad está liberada para todos (campaña)."""
    return FeatureFlag.en_modo_promocional(clave)


def evaluar(clave, usuario, estok_id=None):
    """
    Decide si `usuario` puede usar la funcionalidad `clave` en el Estok dado.

    Devuelve:
        {
          'clave', 'nombre', 'permitido', 'motivo', 'mensaje',
          'activo_global', 'modo_promocional', 'requiere_premium', 'es_premium'
        }

    Las claves inexistentes en la base y en el catálogo NO bloquean (fail-open):
    un error de tipeo en una vista nunca debe apagar una función en producción.
    """
    return _decidir(clave, FeatureFlag.obtener(clave), usuario, estok_id)


def _decidir(clave, flag, usuario, estok_id=None, es_premium=None):
    """
    Núcleo de la decisión (permite reutilizar el flag y el plan ya resueltos).

    `estado_para_usuario()` lo usa para no repetir consultas: resuelve TODOS los
    flags en una sola query y el plan premium una sola vez.
    """
    if flag is None:
        return {
            'clave': '',
            'nombre': '',
            'permitido': True,
            'motivo': MOTIVO_OK,
            'mensaje': '',
            'activo_global': True,
            'modo_promocional': True,
            'requiere_premium': False,
            'es_premium': False,
        }

    requiere_premium = clave_requiere_premium(flag.clave)
    if es_premium is None:
        es_premium = suscripcion.usuario_es_premium(usuario, estok_id)

    if not flag.activo_global:
        # 1. Interruptor maestro apagado: no hay función para nadie.
        permitido, motivo, mensaje = False, MOTIVO_DESHABILITADA, MENSAJE_DESHABILITADA
    elif flag.modo_promocional or es_premium or not requiere_premium:
        # 2. Promoción libre o 3a. Usuario Pro / función no premium.
        permitido, motivo, mensaje = True, MOTIVO_OK, ''
    else:
        # 3b. Restricción normal del plan.
        permitido, motivo, mensaje = False, MOTIVO_PREMIUM, MENSAJE_PREMIUM

    return {
        'clave': flag.clave,
        'nombre': flag.nombre,
        'permitido': permitido,
        'motivo': motivo,
        'mensaje': mensaje,
        'activo_global': bool(flag.activo_global),
        'modo_promocional': bool(flag.modo_promocional),
        'requiere_premium': requiere_premium,
        'es_premium': es_premium,
    }


def _flags_persistidos():
    """
    Flags cargados en la base, indexados por clave (UNA sola query).

    Se usa en todas las evaluaciones masivas (`/me/`) para no hacer N consultas.
    """
    try:
        return {flag.clave: flag for flag in FeatureFlag.objects.all()}
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning('No se pudieron leer los Feature Flags: %s', exc)
        return {}


def estado_para_usuario(usuario, estok_id=None):
    """
    Estado de TODAS las funcionalidades para un usuario.

    Es el bloque `feature_flags` de `GET /api/usuarios/me/`: el frontend ajusta
    la UI (botones de IA, exportación, ML) y la publicidad sin adivinar planes.

    Optimizado para el endpoint más caliente de la API: resuelve el plan premium
    UNA vez y todos los flags en UNA sola query.
    """
    persistidos = _flags_persistidos()
    es_premium = suscripcion.usuario_es_premium(usuario, estok_id)

    claves = [definicion['clave'] for definicion in FLAGS_ESTANDAR]
    for clave in persistidos:
        if clave not in claves:
            claves.append(clave)

    estado = {}
    for clave in claves:
        flag = persistidos.get(clave) or FeatureFlag.transitorio(clave)
        decision = _decidir(clave, flag, usuario, estok_id, es_premium)
        estado[clave] = {
            'nombre': decision['nombre'],
            'activo_global': decision['activo_global'],
            'modo_promocional': decision['modo_promocional'],
            'requiere_premium': decision['requiere_premium'],
            'habilitado': decision['permitido'],
            'motivo': decision['motivo'],
        }
    return estado


def sembrar_flags_estandar():
    """
    Crea las filas estándar que falten (idempotente).

    Lo usa `python manage.py seed_data`, que corre en cada deploy: así el panel
    del Admin Global siempre tiene los switches disponibles. NO toca los valores
    de las filas existentes (jamás pisa lo que el Admin ya configuró).
    """
    creados, existentes = [], []
    for definicion in FLAGS_ESTANDAR:
        defaults = {
            campo: definicion[campo]
            for campo in CAMPOS_MODELO
            if campo in definicion
        }
        _, creado = FeatureFlag.objects.get_or_create(
            clave=definicion['clave'],
            defaults=defaults,
        )
        if creado:
            creados.append(definicion['clave'])
        else:
            existentes.append(definicion['clave'])
    return {'creados': creados, 'existentes': existentes}
