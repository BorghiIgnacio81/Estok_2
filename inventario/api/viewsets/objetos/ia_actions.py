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
    AIVisionService, GeminiClient,
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

        except Exception as e:
            logger.error("Error al analizar con IA: %s", e)
            return Response(
                {"error": f"Error al analizar con IA: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=False, methods=['post'])
    def analizar_imagen(self, request):
        """
        Analiza una imagen recibida en Base64 usando IA.
        Soporta motores: 'local' (LM Studio) y 'gemini' (Google Gemini 2.5 Flash-Lite).
        Por defecto SOLO analiza y devuelve los datos (no crea el objeto).
        Si se envía `crear_objeto: true`, también crea el objeto en BD.
        """
        imagen_base64 = request.data.get('imagen_base64')
        if not imagen_base64:
            return Response(
                {"error": "Debes proporcionar 'imagen_base64'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if ',' in imagen_base64:
            imagen_base64 = imagen_base64.split(',', 1)[1]

        es_segunda_foto = request.data.get('es_segunda_foto', False)
        if isinstance(es_segunda_foto, str):
            es_segunda_foto = es_segunda_foto.lower() == 'true'

        # La segunda foto (parte trasera para ISBN) SIEMPRE usa Gemini
        motor = 'gemini' if es_segunda_foto else request.data.get('motor', 'local')
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
                objeto_creado = service.crear_objeto_desde_vision(
                    vision_result=resultado,
                    user=request.user if request.user.is_authenticated else None,
                    ubicacion=ubicacion,
                    contenedor=contenedor,
                )

                if not objeto_creado:
                    return Response(
                        {"error": "Error al crear el objeto desde el análisis de IA"},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )

                response_data["mensaje"] = "Objeto creado desde análisis de IA"
                response_data["objeto"] = objeto_creado

            return Response(response_data, status=status.HTTP_200_OK)

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
