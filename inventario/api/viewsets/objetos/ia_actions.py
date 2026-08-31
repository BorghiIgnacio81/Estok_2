"""
Mixins de acciones de IA para ObjetoViewSet.
Contiene: analizar_con_ia, analizar_imagen, test_ia_stress.
"""

import logging
import base64
import time
from decimal import Decimal
from pathlib import Path

from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status

from ....models import Objeto, Ubicacion, Contenedor
from ....services.ai_vision_service import (
    AIVisionService, GeminiClient, AIQuotaExceededError, MENSAJE_LIMITE_IA,
)


logger = logging.getLogger(__name__)


class IAActionsMixin:
    """
    Mixin que agrega endpoints de análisis con IA al ViewSet.
    Depende de que la clase combinada herede de ObjetoViewSetBase.
    """

    # =========================================================================
    # ACCIONES DE IA
    # =========================================================================
    @action(detail=True, methods=['post'])
    def analizar_con_ia(self, request, pk=None):
        """Analiza un objeto usando IA local (LM Studio)."""
        objeto = self.get_object()
        foto_principal = objeto.fotos.filter(es_principal=True).first()
        if not foto_principal:
            foto_principal = objeto.fotos.first()

        if not foto_principal:
            return Response(
                {"error": "El objeto no tiene fotos para analizar"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            service = AIVisionService()
            image_path = Path(foto_principal.imagen.path)
            if not image_path.exists():
                return Response(
                    {"error": "El archivo de imagen no existe en el servidor"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            image_bytes = image_path.read_bytes()
            image_b64 = base64.b64encode(image_bytes).decode('utf-8')
            image_b64_comprimida = service._comprimir_imagen_base64(image_b64)
            resultado = service.procesar_imagen_desde_base64(image_b64_comprimida)

            if resultado.nombre:
                objeto.nombre = resultado.nombre
            if resultado.descripcion:
                objeto.descripcion = resultado.descripcion
            if resultado.estado_conservacion:
                objeto.estado_conservacion = resultado.estado_conservacion
            if resultado.color:
                objeto.color = resultado.color
            if resultado.precio_estimado_mercado:
                objeto.valor_estimado = Decimal(str(resultado.precio_estimado_mercado))

            objeto.campos_pendientes = resultado.campos_pendientes
            if resultado.campos_pendientes:
                objeto.estado_carga = 'incompleto'
            else:
                objeto.estado_carga = 'completo'

            objeto.save()

            return Response({
                "mensaje": "Análisis completado",
                "datos": resultado.to_dict(),
                "campos_pendientes": resultado.campos_pendientes,
            })

        except AIQuotaExceededError:
            logger.error(
                "Rate limit o cuota de la API de IA al analizar objeto %s",
                objeto.id,
            )
            return Response(
                {"error": MENSAJE_LIMITE_IA},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        except Exception as e:
            logger.error("Error al analizar con IA: %s", e)
            return Response(
                {"error": f"Error al analizar con IA: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @staticmethod
    def _extraer_imagen_principal(request):
        """
        Selecciona la imagen que se envía al modelo de lenguaje y expone la
        lista completa de fotos del multipart.

        Regla de optimización multi-foto (reducción drástica de tokens y
        latencia):
        - Si el payload multipart contiene archivos bajo 'fotos'/'imagenes'
          (o 'foto'/'imagen'), se selecciona ESTRICTAMENTE la PRIMERA imagen
          (la principal) para el análisis de reconocimiento y clasificación
          taxonómica. Las fotos restantes se persisten directo en PostgreSQL
          y NUNCA se envían al modelo de lenguaje.
        - Si no hay archivos, se usa el campo 'imagen_base64' (flujo JSON).

        Returns:
            Tupla (imagen_base64, lista_de_fotos_multipart). La lista solo
            contiene archivos cuando el request es multipart.
        """
        archivos = (
            request.FILES.getlist('fotos')
            or request.FILES.getlist('imagenes')
        )
        if not archivos:
            for clave in ('foto', 'imagen'):
                archivo = request.FILES.get(clave)
                if archivo:
                    archivos = [archivo]
                    break

        if not archivos:
            return request.data.get('imagen_base64', ''), []

        if len(archivos) > 1:
            logger.info(
                "Payload multipart con %s fotos: se analiza SOLO la primera "
                "(principal). El resto se persiste sin pasar por el LLM.",
                len(archivos),
            )

        primera = archivos[0]
        return (
            base64.b64encode(primera.read()).decode('utf-8'),
            archivos,
        )

    @action(detail=False, methods=['post'])
    def analizar_imagen(self, request):
        """
        Analiza una imagen recibida en Base64 usando IA.
        Soporta motores: 'local' (LM Studio) y 'gemini' (Google Gemini 2.5 Flash-Lite).
        Por defecto SOLO analiza y devuelve los datos (no crea el objeto).
        Si se envía `crear_objeto: true`, también crea el objeto en BD.
        """
        # El payload puede venir como JSON (imagen_base64) o como multipart con
        # archivos. Si el multipart trae MÚLTIPLES fotos, se selecciona
        # ESTRICTAMENTE la primera (la principal) para el análisis; el resto se
        # persiste directo en PostgreSQL y nunca se envía al modelo de lenguaje.
        imagen_base64, fotos_multipart = self._extraer_imagen_principal(request)
        if not imagen_base64:
            return Response(
                {
                    "error": (
                        "Debes proporcionar 'imagen_base64' o al menos una "
                        "foto para analizar"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if ',' in imagen_base64:
            imagen_base64 = imagen_base64.split(',', 1)[1]

        es_segunda_foto = request.data.get('es_segunda_foto', False)
        if isinstance(es_segunda_foto, str):
            es_segunda_foto = es_segunda_foto.lower() == 'true'

        # El motor por defecto es 'gemini' (capa gratuita de Google). La
        # segunda foto (parte trasera para ISBN) SIEMPRE usa Gemini.
        motor = 'gemini' if es_segunda_foto else request.data.get('motor', 'gemini')
        if motor not in ('local', 'gemini'):
            return Response(
                {"error": "El motor debe ser 'local' o 'gemini'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        solo_analisis = request.data.get('solo_analisis', True)
        if isinstance(solo_analisis, str):
            solo_analisis = solo_analisis.lower() == 'true'

        ubicacion_id = request.data.get('ubicacion_id')
        contenedor_id = request.data.get('contenedor_id')

        ubicacion = None
        contenedor = None

        if ubicacion_id:
            try:
                ubicacion = Ubicacion.objects.get(id=ubicacion_id)
            except Ubicacion.DoesNotExist:
                return Response(
                    {"error": "Ubicación no encontrada"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if contenedor_id:
            try:
                contenedor = Contenedor.objects.get(id=contenedor_id)
            except Contenedor.DoesNotExist:
                return Response(
                    {"error": "Contenedor no encontrado"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            service = AIVisionService()
            resultado = service.procesar_imagen_desde_base64_con_motor(
                imagen_base64, motor=motor
            )

            response_data = {
                "mensaje": "Imagen analizada correctamente",
                "datos_ia": resultado.to_dict(),
                "campos_pendientes": resultado.campos_pendientes,
            }

            if resultado.categoria == 'libro' and not es_segunda_foto:
                necesita_segunda_foto = False
                motivo_segunda_foto = None

                if not resultado.isbn_issn:
                    necesita_segunda_foto = True
                    motivo_segunda_foto = (
                        "No se detectó código ISBN en la portada. "
                        "Toma una foto de la PARTE TRASERA del libro "
                        "para capturar el código de barras/ISBN."
                    )

                if resultado.confianza_general < 0.5:
                    necesita_segunda_foto = True
                    motivo_segunda_foto = (motivo_segunda_foto or "") + (
                        " La confianza en la identificación es baja. "
                        "Toma una foto más clara de la portada o la parte trasera."
                    )

                response_data["necesita_segunda_foto"] = necesita_segunda_foto
                response_data["motivo_segunda_foto"] = motivo_segunda_foto

            if es_segunda_foto and resultado.isbn_issn:
                logger.info("✅ Segunda foto: ISBN detectado: %s", resultado.isbn_issn)
                response_data["isbn_detectado"] = resultado.isbn_issn

            if not solo_analisis:
                from ....models import Estok

                estok = None
                estok_id = request.headers.get('X-Estok-Id')
                if estok_id:
                    try:
                        estok = Estok.objects.get(id=estok_id)
                    except Estok.DoesNotExist:
                        return Response(
                            {"error": "Estok no encontrado"},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                objeto_creado = service.crear_objeto_desde_vision(
                    vision_result=resultado,
                    user=request.user if request.user.is_authenticated else None,
                    ubicacion=ubicacion,
                    contenedor=contenedor,
                    estok=estok,
                )


                if not objeto_creado:
                    return Response(
                        {"error": "Error al crear el objeto desde el análisis de IA"},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )

                response_data["mensaje"] = "Objeto creado desde análisis de IA"
                response_data["objeto"] = objeto_creado

                # Multi-foto: las fotos restantes (todas menos la principal) se
                # persisten DIRECTAMENTE en PostgreSQL sin pasar por el LLM.
                if len(fotos_multipart) > 1:
                    from ....models import FotoObjeto
                    creadas_extra = 0
                    for idx, archivo in enumerate(fotos_multipart[1:], start=2):
                        try:
                            FotoObjeto.objects.create(
                                objeto_id=objeto_creado["id"],
                                imagen=archivo,
                                descripcion="Foto de carga",
                                es_principal=False,
                            )
                            creadas_extra += 1
                        except Exception as exc:  # noqa: BLE001
                            logger.warning(
                                "No se pudo persistir la foto extra %s: %s",
                                idx, exc,
                            )
                    logger.info(
                        "Persistidas %s foto(s) extra del multipart en PostgreSQL "
                        "sin enviarlas al modelo de lenguaje.",
                        creadas_extra,
                    )

            return Response(response_data, status=status.HTTP_200_OK)

        except AIQuotaExceededError:
            logger.error("Rate limit o cuota de la API de IA al analizar imagen")
            return Response(
                {"error": MENSAJE_LIMITE_IA},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        except Exception as e:
            logger.error("Error al analizar imagen Base64: %s", e)
            return Response(
                {"error": f"Error al analizar imagen: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=False, methods=['get'])
    def test_ia_stress(self, request):
        """
        Endpoint de test de estrés para el servicio de IA.
        Soporta parámetro ?motor=local|gemini para verificar disponibilidad
        del motor seleccionado.
        """
        motor = request.query_params.get('motor', 'local')
        if motor not in ('local', 'gemini'):
            return Response(
                {"error": "El motor debe ser 'local' o 'gemini'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        start = time.time()

        if motor == 'gemini':
            return self._check_gemini_health(start)
        else:
            return self._check_lmstudio_health(start)

    def _check_lmstudio_health(self, start):
        """Verifica disponibilidad de LM Studio (postergado)."""
        latency = int((time.time() - start) * 1000)
        return Response({
            "status": "no_disponible",
            "latency_ms": latency,
            "model": None,
            "message": (
                "El motor de IA local (LM Studio) no está disponible en esta versión. "
                "Estará disponible próximamente. Usa el motor 'gemini' mientras tanto."
            ),
        })

    def _check_gemini_health(self, start):
        """Verifica disponibilidad de Gemini (API key configurada)."""
        try:
            gemini = GeminiClient()
            available = gemini._check_health()
            latency = int((time.time() - start) * 1000)

            if available:
                return Response({
                    "status": "ok",
                    "latency_ms": latency,
                    "model": "gemini-2.5-flash-lite (Google Gemini)",
                    "message": f"Gemini conectado en {latency}ms.",
                })
            else:
                return Response({
                    "status": "error",
                    "latency_ms": latency,
                    "model": None,
                    "message": (
                        "Gemini no está disponible. "
                        "Verifica que GEMINI_API_KEY esté configurada en el servidor."
                    ),
                }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        except Exception as e:
            latency = int((time.time() - start) * 1000)
            return Response({
                "status": "error",
                "latency_ms": latency,
                "error": str(e),
                "message": f"Error de conexión con Gemini en {latency}ms: {str(e)}",
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)
