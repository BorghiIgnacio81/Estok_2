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

