"""
ViewSet para el flujo OAuth de MercadoLibre.
Proporciona endpoints para autorizar, recibir callback, ver estado y desconectar.
"""

import logging

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import redirect

from ...services.mercadolibre_oauth import (
    get_auth_url,
    exchange_code_for_token,
    save_token,
    get_valid_access_token,
    delete_token,
    get_client_id,
    get_client_secret,
)

logger = logging.getLogger(__name__)


@api_view(["GET"])
@permission_classes([AllowAny])
def iniciar_oauth(request):
    """
    Redirige al usuario a MercadoLibre para autorizar la app.
    GET /api/mercadolibre/auth/
    El code_verifier PKCE se codifica dentro del state que ML devuelve en el callback.
    """
    try:
        auth_url, _ = get_auth_url()
        return redirect(auth_url)
    except ValueError as e:
        return Response(
            {"error": str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["GET"])
@permission_classes([AllowAny])
def callback_oauth(request):
    """
    Callback donde MercadoLibre devuelve el código de autorización.
    GET /api/mercadolibre/callback/?code=...&state=...
    """
    code = request.GET.get("code")
    error = request.GET.get("error")

    if error:
        logger.error("Error en callback de ML: %s", error)
        return Response(
            {"error": f"MercadoLibre respondió con error: {error}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not code:
        return Response(
            {"error": "No se recibió el código de autorización"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Extraer code_verifier del state (PKCE)
    # El state tiene formato: "estok_ml_auth:<code_verifier>"
    state = request.GET.get("state", "")
    code_verifier = None
    if ":" in state:
        code_verifier = state.split(":", 1)[1]

    token_data = exchange_code_for_token(code, code_verifier=code_verifier)
    if not token_data:
        logger.error("No se pudo obtener el token de MercadoLibre")
        return redirect("/?ml_error=token_exchange_failed")

    token = save_token(token_data)
    if not token:
        logger.error("No se pudo guardar el token en la base de datos")
        return redirect("/?ml_error=save_failed")

    logger.info("MercadoLibre autorizado exitosamente (user_id=%s)", token.user_id)
    return redirect("/?ml_success=true")


@api_view(["GET"])
@permission_classes([AllowAny])
def estado_token(request):
    """
    Verifica el estado del token de MercadoLibre.
    GET /api/mercadolibre/estado/
    """
    client_id = get_client_id()
    client_secret = get_client_secret()

    config_status = {
        "client_id_configurado": bool(client_id),
        "client_secret_configurado": bool(client_secret),
    }

    access_token = get_valid_access_token()
    if access_token:
        from ...models import MercadoLibreToken
        token = MercadoLibreToken.objects.first()
        return Response({
            "conectado": True,
            "user_id": token.user_id if token else None,
            "configuracion": config_status,
        })

    return Response({
        "conectado": False,
        "configuracion": config_status,
        "mensaje": "No hay token. Visita /api/mercadolibre/auth/ para autorizar.",
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def desconectar(request):
    """
    Elimina el token de MercadoLibre.
    POST /api/mercadolibre/desconectar/
    """
    if delete_token():
        return Response({"mensaje": "Token de MercadoLibre eliminado"})
    return Response(
        {"error": "No había token para eliminar"},
        status=status.HTTP_404_NOT_FOUND,
    )
