"""
ViewSet para autenticación y publicación en MercadoLibre.
"""

import json
import logging
import traceback

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import redirect
from django.conf import settings

from ...models import CustomUser
from ...services.mercadolibre_oauth import (
    get_auth_url, has_valid_token, delete_token,
)
from ...services.mercadolibre_api import (
    create_item, construir_attributes_desde_objeto,
)
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
        if self.action in ('auth_status', 'auth_url', 'disconnect', 'callback', 'status'):
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    @action(detail=False, methods=['get'], url_path='auth-status')
    def auth_status(self, request):
        """
        Verifica si el usuario actual tiene una cuenta de MercadoLibre conectada.
        GET /api/mercadolibre/auth-status/
        Retorna info del usuario de ML si está conectado.
        """
        from ...models import MercadoLibreToken
        conectado = has_valid_token(request.user)
        data = {"conectado": conectado}

        if conectado:
            try:
                token = MercadoLibreToken.objects.get(usuario=request.user)
                data["ml_user_id"] = token.ml_user_id
                data["ml_nickname"] = token.scope or "Conectado"
                data["connected_at"] = token.created_at.isoformat() if token.created_at else None
            except MercadoLibreToken.DoesNotExist:
                pass

        return Response(data)

    @action(detail=False, methods=['get'])
    def status(self, request):
        """
        Devuelve el estado de conexión con MercadoLibre y datos del usuario ML.
        GET /api/mercadolibre/status/
        Llama a /users/me para obtener nombre y email reales del usuario ML.
        """
        from ...services.mercadolibre_api import _api_request
        from ...services.mercadolibre_oauth import get_valid_access_token

        access_token = get_valid_access_token(request.user)
        if not access_token:
            return Response({"conectado": False})

        ml_user = _api_request("GET", "/users/me", access_token)
        if not ml_user or "id" not in ml_user:
            return Response({"conectado": False, "error": "No se pudo obtener datos del usuario ML"})

        return Response({
            "conectado": True,
            "ml_user_id": ml_user.get("id"),
            "nickname": ml_user.get("nickname", ""),
            "nombre": ml_user.get("first_name", ""),
            "apellido": ml_user.get("last_name", ""),
            "email": ml_user.get("email", ""),
        })

    @action(detail=False, methods=['get'], url_path='auth-url')
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
            title: "iPhone 14 Pro Max 256GB",  (se trunca a 60 caracteres)
            price: 850.00,                     (float, debe ser mayor a 0)
            description: "...",
            foto_url: "https://...",           (opcional, URL pública de la foto)
            category_id: "MLA1648",            (opcional, se predice desde el título si falta)
            condition: "used"                  (opcional: "new" | "used", default "used")
        }
        Nota: currency_id se fuerza a "ARS" y listing_type_id a "bronze".
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
        title = request.data.get('title', '')
        price = request.data.get('price')
        description = request.data.get('description', '').strip()
        foto_url = request.data.get('foto_url') or ''
        # Asegurar que la URL de la foto sea HTTPS pública accesible para ML
        if foto_url:
            foto_url = foto_url.replace('http://', 'https://', 1)
        category_id = request.data.get('category_id', 'MLA1747')
        # Moneda: MLA Argentina opera estrictamente en ARS (se ignora cualquier otro valor)
        currency_id = "ARS"
        # Condición: solo valores nativos aceptados por MLA (default "used": inventario usado)
        condition = str(request.data.get('condition', 'used')).strip().lower()
        if condition not in ('new', 'used'):
            condition = 'used'

        if not objeto_id or not title or price is None or price == '':
            return Response(
                {"error": "objeto_id, title y price son requeridos."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Verificar que el objeto existe (con categoría precargada para attributes)
        try:
            objeto = Objeto.objects.select_related('categoria').get(id=objeto_id)
        except Objeto.DoesNotExist:
            return Response(
                {"error": "Objeto no encontrado."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Título definitivo: usar el del request o el nombre del objeto,
        # truncado estrictamente a 60 caracteres (límite de la API de ML)
        title = (title or objeto.nombre or '').strip()[:60]

        # Precio: float válido y estrictamente mayor a 0 (validación temprana
        # antes de pegarle a Mercado Libre)
        try:
            price = float(price)
        except (TypeError, ValueError):
            return Response(
                {"error": "El precio debe ser un número válido."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if price <= 0:
            return Response(
                {"error": "El precio debe ser mayor a 0 para publicar en Mercado Libre."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Imágenes en formato oficial de ML: [{"source": url}]
        # (ML descarga y procesa la imagen; evita el 400 "pictures are mandatory").
        # Fuentes: foto_url externa del request + foto(s) reales del objeto con
        # URL absoluta pública (settings.SITE_URL + ruta de media).
        fuentes_foto: list = []
        if foto_url:
            es_url_interna = (
                'eeestok.duckdns.org' in foto_url or
                '/api/' in foto_url or
                not foto_url.startswith('http')
            )
            if es_url_interna:
                logger.info(
                    "foto_url del request es interna; se usará la foto del objeto. URL: %s",
                    foto_url[:200]
                )
            else:
                fuentes_foto.append(foto_url)

        foto_objeto = (
            objeto.fotos.filter(es_principal=True).first()
            or objeto.fotos.first()
        )
        if foto_objeto and foto_objeto.imagen:
            fuentes_foto.append(
                f"{settings.SITE_URL}{foto_objeto.imagen.url}"
            )

        # Deduplicar preservando orden y armar el formato estricto de MLA
        pictures = [{"source": url} for url in dict.fromkeys(fuentes_foto)]

        # Predecir categoría hoja desde el título si no se especificó una válida
        if not request.data.get('category_id') or category_id == 'MLA1747':
            from ...services.mercadolibre_api import predict_category
            predicted = predict_category(title)
            if predicted:
                category_id = predicted

        # Crear ítem en ML con payload blindado (title ≤ 60 chars, moneda ARS,
        # condition nativa, attributes dinámicos de categoría y modo de compra fijo)
        item_data = {
            "title": title,
            "category_id": category_id,
            "price": price,
            "currency_id": currency_id,
            "description": description,
            "condition": condition,
            "buying_mode": "buy_it_now",
            "listing_type_id": "bronze",
            "pictures": pictures,
            "attributes": construir_attributes_desde_objeto(objeto, category_id),
        }

        try:
            result = create_item(request.user, item_data)
        except ValueError as e:
            # Excepción controlada lanzada por el servicio de publicación
            return Response(
                {"success": False, "error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
        error_details = []
        if not error_msg and result:
            for cause in (result.get("cause") or []):
                detail = cause.get("message", str(cause))
                # Agregar info del atributo en cuestión si existe
                attr = cause.get("attribute")
                if attr:
                    detail = f"[{attr}] {detail}"
                error_details.append(detail)
            error_msg = "; ".join(error_details) if error_details else json.dumps(result)
        
        # Si hay cause pero no message, construir desde cause
        if not error_msg and result and (result.get("cause") or result.get("error")):
            error_msg = result.get("error", json.dumps(result))

        logger.error("Error al publicar en ML. Resultado completo: %s", json.dumps(result, ensure_ascii=False))
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

    try:
        code = request.GET.get('code')
        state = request.GET.get('state', '')

        logger.info("ml_callback recibido: code=%s..., state=%s...", 
                     (code or '')[:15], (state or '')[:30])

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

        logger.info("ml_callback parseado: user_id=%s, code_verifier_len=%s, parts_count=%s",
                     user_id, len(code_verifier) if code_verifier else 0, len(parts))

        if not user_id:
            return HttpResponse(
                '<h2>Error</h2><p>No se pudo identificar al usuario. State: {}</p>'.format(state[:50]),
                content_type='text/html; charset=utf-8',
                status=400,
            )

        # Intercambiar código por token
        token_data = exchange_code_for_token(code, code_verifier)
        if not token_data:
            logger.error("ml_callback: exchange_code_for_token retornó None para user_id=%s", user_id)
            return HttpResponse(
                '<h2>Error</h2><p>No se pudo obtener el token de MercadoLibre. '
                'Esto puede deberse a que el código de autorización expiró o ya fue usado. '
                'Volvé a intentar desde la página de Integraciones.</p>'
                '<p style="font-size:12px;color:#9ca3af;">User ID: {}</p>'.format(user_id[:20]),
                content_type='text/html; charset=utf-8',
                status=500,
            )

        # Guardar token asociado al usuario
        try:
            user = CustomUser.objects.get(id=user_id)
            save_token(user, token_data)
        except CustomUser.DoesNotExist:
            logger.error("ml_callback: usuario no encontrado: %s", user_id)
            return HttpResponse(
                '<h2>Error</h2><p>Usuario no encontrado.</p>',
                content_type='text/html; charset=utf-8',
                status=404,
            )

        logger.info("ml_callback: Token guardado exitosamente para user_id=%s, ml_user_id=%s",
                     user_id, token_data.get('user_id'))

        return HttpResponse(
            f"""
            <html><head><meta charset="utf-8"><title>Estok - Conexión exitosa</title>
            <style>body{{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f0fdf4;}}div{{text-align:center;background:white;padding:2rem;border-radius:1rem;box-shadow:0 4px 6px rgba(0,0,0,.1);}}h2{{color:#166534;}}p{{color:#4b5563;}}.btn{{display:inline-block;margin-top:1rem;padding:.75rem 1.5rem;background:#1d4ed8;color:white;text-decoration:none;border-radius:.5rem;font-weight:600;font-size:14px;}}</style></head>
            <body><div><h2>✅ ¡Cuenta conectada!</h2><p>Tu cuenta de MercadoLibre fue vinculada exitosamente.</p><a href="/integraciones" class="btn">← Volver a Estok</a><p style="font-size:12px;color:#9ca3af;margin-top:1rem;">Redirigiendo a Integraciones...</p></div>
            <script>
            if (window.opener) {{
                window.opener.postMessage({{ type: 'ml_connected', success: true }}, '*');
            }}
            setTimeout(function() {{ window.location.href = '/integraciones'; }}, 1500);
            </script></body></html>
            """,
            content_type='text/html; charset=utf-8',
        )

    except Exception as e:
        logger.exception("ml_callback: EXCEPCIÓN NO MANEJADA: %s", e)
        return HttpResponse(
            '<h2>Error interno</h2><p>Ocurrió un error inesperado: {}</p>'
            '<pre style="font-size:10px;color:#999;">{}</pre>'.format(
                str(e)[:200], traceback.format_exc()[-500:]
            ),
            content_type='text/html; charset=utf-8',
            status=500,
        )
