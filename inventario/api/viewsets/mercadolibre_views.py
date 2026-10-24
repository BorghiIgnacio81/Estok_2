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

from ...models import CustomUser
from ...services.mercadolibre_oauth import (
    get_auth_url, has_valid_token, delete_token, get_valid_access_token,
)
from ...services.mercadolibre_api import (
    construir_attributes_desde_objeto,
    create_item,
)
from ...services.mercadolibre_imagenes import construir_pictures
from ...services.mercadolibre_payload import (
    cantidad_disponible_ml,
    condition_desde_objeto,
    extraer_causas_ml,
    extraer_error_ml,
    mapear_condition_ml,
)
from ...services.mercadolibre_saneamiento import recortar_titulo
from ...services.categorias_meli import (
    garantizar_categoria_hoja_ml,
    normalizar_id_ml,
    resolver_category_id_ml,
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
        Publica un objeto en Mercado Libre usando la API real.
        POST /api/mercadolibre/publicar_item/
        Body: {
            objeto_id: "<uuid>",
            title: "iPhone 14 Pro Max 256GB",  (rango obligatorio de 15 a 60)
            price: 850.00,                     (float, debe ser mayor a 0)
            description: "...",                (se envía aparte, tras el 201)
            foto_url: "https://...",           (opcional, foto elegida en el modal)
            condition: "new" | "used"          (opcional: si no viene se mapea el
                                                estado del objeto: 'nuevo' → 'new',
                                                cualquier otro estado → 'used')
        }

        CATEGORÍA: manda la categoría del objeto
        (`Categoria.mercadolibre_category_id`); si no tiene mapeo se predice con
        el NOMBRE de la categoría y se persiste en la BD. Nunca se predice con el
        título del ítem (desviaba publicaciones a categorías absurdas). El
        `category_id` del body solo se acepta si el objeto no tiene categoría.
        Antes de llamar a ML se verifica que el ID exista y sea una categoría
        HOJA: si no lo es, se vuelve a predecir; si no hay forma de resolverla se
        devuelve 400 con "Debes asignar una categoría válida de Mercado Libre".

        FOTOS: "pictures" se arma como [{"source": "https://url-publica"}] con
        las fotos reales del objeto (settings.SITE_URL + /media/...), que es lo
        que Mercado Libre exige para descargar la imagen. Sin fotos públicas NO
        se envía la clave "pictures" (nunca valores nulos).

        ATRIBUTOS: `construir_attributes_desde_objeto()` envía los datos REALES
        del objeto (BRAND si tiene marca, MODEL si tiene modelo). Después,
        `create_item()` consulta GET /categories/{id}/attributes y agrega TODOS
        los atributos obligatorios de la categoría con un valor VÁLIDO según su
        `value_type` (value_id de catálogo para listas, "No" para booleanos,
        número + unidad, o el dato real; los genéricos "Sin marca"/"Genérico"
        son el ÚLTIMO recurso y nunca pisan un dato cargado). Evita el bucle
        body.required_fields ↔ invalid_fields.

        Defaults obligatorios (`construir_payload_item`): currency_id="ARS",
        buying_mode="buy_it_now", listing_type_id="gold_special" (o settings),
        available_quantity = objeto.cantidad (mínimo 1), condition 'new'/'used',
        title de 15 a 60 caracteres y shipping con retiro en persona.

        DESCRIPCIÓN: ML prohíbe "description" en POST /items; se crea después del
        201 con POST /items/{item_id}/description. "family_name" tampoco se envía.

        ERRORES DE MERCADO LIBRE: el payload exacto se registra con
        logger.info("Payload ML enviado: ...") y, ante 400/422, el cuerpo
        completo de la respuesta con logger.error("Respuesta ML Error: ...").
        Al frontend se le devuelve el detalle (campos faltantes / inválidos).
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
        description = str(request.data.get('description') or '').strip()
        foto_url = request.data.get('foto_url') or ''
        # La moneda NO se toma del request: MLA opera estrictamente en ARS y
        # construir_payload_item() la fuerza siempre a "ARS".
        # Condición pedida explícitamente por el modal. Si no viene (o no es un
        # valor nativo), más abajo se mapea el estado del objeto:
        # 'nuevo' → 'new'; cualquier otro estado → 'used'.
        condition_solicitada = mapear_condition_ml(request.data.get('condition'))

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

        # Título definitivo: el del request o el nombre del objeto, como texto
        # plano y con corte limpio en 60; el mínimo de 15 lo completa el payload.
        title = recortar_titulo(title or objeto.nombre)

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

        # ── Condición nativa de Mercado Libre ───────────────────────────────
        # Mapea el estado del objeto ('nuevo' → 'new', cualquier otro → 'used')
        # salvo que el request haya pedido explícitamente "new"/"used".
        condition = condition_solicitada or condition_desde_objeto(objeto)

        # ── Fotos en el formato oficial de ML ────────────────────────────────
        # ML descarga la imagen: se arman URLs absolutas y públicas
        # (SITE_URL + /media/...) y se descartan rutas relativas o localhost.
        # Sin fotos públicas NO se envía la clave "pictures" (ML no acepta
        # elementos nulos); el rechazo, si aplica, lo informa la propia API.
        pictures = construir_pictures(objeto, foto_url)
        if not pictures:
            logger.warning(
                "Objeto %s sin fotos públicas: se publica SIN el atributo "
                "'pictures' (Mercado Libre decidirá si lo exige).", objeto.id,
            )

        # ── Categoría de Mercado Libre (mapeo dinámico, estricto y hoja) ──────
        # 1) Se usa `Categoria.mercadolibre_category_id` si es válido.
        # 2) Sin mapeo: se predice con el NOMBRE de la categoría y se persiste.
        # 3) Se verifica contra la API que el ID exista y NO tenga subcategorías
        #    (ML rechaza con 400 publicar en categorías contenedor).
        # 4) Nunca se predice desde el título del ítem.
        access_token = get_valid_access_token(request.user)
        category_id = resolver_category_id_ml(
            objeto.categoria,
            texto_fallback=title,
            access_token=access_token or "",
        )
        if objeto.categoria is None:
            # Solo si el objeto no tiene categoría se acepta un ID del request.
            category_id = normalizar_id_ml(request.data.get('category_id')) or category_id

        category_id = garantizar_categoria_hoja_ml(
            objeto.categoria, category_id, access_token=access_token or "",
            # En categorías contenedor ("Electrónica", "Hogar") la hoja se
            # predice con el NOMBRE REAL DEL OBJETO: el nombre de la categoría
            # es demasiado amplio y desviaba la publicación (GPS → Software).
            texto_objeto=(getattr(objeto, 'nombre', '') or ''),
        )
        if not normalizar_id_ml(category_id):
            # Se aborta ANTES de llamar a ML (evita 400 body.invalid_fields /
            # body.required_fields por category_id vacío o no publicable).
            return Response(
                {
                    "success": False,
                    "error": "Debes asignar una categoría válida de Mercado Libre",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Payload para el servicio: solo datos crudos del objeto. El saneamiento
        # de tipos y los defaults obligatorios viven en construir_payload_item().
        item_data = {
            "title": title,
            "category_id": category_id,
            "categoria_nombre": objeto.categoria.nombre if objeto.categoria else "",
            "nombre": (getattr(objeto, 'nombre', '') or '').strip(),
            "marca": (getattr(objeto, 'marca', '') or '').strip(),
            "modelo": (getattr(objeto, 'modelo', '') or '').strip(),
            # Datos REALES adicionales: alimentan los atributos obligatorios que
            # exige el catálogo de la categoría (COLOR, SIZE, MATERIAL, etc.).
            "material": (getattr(objeto, 'material', '') or '').strip(),
            "tamano": (getattr(objeto, 'tamano', '') or '').strip(),
            "idioma": (getattr(objeto, 'idioma', '') or '').strip(),
            "editorial": (getattr(objeto, 'editorial', '') or '').strip(),
            "numero_serie": (getattr(objeto, 'numero_serie', '') or '').strip(),
            "artista_fabricante": (getattr(objeto, 'artista_fabricante', '') or '').strip(),
            "peso": str(getattr(objeto, 'peso', '') or '').strip(),
            "especificaciones": getattr(objeto, 'especificaciones', None) or {},
            "price": price,
            "available_quantity": cantidad_disponible_ml(objeto),
            "description": description or (getattr(objeto, 'descripcion', '') or objeto.nombre),
            "condition": condition,
            "pictures": pictures,
            "attributes": construir_attributes_desde_objeto(objeto, category_id),
        }

        diagnostico: dict = {}
        try:
            result = create_item(
                request.user, item_data, diagnostico=diagnostico
            )
        except ValueError as e:
            # Excepción controlada lanzada por el servicio de publicación
            return Response(
                {
                    "success": False,
                    "error": str(e),
                    "error_ml": diagnostico.get("error_ml"),
                    "payload_enviado": diagnostico.get("payload_enviado", {}),
                    "atributos_detectados_categoria": diagnostico.get(
                        "atributos_detectados_categoria", []
                    ),
                },
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
                # Categoría realmente usada: permite auditar que la publicación
                # cayó en la categoría mapeada y no en una predicha al azar.
                "category_id": category_id,
                "categoria_estok": objeto.categoria.nombre if objeto.categoria else "",
                "fotos_enviadas": len(pictures),
            })

        # ── Error de Mercado Libre (400/422): causas EXACTAS ─────────────────
        # Se devuelve el arreglo `cause` tal cual lo manda ML (campo y motivo)
        # junto con la respuesta cruda, para que el frontend sepa exactamente
        # qué campo rechazó: nunca más un "body.invalid_fields" genérico.
        causas = extraer_causas_ml(result)
        error_ml = extraer_error_ml(result)
        logger.error(
            "Error al publicar en ML (objeto %s, categoría %s, condition %s): %s "
            "| campos_faltantes=%s | campos_invalidos=%s | causes=%s | raw=%s",
            objeto.id, category_id, condition, error_ml["mensaje"],
            error_ml["campos"] or "-",
            error_ml.get("invalidos") or "-",
            json.dumps(causas, ensure_ascii=False),
            json.dumps(result, ensure_ascii=False) if result else "sin respuesta",
        )

        mensaje = error_ml["mensaje"]
        if not mensaje.startswith("Mercado Libre"):
            mensaje = f"Error al publicar en Mercado Libre: {mensaje}"

        return Response(
            {
                # Diagnóstico TRANSPARENTE (formato pedido): JSON exacto que se
                # envió a ML, respuesta de ML y atributos detectados de la
                # categoría, para verlo en pantalla o en la consola (F12).
                "error_ml": diagnostico.get("error_ml", result),
                "payload_enviado": diagnostico.get("payload_enviado", {}),
                "atributos_detectados_categoria": diagnostico.get(
                    "atributos_detectados_categoria", []
                ),
                "categoria_ml": diagnostico.get("category_id", category_id),
                "intentos_ml": diagnostico.get("intentos", 0),
                # Contrato pedido por el frontend: detalle + causas + raw.
                "detail": "Error en campos de Mercado Libre",
                "causes": causas,
                "raw": result,
                # Compatibilidad con la UI existente (mensaje legible y campos).
                "success": False,
                "error": mensaje,
                "campos_faltantes": error_ml["campos"],
                "campos_invalidos": error_ml.get("invalidos", []),
                "detalles": error_ml["detalles"],
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
                'Volvé a intentar desde Integraciones en Mi Perfil.</p>'
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
            <body><div><h2>✅ ¡Cuenta conectada!</h2><p>Tu cuenta de MercadoLibre fue vinculada exitosamente.</p><a href="/perfil" class="btn">← Volver a Estok</a><p style="font-size:12px;color:#9ca3af;margin-top:1rem;">Redirigiendo a Mi Perfil...</p></div>
            <script>
            if (window.opener) {{
                window.opener.postMessage({{ type: 'ml_connected', success: true }}, '*');
            }}
            setTimeout(function() {{ window.location.href = '/perfil'; }}, 1500);
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
