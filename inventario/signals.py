"""
Señales de la aplicación inventario.

1) Contador de inicios de sesión exitosos (control de adopción en lanzamiento).

   La señal nativa `user_logged_in` de Django se dispara automáticamente solo
   en flujos que pasan por `django.contrib.auth.login()` (por ejemplo, el admin
   de Django). Como la app real se autentica por JWT (SimpleJWT), el login
   POST /api/token/ re-emite esta misma señal de forma explícita
   (ver inventario/api/viewsets/auth.py) para que este receptor sea la ÚNICA
   fuente de verdad del incremento (sin lógica duplicada).

2) Apertura automática de la VOTACIÓN PENDIENTE del módulo de Decisiones.

   Regla de negocio: si un Objeto queda con DUEÑO ORIGINAL (usuario o dueño
   externo en texto plano) y SIN BENEFICIARIO, todo el Estok debe votar el
   destino del objeto. La lógica real vive en
   `services/decisiones_service.crear_votacion_pendiente()` (idempotente y sin
   lógica duplicada); acá solo se conecta la señal.

3) SINCRONIZACIÓN DE LA PUBLICACIÓN EN MERCADO LIBRE (stock / baja).

   Si un objeto PUBLICADO en Mercado Libre cambia a vendido (envío despachado)
   o su stock queda en 0 → la publicación se PAUSA (`status: paused`).
   Si el objeto se elimina (soft delete: `deleted_at`) → se CIERRA
   (`status: closed`). La traducción estado→acción y el PUT viven en
   `services/mercadolibre_publicacion.py` (única fuente de verdad); acá solo se
   detecta el CAMBIO comparando una foto tomada en pre_save con el estado de
   post_save, para no golpear la API en cada guardado. Es best-effort: nunca
   interrumpe el guardado del objeto.
"""

import logging

from django.contrib.auth.signals import user_logged_in
from django.db import transaction
from django.db.models import F
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(user_logged_in)
def incrementar_login_count(sender, user, **kwargs):
    """
    Incrementa en +1 el campo login_count del usuario autenticado.

    Usa F('login_count') + 1 → UPDATE atómico en base de datos (seguro ante
    dos logins simultáneos y sin re-disparar save()/señales redundantes).
    Si por cualquier motivo falla, se loguea y NUNCA interrumpe el login.
    """
    try:
        model_class = type(user)
        model_class.objects.filter(pk=user.pk).update(
            login_count=F('login_count') + 1
        )
        logger.debug(
            'login_count incrementado para %s (id=%s).',
            getattr(user, 'username', '?'),
            user.pk,
        )
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning(
            'No se pudo incrementar login_count de %s: %s',
            getattr(user, 'username', '?'),
            exc,
        )


@receiver(post_save, sender='inventario.Objeto')
def abrir_votacion_pendiente_si_corresponde(sender, instance, **kwargs):
    """
    Gatilla la VOTACIÓN PENDIENTE del módulo de Decisiones.

    Condición (regla de negocio): dueño original lleno + beneficiario vacío.
    `crear_votacion_pendiente` es idempotente y valida la condición, así que
    este receptor puede dispararse en cada save() sin efectos colaterales.
    Un fallo acá NUNCA debe romper el guardado del objeto.
    """
    try:
        from .services.decisiones_service import crear_votacion_pendiente

        crear_votacion_pendiente(instance)
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning(
            'No se pudo abrir la votación pendiente del objeto %s: %s',
            getattr(instance, 'pk', '?'),
            exc,
        )


# =============================================================================
# MERCADO LIBRE · PAUSA / BAJA AUTOMÁTICA DE LA PUBLICACIÓN
# =============================================================================
@receiver(pre_save, sender='inventario.Objeto')
def recordar_publicacion_ml_previa(sender, instance, **kwargs):
    """
    Guarda una foto del estado ANTERIOR (el que está en la base) antes de cada
    save() del objeto.

    IMPORTANTE: el `instance` que llega a pre_save YA trae los valores NUEVOS;
    por eso el estado anterior se lee de la base (consulta por PK, barata). Sin
    esta foto no se puede saber si el guardado CAMBIÓ algo relevante para
    Mercado Libre (eliminado / vendido / stock). El snapshot se guarda en un
    atributo efímero del objeto y nunca se persiste.
    """
    try:
        from .services.mercadolibre_publicacion import instantanea_sincronizacion

        if getattr(instance, 'pk', None) is None:
            instance._mercadolibre_publicacion_previa = None
            return
        anterior = type(instance).objects.filter(pk=instance.pk).first()
        instance._mercadolibre_publicacion_previa = (
            instantanea_sincronizacion(anterior) if anterior is not None else None
        )
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning(
            'No se pudo registrar el estado previo de ML del objeto %s: %s',
            getattr(instance, 'pk', '?'),
            exc,
        )


@receiver(post_save, sender='inventario.Objeto')
def sincronizar_publicacion_ml(sender, instance, created, **kwargs):
    """
    Pausa (vendido / sin stock) o cierra (eliminado) la publicación en ML.

    Solo actúa cuando el save() CAMBIÓ alguno de los datos relevantes y el
    objeto está publicado. El PUT se difiere con `transaction.on_commit` para no
    llamar a Mercado Libre si la transacción termina en rollback.
    """
    if created:
        return
    try:
        from .services.mercadolibre_publicacion import (
            cambio_requiere_sincronizacion,
            instantanea_sincronizacion,
            sincronizar_publicacion,
        )

        previa = getattr(instance, '_mercadolibre_publicacion_previa', None)
        actual = instantanea_sincronizacion(instance)
        if not cambio_requiere_sincronizacion(previa, actual):
            return

        # `on_commit` ejecuta en el acto cuando no hay bloque atómico abierto.
        transaction.on_commit(lambda: sincronizar_publicacion(instance))
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning(
            'No se pudo sincronizar la publicación de ML del objeto %s: %s',
            getattr(instance, 'pk', '?'),
            exc,
        )


# =============================================================================
# COHERENCIA CAJA ⇄ CONTENEDOR EN CUALQUIER ESCRITURA DE OBJETO
# =============================================================================
@receiver(post_save, sender='inventario.Objeto')
def asegurar_clasificacion_de_caja(sender, instance, **kwargs):
    """
    Garantiza que TODO Objeto que sea una caja quede marcado como contenedor.

    PROBLEMA QUE RESUELVE
        Las «Cajas 02…05» creadas por el alta rápida quedaron en la base con
        `es_contenedor=False` y sin categoría: la API las devolvía como OBJETOS
        SUELTOS y ni el backend ni la canasta las reconocían como cajas. La
        coherencia sólo se aplicaba en el POST/PUT de `/objetos/`, así que
        cualquier otro camino de escritura (mudanza inter-Estok, alta por IA,
        espejo de contenedor, comandos de datos) podía degradar la caja.

    REGLA ÚNICA
        `services/clasificacion_contenedor_objeto.asegurar_clasificacion_contenedor`
        (idempotente y no destructiva): si el registro es caja por marca,
        categoría, rótulo que EMPIEZA por «Caja» o alta rápida, fuerza
        `es_contenedor=True` y le asigna «Cajas y Contenedores» SÓLO si no
        tenía categoría.

    CORTE CIRCUITO
        Se sale sin consultar nada cuando el registro ya está completo
        (`es_contenedor=True` + categoría) y cuando es el espejo de dualidad de
        un Contenedor (su caja real ya es un chip propio: marcarlo duplicaría
        el bulto en las pestañas de cajas). El `save(update_fields=…)` que hace
        el servicio vuelve a entrar acá y corta por el primer guardia.
    """
    if instance.es_contenedor and instance.categoria_id is not None:
        return
    if (instance.especificaciones or {}).get('es_espejo_contenedor'):
        return
    try:
        from .services.clasificacion_contenedor_objeto import (
            asegurar_clasificacion_contenedor,
        )

        asegurar_clasificacion_contenedor(instance)
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning(
            'No se pudo asegurar la clasificación de caja del objeto %s: %s',
            getattr(instance, 'pk', '?'),
            exc,
        )


# =============================================================================
# HERENCIA DE PUBLICIDAD DEL PLAN PRO (Gratuito con Ads vs. Pro)
# =============================================================================
# REGLA DE NEGOCIO: si un usuario pertenece a un Estok/Hogar cuyo CREADOR es
# premium, todos sus miembros heredan `ocultar_publicidad = True`.
#
# La resolución real vive en `services/suscripcion.py` (única fuente de verdad).
# Acá sólo se detecta el CAMBIO del plan comparando una foto tomada en pre_save,
# para no golpear la base en cada guardado intrascendente (perfil, presencia,
# etc.). Toda la propagación usa `queryset.update()`, que NO dispara señales:
# por diseño es imposible entrar en recursión.
# =============================================================================
@receiver(pre_save, sender='inventario.CustomUser')
def capturar_plan_previo_usuario(sender, instance, **kwargs):
    """Guarda el plan anterior del usuario para detectar cambios reales."""
    if not instance.pk:
        instance._plan_previo = None
        return
    instance._plan_previo = sender.objects.filter(pk=instance.pk).values(
        'es_premium', 'plan_suscripcion',
    ).first()


@receiver(post_save, sender='inventario.CustomUser')
def heredar_publicidad_del_hogar(sender, instance, created, **kwargs):
    """
    Alinea `ocultar_publicidad` del usuario y de sus hogares cuando cambia el plan.

    - Cambió `es_premium` / `plan_suscripcion` del usuario → se recalcula su
      propio flag y se re-propaga a los hogares que él creó (sus miembros
      heredan el plan Pro del creador).
    """
    if created:
        return
    previo = getattr(instance, '_plan_previo', None)
    if not previo:
        return
    if (
        previo.get('es_premium') == instance.es_premium
        and previo.get('plan_suscripcion') == instance.plan_suscripcion
    ):
        return

    try:
        from .services.suscripcion import (
            sincronizar_publicidad_estok,
            sincronizar_publicidad_usuario,
        )

        sincronizar_publicidad_usuario(instance)
        for estok in instance.estoks_creados.all():
            sincronizar_publicidad_estok(estok)
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning(
            'No se pudo propagar el plan de %s a sus hogares: %s',
            getattr(instance, 'username', '?'),
            exc,
        )


@receiver(pre_save, sender='inventario.Estok')
def capturar_plan_previo_estok(sender, instance, **kwargs):
    """Guarda el plan/creador anterior del Estok para detectar cambios reales."""
    if not instance.pk:
        instance._plan_previo = None
        return
    instance._plan_previo = sender.objects.filter(pk=instance.pk).values(
        'es_premium', 'creador_id',
    ).first()


@receiver(post_save, sender='inventario.Estok')
def heredar_publicidad_al_guardar_estok(sender, instance, **kwargs):
    """Propaga el plan del hogar a TODOS sus miembros cuando el plan cambia."""
    previo = getattr(instance, '_plan_previo', None)
    if previo is not None:
        if (
            previo.get('es_premium') == instance.es_premium
            and previo.get('creador_id') == instance.creador_id
        ):
            return

    try:
        from .services.suscripcion import sincronizar_publicidad_estok

        sincronizar_publicidad_estok(instance)
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning(
            'No se pudo propagar el plan del Estok %s: %s',
            getattr(instance, 'pk', '?'),
            exc,
        )


@receiver(post_save, sender='inventario.Membresia')
def heredar_publicidad_al_unirse(sender, instance, **kwargs):
    """
    Al unirse a un hogar premium, el miembro hereda `ocultar_publicidad = True`.

    Cubre el alta de la Membresia (nuevo miembro, código de invitación, o
    Membresia creada junto al Estok), donde el usuario todavía no tenía el flag.
    """
    try:
        from .services.suscripcion import sincronizar_publicidad_usuario

        sincronizar_publicidad_usuario(getattr(instance, 'usuario', None))
    except Exception as exc:  # pragma: no cover - defensivo
        logger.warning(
            'No se pudo heredar la publicidad en la Membresia %s: %s',
            getattr(instance, 'pk', '?'),
            exc,
        )


