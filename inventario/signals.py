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
"""

import logging

from django.contrib.auth.signals import user_logged_in
from django.db.models import F
from django.db.models.signals import post_save
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
