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
    Genera un code_verifier PKCE y lo guarda en sesión.
    """
    try:
        auth_url, code_verifier = get_auth_url()
        # Guardar code_verifier en sesión para usarlo en el callback
        request.session["ml_code_verifier"] = code_verifier
        request.session.set_expiry(600)  # 10 minutos
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

    # Recuperar code_verifier de la sesión (PKCE)
    code_verifier = request.session.pop("ml_code_verifier", None)

    token_data = exchange_code_for_token(code, code_verifier=code_verifier)
    if not token_data:
        return Response(
            {"error": "No se pudo obtener el token de MercadoLibre"},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    token = save_token(token_data)
    if not token:
        return Response(
            {"error": "No se pudo guardar el token en la base de datos"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    logger.info("MercadoLibre autorizado exitosamente (user_id=%s)", token.user_id)
    return Response({
        "mensaje": "MercadoLibre autorizado exitosamente",
        "user_id": token.user_id,
        "expires_in": token.expires_in,
    })


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
