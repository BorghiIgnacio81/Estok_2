"""
Servicio de Decisiones: apertura y resolución de votaciones democráticas.

Cubre la regla de negocio CRÍTICA del alta de objetos:

    Dueño original LLENO (usuario o dueño externo en texto plano)
    + Beneficiario VACÍO
    = VOTACIÓN PENDIENTE para TODOS los miembros activos del Estok.

La apertura se dispara SOLO desde `crear_votacion_pendiente()` (invocada por la
señal post_save de Objeto) para que exista una única fuente de verdad, sin
lógica duplicada en serializers, viewset y admin.

Funciones puras de cálculo (mayorías, conteos) separadas de la persistencia.
"""

import logging

from django.db import transaction

from ..models import DecisionVotacion, Membresia, Objeto, VotoDecision

logger = logging.getLogger(__name__)


# =============================================================================
# REGLA DE NEGOCIO: ¿HACE FALTA VOTAR?
# =============================================================================

def tiene_dueno(objeto):
    """True si el objeto tiene dueño original cargado (usuario o externo)."""
    return bool(objeto.dueno_original_id) or bool((objeto.dueno_externo_nombre or '').strip())


def tiene_beneficiario(objeto):
    """True si el objeto ya tiene un beneficiario designado."""
    return bool(objeto.beneficiario_id)


def requiere_votacion(objeto):
    """Dueño lleno + Beneficiario vacío ⇒ el Estok debe votar."""
    return tiene_dueno(objeto) and not tiene_beneficiario(objeto)


# =============================================================================
# APERTURA DE LA VOTACIÓN
# =============================================================================

def crear_votacion_pendiente(objeto, creado_por=None, forzar=False):
    """
    Abre la votación pendiente del objeto si corresponde.

    Idempotente: si el objeto YA tiene una votación (pendiente o resuelta) no
    crea otra. Eso evita bucles con la señal post_save cuando el propio cierre
    de la votación guarda el objeto.
    """
    if objeto.deleted_at is not None:
        return None
    if not forzar and not requiere_votacion(objeto):
        return None
    if DecisionVotacion.objects.filter(objeto=objeto).exists():
        return None

    votacion = DecisionVotacion.objects.create(
        objeto=objeto,
        estok=objeto.estok,
        motivo=DecisionVotacion.MOTIVO_SIN_BENEFICIARIO,
        estado=DecisionVotacion.ESTADO_PENDIENTE,
        creada_por=creado_por,
    )
    logger.info(
        "Votación pendiente abierta para el objeto %s (Estok %s)", objeto.id, objeto.estok_id
    )
    return votacion


# =============================================================================
# PADRÓN DE VOTANTES (TENANT X-Estok-Id)
# =============================================================================

def votantes_activos(estok_id):
    """
    Usuarios con Membresia en el Estok: el padrón democrático del tenant.

    Un usuario sin Estok (None) no tiene padrón: lista vacía.
    """
    if not estok_id:
        return []
    return list(
        Membresia.objects.filter(estok_id=estok_id, usuario__is_active=True)
        .select_related('usuario', 'role')
        .values_list('usuario', flat=True)
    )


def total_votantes(estok_id):
    return len(votantes_activos(estok_id))



# =============================================================================
# CÁLCULO DEMOCRÁTICO (PURO)
# =============================================================================

def calcular_resultado(votacion, total_padron=None):
    """
    Conteos y opción ganadora de una votación.

    Ganadora = opción con más votos, SIEMPRE que no haya empate en el primer
    puesto. Un empate deja la votación pendiente (nadie gana por sorteo).
    Devuelve un dict serializable listo para `DecisionVotacion.resultado`.
    """
    votos = list(votacion.votos.select_related('beneficiario', 'usuario'))

    conteo = {clave: 0 for clave, _ in DecisionVotacion.OPCION_CHOICES}
    beneficiarios = {}
    for voto in votos:
        if voto.opcion in conteo:
            conteo[voto.opcion] += 1
        if voto.opcion == DecisionVotacion.OPCION_ASIGNAR_BENEFICIARIO and voto.beneficiario_id:
            clave = str(voto.beneficiario_id)
            entrada = beneficiarios.setdefault(
                clave,
                {
                    'beneficiario_id': clave,
                    'beneficiario_nombre': _nombre_usuario(voto.beneficiario),
                    'votos': 0,
                },
            )
            entrada['votos'] += 1

    padron = total_padron if total_padron is not None else total_votantes(votacion.estok_id)

    top = max(conteo.values()) if conteo else 0
    ganadoras = [clave for clave, valor in conteo.items() if valor > 0 and valor == top]
    opcion_ganadora = ganadoras[0] if len(ganadoras) == 1 else None

    beneficiario_ganador = None
    if opcion_ganadora == DecisionVotacion.OPCION_ASIGNAR_BENEFICIARIO and beneficiarios:
        top_ben = max(e['votos'] for e in beneficiarios.values())
        empatados = [e for e in beneficiarios.values() if e['votos'] == top_ben]
        if len(empatados) == 1:
            beneficiario_ganador = empatados[0]

    return {
        'conteo': conteo,
        'total_votos': len(votos),
        'total_votantes': padron,
        'votos_faltantes': max(0, padron - len(votos)),
        'opcion_ganadora': opcion_ganadora,
        'beneficiario_ganador': beneficiario_ganador,
    }


def _nombre_usuario(usuario):
    if usuario is None:
        return None
    return usuario.get_full_name() or usuario.username or usuario.email


def _empate_decisivo(resultado):
    """True cuando el primer puesto está empatado y nadie puede ganar aún."""
    conteo = resultado.get('conteo') or {}
    top = max(conteo.values()) if conteo else 0
    if top == 0:
        return False
    return sum(1 for valor in conteo.values() if valor == top) > 1


# =============================================================================
# VOTAR
# =============================================================================

@transaction.atomic
def registrar_voto(votacion, usuario, opcion, beneficiario=None, comentario=''):
    """
    Registra (o actualiza) el voto de un miembro del padrón.

    Un usuario tiene UN solo voto por votación. Si votaron todos los miembros
    activos y hay ganador claro, la votación se resuelve y se aplica al objeto.
    """
    if not votacion.esta_pendiente:
        return votacion, 'La votación ya fue cerrada.'

    if opcion not in dict(DecisionVotacion.OPCION_CHOICES):
        return votacion, 'Opción de voto inválida.'

    if opcion == DecisionVotacion.OPCION_ASIGNAR_BENEFICIARIO and beneficiario is None:
        return votacion, 'Para asignar un beneficiario hay que elegir uno.'

    VotoDecision.objects.update_or_create(
        votacion=votacion,
        usuario=usuario,
        defaults={
            'opcion': opcion,
            'beneficiario': beneficiario,
            'comentario': comentario or '',
        },
    )

    resultado = calcular_resultado(votacion)
    votacion.resultado = resultado
    votacion.save(update_fields=['resultado', 'updated_at'])

    if resultado['votos_faltantes'] > 0:
        return votacion, None

    if resultado['opcion_ganadora'] is None or _empate_decisivo(resultado):
        return votacion, 'Empate: hace falta un voto más para desempatar.'

    if (
        resultado['opcion_ganadora'] == DecisionVotacion.OPCION_ASIGNAR_BENEFICIARIO
        and not resultado['beneficiario_ganador']
    ):
        return votacion, 'Empate entre beneficiarios propuestos: hace falta desempatar.'

    aplicar_resultado(votacion, resultado)
    return votacion, None

# =============================================================================
# CIERRE Y APLICACIÓN DE LA DECISIÓN
# =============================================================================

@transaction.atomic
def aplicar_resultado(votacion, resultado):
    """
    Aplica la decisión ganadora al Objeto y cierra la votación.

    - 'asignar_beneficiario' → completa `objeto.beneficiario` (Dueño lleno +
      Beneficiario lleno: deja de requerir votación).
    - 'vender' / 'conservar' / 'tirar' → persiste `objeto.owner_action`.
    """
    objeto = votacion.objeto
    opcion = resultado.get('opcion_ganadora')
    ganador = resultado.get('beneficiario_ganador') or {}
    campos = []

    if opcion == DecisionVotacion.OPCION_ASIGNAR_BENEFICIARIO and ganador.get('beneficiario_id'):
        objeto.beneficiario_id = ganador['beneficiario_id']
        campos.append('beneficiario')
    elif opcion in dict(Objeto.OWNER_ACTION_CHOICES):
        objeto.owner_action = opcion
        campos.append('owner_action')

    if campos:
        objeto.save(update_fields=campos)

    resultado['aplicado'] = bool(campos)
    votacion.cerrar(resultado)
    logger.info(
        "Votación %s resuelta para el objeto %s (opción=%s, campos=%s)",
        votacion.id, objeto.id, opcion, campos,
    )
    return votacion


def cerrar_votacion(votacion):
    """Cierra manualmente la votación aplicando el resultado vigente."""
    resultado = calcular_resultado(votacion)
    resultado['cierre_manual'] = True
    return aplicar_resultado(votacion, resultado)


# =============================================================================
# LECTURA (API / UI)
# =============================================================================

def votaciones_pendientes(estok_id):
    """Votaciones abiertas del tenant, listas para votar."""
    return (
        DecisionVotacion.objects.filter(
            estok_id=estok_id, estado=DecisionVotacion.ESTADO_PENDIENTE
        )
        .select_related('objeto', 'estok', 'creada_por')
        .order_by('-created_at')
    )


def serializar_votacion(votacion, usuario=None):
    """
    Representación plana de una votación (la consume la pestaña Decisiones).

    100% tolerante a datos faltantes: nunca lanza si el objeto o el Estok
    fueron borrados a medias.
    """
    resultado = votacion.resultado or calcular_resultado(votacion)
    objeto = votacion.objeto
    dueno = None
    if objeto is not None:
        dueno = _nombre_usuario(objeto.dueno_original) or (objeto.dueno_externo_nombre or None)

    votos = [
        {
            'id': str(voto.id),
            'usuario': str(voto.usuario_id),
            'usuario_nombre': _nombre_usuario(voto.usuario),
            'opcion': voto.opcion,
            'opcion_label': voto.get_opcion_display(),
            'beneficiario': str(voto.beneficiario_id) if voto.beneficiario_id else None,
            'beneficiario_nombre': _nombre_usuario(voto.beneficiario),
            'comentario': voto.comentario,
            'fecha': voto.created_at.isoformat() if voto.created_at else None,
        }
        for voto in votacion.votos.select_related('usuario', 'beneficiario')
    ]

    mi_voto = None
    if usuario is not None and getattr(usuario, 'is_authenticated', False):
        mi_voto = next((v for v in votos if v['usuario'] == str(usuario.id)), None)

    return {
        'id': str(votacion.id),
        'estado': votacion.estado,
        'motivo': votacion.motivo,
        'motivo_label': votacion.get_motivo_display(),
        'objeto_id': str(objeto.id) if objeto is not None else None,
        'objeto_nombre': objeto.nombre if objeto is not None else None,
        'objeto_dueno': dueno,
        'objeto_beneficiario': (
            _nombre_usuario(objeto.beneficiario) if objeto is not None else None
        ),
        'conteo': resultado.get('conteo') or {},
        'total_votos': resultado.get('total_votos', 0),
        'total_votantes': resultado.get('total_votantes', 0),
        'votos_faltantes': resultado.get('votos_faltantes', 0),
        'opcion_ganadora': resultado.get('opcion_ganadora'),
        'beneficiario_ganador': resultado.get('beneficiario_ganador'),
        'votos': votos,
        'mi_voto': mi_voto,
        'resuelta_en': votacion.resuelta_en.isoformat() if votacion.resuelta_en else None,
        'created_at': votacion.created_at.isoformat() if votacion.created_at else None,
    }

