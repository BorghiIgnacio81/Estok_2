"""
ViewSet para autenticación y publicación en MercadoLibre.
"""

import logging

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import redirect

from ...models import CustomUser
from ...services.mercadolibre_oauth import (
    get_auth_url, has_valid_token, delete_token,
)
from ...services.mercadolibre_api import upload_picture, create_item
from ...models import Objeto
from .base import HasRolePermission

logger = logging.getLogger(__name__)


class MercadoLibreViewSet(viewsets.ViewSet):
    """
    Endpoints relacionados con MercadoLibre.
    - GET /api/mercadolibre/auth-status/ → verifica si el usuario tiene token válido
    - GET /api/mercadolibre/auth-url/ → devuelve URL de autorización para conectar cuenta
    - DELETE /api/mercadolibre/disconnect/ → desconecta la cuenta de ML
    """
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_permissions(self):
        if self.action in ('auth_status', 'auth_url', 'disconnect', 'callback'):
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    @action(detail=False, methods=['get'])
    def auth_status(self, request):
        """
        Verifica si el usuario actual tiene una cuenta de MercadoLibre conectada.
        GET /api/mercadolibre/auth-status/
        """
        conectado = has_valid_token(request.user)
        return Response({
            "conectado": conectado,
        })

    @action(detail=False, methods=['get'])
    def auth_url(self, request):
        """
        Devuelve la URL de autorización de MercadoLibre para que el usuario conecte su cuenta.
        GET /api/mercadolibre/auth-url/
        """
        try:
            url, code_verifier = get_auth_url(str(request.user.id))
            return Response({
                "auth_url": url,
            })
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=False, methods=['delete'])
    def disconnect(self, request):
        """
        Desconecta la cuenta de MercadoLibre del usuario actual.
        DELETE /api/mercadolibre/disconnect/
        """
        eliminado = delete_token(request.user)
        if eliminado:
            return Response({"mensaje": "Cuenta de MercadoLibre desconectada correctamente."})
        return Response(
            {"error": "No tenías una cuenta conectada."},
            status=status.HTTP_404_NOT_FOUND,
        )

    @action(detail=False, methods=['post'])
    def publicar_item(self, request):
        """
        Publica un objeto en MercadoLibre usando la API real.
        POST /api/mercadolibre/publicar_item/
        Body: {
            objeto_id: "<uuid>",
            title: "iPhone 14 Pro Max 256GB",
            price: 850.00,
            description: "...",
            foto_url: "https://...",  (opcional, URL pública de la foto)
            category_id: "MLU1055",   (opcional, default "MLU3530")
            currency_id: "USD"        (opcional, default "USD")
        }
        """
        if not has_valid_token(request.user):
            return Response(
                {
                    "error": "No tenés tu cuenta de MercadoLibre conectada. "
                             "Usá /api/mercadolibre/auth-url/ para obtener la URL de autorización."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        objeto_id = request.data.get('objeto_id')
        title = request.data.get('title', '').strip()
        price = request.data.get('price')
        description = request.data.get('description', '').strip()
        foto_url = request.data.get('foto_url')
        category_id = request.data.get('category_id', 'MLU3530')
        currency_id = request.data.get('currency_id', 'USD')

        if not objeto_id or not title or not price:
            return Response(
                {"error": "objeto_id, title y price son requeridos."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Verificar que el objeto existe
        try:
            objeto = Objeto.objects.get(id=objeto_id)
        except Objeto.DoesNotExist:
            return Response(
                {"error": "Objeto no encontrado."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Subir foto si hay URL
        pictures = []
        if foto_url:
            picture_id = upload_picture(request.user, foto_url)
            if picture_id:
                pictures.append({"id": picture_id})
            else:
                # Intentar con la URL directa (source)
                pictures.append({"source": foto_url})

        # Crear ítem en ML
        item_data = {
            "title": title,
            "category_id": category_id,
            "price": float(price),
            "currency_id": currency_id,
            "description": description,
            "condition": "used",
            "buying_mode": "buy_it_now",
            "listing_type_id": "gold_special",
            "pictures": pictures,
        }

        result = create_item(request.user, item_data)

        if result and "id" in result:
            # Marcar como publicado en plataformas_publicadas
            plataformas = list(objeto.plataformas_publicadas or [])
            if "mercadolibre" not in plataformas:
                plataformas.append("mercadolibre")
                objeto.plataformas_publicadas = plataformas
                objeto.save(update_fields=["plataformas_publicadas"])

            return Response({
                "success": True,
                "mensaje": "✅ Publicado exitosamente en Mercado Libre",
                "ml_item_id": result["id"],
                "permalink": result.get("permalink", ""),
                "status": result.get("status", ""),
            })

        # Error de ML
        error_msg = result.get("message", "") if result else "Error desconocido"
        if not error_msg and result:
            error_details = []
            for cause in (result.get("cause") or []):
                error_details.append(cause.get("message", str(cause)))
            error_msg = "; ".join(error_details) if error_details else json.dumps(result)

        logger.error("Error al publicar en ML: %s", result)
        return Response(
            {
                "success": False,
                "error": f"Error al publicar en Mercado Libre: {error_msg}",
                "ml_response": result,
            },
            status=status.HTTP_400_BAD_REQUEST,
        )


def ml_callback(request):
    """
    Callback de OAuth de MercadoLibre.
    Recibe el código de autorización y el state (con user_id y code_verifier).
    GET /ml-callback/?code=...&state=...
    """
    from django.http import HttpResponse
    from inventario.models import CustomUser
    from inventario.services.mercadolibre_oauth import exchange_code_for_token, save_token

    code = request.GET.get('code')
    state = request.GET.get('state', '')

    if not code:
        return HttpResponse(
            '<h2>Error de autorización</h2><p>No se recibió el código de autorización de MercadoLibre.</p>',
            content_type='text/html; charset=utf-8',
            status=400,
        )

    # Decodificar state: estok_ml_auth:user_id:code_verifier
    parts = state.split(':')
    user_id = parts[1] if len(parts) > 1 else None
    code_verifier = parts[2] if len(parts) > 2 else None

    if not user_id:
        return HttpResponse(
            '<h2>Error</h2><p>No se pudo identificar al usuario.</p>',
            content_type='text/html; charset=utf-8',
            status=400,
        )

    # Intercambiar código por token
    token_data = exchange_code_for_token(code, code_verifier)
    if not token_data:
        return HttpResponse(
            '<h2>Error</h2><p>No se pudo obtener el token de MercadoLibre. Reintentá.</p>',
            content_type='text/html; charset=utf-8',
            status=500,
        )

    # Guardar token asociado al usuario
    try:
        user = CustomUser.objects.get(id=user_id)
        save_token(user, token_data)
    except CustomUser.DoesNotExist:
        return HttpResponse(
            '<h2>Error</h2><p>Usuario no encontrado.</p>',
            content_type='text/html; charset=utf-8',
            status=404,
        )

    # Redirigir al frontend con mensaje de éxito
    return HttpResponse(
        """
        <html><head><meta charset="utf-8"><title>Estok - Conexión exitosa</title>
        <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f0fdf4;}div{text-align:center;background:white;padding:2rem;border-radius:1rem;box-shadow:0 4px 6px rgba(0,0,0,.1);}h2{color:#166534;}p{color:#4b5563;}</style></head>
        <body><div><h2>✅ ¡Cuenta conectada!</h2><p>Tu cuenta de MercadoLibre fue vinculada exitosamente.</p><p style="font-size:14px;color:#9ca3af;">Ya podés cerrar esta pestaña y volver a Estok.</p></div></body></html>
        """,
        content_type='text/html; charset=utf-8',
    )
