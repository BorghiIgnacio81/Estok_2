"""
ViewSet de monetización: alta de la suscripción Pro y webhook de la pasarela.

Endpoints (los consume el frontend y Mercado Pago):

    POST /api/suscripciones/crear_preferencia/   [JWT]
         Body opcional: { "estok_id": "<uuid>" }
         → {"init_point": "https://...", "monto": "4999.00", ...}
         El frontend redirige a `init_point` (Checkout Pro de Mercado Pago).

    POST /api/suscripciones/webhook/             [PÚBLICO]
         Lo llama Mercado Pago. NO lleva JWT ni CSRF: la única credencial es la
         consulta del pago contra la API de la pasarela con el access token del
         servidor (ver services/suscripcion_pago.procesar_notificacion).

La lógica vive en `inventario/services/suscripcion_pago.py`; acá sólo se traduce
a HTTP. Nunca se activa un plan a partir del cuerpo de la notificación.
"""

import logging

from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from ...services import suscripcion_pago
from ..plan_acceso import estok_id_de

logger = logging.getLogger(__name__)


class SuscripcionViewSet(viewsets.ViewSet):
    """Suscripción Pro: creación del checkout y webhook de confirmación."""

    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['post'], url_path='crear_preferencia')
    def crear_preferencia(self, request):
        """
        Crea la preferencia de Checkout Pro y devuelve la URL de pago.

        El Estok beneficiado se resuelve, en orden: body `estok_id` → header
        `X-Estok-Id` → `user.ultimo_estok_activo`. Si no hay Estok, el plan Pro
        se activa sólo para el usuario.
        """
        estok_id = request.data.get('estok_id') or estok_id_de(request)
        try:
            datos = suscripcion_pago.crear_preferencia(request.user, estok_id)
        except suscripcion_pago.ErrorConfiguracionPago as exc:
            logger.warning(
                'Alta de suscripción sin pasarela configurada (usuario %s): %s',
                request.user.pk, exc,
            )
            return Response(
                {'error': str(exc), 'codigo': 'pasarela_no_configurada'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except suscripcion_pago.ErrorSuscripcion as exc:
            return Response(
                {'error': str(exc), 'codigo': 'pasarela_error'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception:  # pragma: no cover - defensivo
            logger.exception(
                'Error inesperado creando la preferencia de pago (usuario %s)',
                getattr(request.user, 'pk', '?'),
            )
            return Response(
                {'error': 'No se pudo iniciar el pago. Intentá de nuevo más tarde.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(datos, status=status.HTTP_201_CREATED)

    @action(
        detail=False,
        methods=['post'],
        url_path='webhook',
        authentication_classes=[],
        permission_classes=[permissions.AllowAny],
    )
    def webhook(self, request):
        """
        Notificación de Mercado Pago (pública).

        Responde 200 cuando la notificación se procesó (aunque el pago esté
        pendiente) y 503 cuando la pasarela no respondió, para que Mercado Pago
        reintente. El procesamiento es idempotente.
        """
        try:
            resultado = suscripcion_pago.procesar_notificacion(request.data)
        except suscripcion_pago.ErrorSuscripcion as exc:
            logger.warning('Webhook de suscripción no procesado: %s', exc)
            return Response(
                {'ok': False, 'detalle': str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except Exception:  # pragma: no cover - defensivo
            logger.exception(
                'Webhook de suscripción con error inesperado: %s', request.data,
            )
            return Response(
                {'ok': False}, status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        logger.info('Webhook de suscripción procesado: %s', resultado)
        return Response(resultado, status=status.HTTP_200_OK)
