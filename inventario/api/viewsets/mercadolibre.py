"""
ViewSets para la integración con MercadoLibre OAuth.
Provee endpoints para:
  - Iniciar el flujo OAuth (redirigir a ML)
  - Callback donde ML devuelve el código
  - Verificar estado del token
"""

import logging

from django.http import HttpResponseRedirect, HttpResponse
from django.urls import reverse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from inventario.services import mercadolibre_oauth as ml_oauth

logger = logging.getLogger(__name__)


@api_view(['GET'])
@permission_classes([AllowAny])
def iniciar_oauth(request):
    """
    Endpoint para iniciar el flujo OAuth de MercadoLibre.
    Redirige al usuario a la página de autorización de MercadoLibre.
    
    GET /api/mercadolibre/auth/
    """
    try:
        auth_url = ml_oauth.generar_url_autorizacion()
        return HttpResponseRedirect(auth_url)
    except ValueError as e:
        return Response(
            {"error": str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['GET'])
@permission_classes([AllowAny])
def callback_oauth(request):
    """
    Callback de MercadoLibre OAuth.
    MercadoLibre redirige aquí después de que el usuario autoriza la app.
    
    GET /api/mercadolibre/callback/?code=...&state=...
    """
    code = request.GET.get('code')
    error = request.GET.get('error')

    if error:
        logger.error("Error en callback OAuth de ML: %s", error)
        return HttpResponse(
            f"<html><body><h3>Error al autorizar MercadoLibre</h3>"
            f"<p>{error}</p>"
            f"<p>Podés cerrar esta ventana y volver a intentar.</p></body></html>"
        )

    if not code:
        return HttpResponse(
            "<html><body><h3>Error</h3>"
            "<p>No se recibió el código de autorización.</p></body></html>"
        )

    try:
        # Canjear el código por tokens
        token_data = ml_oauth.canjear_codigo_por_token(code)
        
        # Guardar en base de datos
        ml_oauth.guardar_token(token_data)

        logger.info("✅ MercadoLibre OAuth completado exitosamente")

        # Mostrar página de éxito
        return HttpResponse(
            "<html><body>"
            "<h3>✅ MercadoLibre conectado exitosamente</h3>"
            "<p>Ya podés usar la búsqueda de precios de referencia.</p>"
            "<p>Podés cerrar esta ventana.</p>"
            "<script>window.close();</script>"
            "</body></html>"
        )

    except Exception as e:
        logger.error("Error en callback OAuth: %s", e)
        return HttpResponse(
            f"<html><body><h3>Error al conectar con MercadoLibre</h3>"
            f"<p>{str(e)}</p>"
            f"<p>Podés cerrar esta ventana y volver a intentar.</p></body></html>"
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def estado_token(request):
    """
    Verifica el estado del token de MercadoLibre.
    
    GET /api/mercadolibre/estado/
    """
    estado = ml_oauth.verificar_estado_token()
    return Response(estado)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def desconectar(request):
    """
    Elimina el token de MercadoLibre de la base de datos.
    
    POST /api/mercadolibre/desconectar/
    """
    from inventario.models import MercadoLibreToken
    MercadoLibreToken.objects.all().delete()
    logger.info("Token de MercadoLibre eliminado")
    return Response({"mensaje": "MercadoLibre desconectado exitosamente."})
