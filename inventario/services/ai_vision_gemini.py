"""
Cliente de Gemini 2.5 Flash-Lite para analisis de imagenes.
Extraido de ai_vision_service.py (Fase A refactor preventivo).
"""

import base64
import logging
from typing import Optional, Dict, Any

from django.core.exceptions import ImproperlyConfigured

from .ai_vision_nucleo import (
    PROMPT_SISTEMA_CATALOGACION,
    TEXTO_USUARIO_ANALISIS,
    _extraer_json_de_respuesta,
    AIQuotaExceededError,
    MENSAJE_LIMITE_IA,
)

logger = logging.getLogger(__name__)


# =============================================================================
# CLIENTE GEMINI (Google Gen AI SDK)
# =============================================================================
class GeminiClient:
    """
    Cliente para conectar con la API de Gemini 2.5 Flash-Lite de Google.
    Utiliza el SDK oficial `google-genai` (google.genai).

    Lee la API key desde la variable de entorno GEMINI_API_KEY.
    Si no está configurada, lanza ImproperlyConfigured al intentar usarlo.

    Nota: El paquete `google-generativeai` (0.8.x) está deprecado.
    Esta implementación usa `google-genai` (>=2.0) que es el SDK actual.
    """

    MODEL_NAME = "gemini-2.5-flash-lite"  # alias estable de Gemini 2.5 Flash-Lite

    def __init__(self):
        self.api_key = os.environ.get('GEMINI_API_KEY')
        if not self.api_key:
            raise ImproperlyConfigured(
                "GEMINI_API_KEY no está configurada en el entorno. "
                "Configúrala en Coolify o en el archivo .env antes de usar "
                "el servicio de visión por IA."
            )
        self._client = None

    def _get_client(self):
        """Inicializa el cliente de Gemini si no está creado."""
        if self._client is None:
            import google.genai as genai
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    def _get_model_name(self) -> str:
        """
        Retorna el modelo Gemini configurado (GEMINI_MODEL de settings) o el
        default gemini-2.5-flash-lite. Permite cambiar de modelo (p. ej.
        gemini-1.5-flash) sin tocar código, solo con variable de entorno.
        """
        from django.conf import settings

        return getattr(settings, 'GEMINI_MODEL', None) or self.MODEL_NAME

    def _check_health(self) -> bool:
        """Verifica que la API key de Gemini sea válida."""
        try:
            client = self._get_client()
            client.models.list()
            return True
        except Exception as e:
            logger.warning("Gemini no está disponible: %s", e)
            return False

    def analyze_base64(self, image_base64: str, rag_context: str = "") -> Optional[Dict[str, Any]]:
        """
        Envía una imagen en Base64 a Gemini 2.5 Flash-Lite para análisis.

        Args:
            image_base64: Imagen codificada en Base64 (con o sin prefijo data:image).
            rag_context: Contexto de objetos similares ya catalogados (opcional).

        Returns:
            Diccionario con la respuesta JSON del modelo, o None si falla.
        """
        # Limpiar prefijo data:image si existe
        if ',' in image_base64:
            image_base64 = image_base64.split(',', 1)[1]

        # Prompt del sistema (constante única compartida con el motor de respaldo)
        system_prompt = PROMPT_SISTEMA_CATALOGACION

        if rag_context:
            system_prompt += "\n\n" + rag_context

        import time as time_module
        start_time = time_module.time()

        # Estimar tamaño de la imagen
        img_size_mb = len(image_base64) * 0.73 / (1024 * 1024)
        logger.info("Enviando imagen a Gemini 2.5 Flash-Lite para análisis (tamaño: %.2fMB)...", img_size_mb)

        try:
            from google.genai import types as genai_types

            client = self._get_client()

            response = client.models.generate_content(
                model=self._get_model_name(),
                contents=[
                    genai_types.Part.from_bytes(
                        data=base64.b64decode(image_base64),
                        mime_type="image/jpeg",
                    ),
                    genai_types.Part.from_text(
                        text=TEXTO_USUARIO_ANALISIS
                    ),
                ],
                config=genai_types.GenerateContentConfig(
                    system_instruction=genai_types.Content(
                        parts=[genai_types.Part.from_text(text=system_prompt)]
                    ),
                    temperature=0.1,
                    max_output_tokens=1024,
                ),
            )

            elapsed = time_module.time() - start_time
            # Obtener texto de forma segura
            try:
                content = response.text
            except (ValueError, AttributeError) as e:
                logger.error("Gemini response.text falló: %s", e)
                try:
                    content = response.candidates[0].content.parts[0].text
                except Exception:
                    logger.error("Tampoco se pudo extraer texto de candidates")
                    return None

            logger.info("Gemini respondió en %.1fs.", elapsed)
            logger.info("Gemini respuesta (primeros 300): %s", content[:300])

            # Intentar parsear como JSON (helper compartido con el motor de respaldo)
            return _extraer_json_de_respuesta(content)

        except Exception as e:
            elapsed = time_module.time() - start_time
            logger.error("Error al comunicarse con Gemini después de %.1fs: %s", elapsed, e)
            if es_error_cuota_excedida(e):
                logger.error(
                    "Cuota o rate limit de la API de IA alcanzado después de "
                    "%.1fs: %s",
                    elapsed, e,
                )
                raise AIQuotaExceededError(str(e)) from e

            return None

