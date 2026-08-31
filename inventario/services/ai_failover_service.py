"""
Servicio de respaldo (FAILOVER) para la visión por IA — Motor OpenAI-compatible.

Se activa automáticamente cuando el motor primario (Gemini) responde HTTP 429
(Rate Limit / cuota agotada). Usa el paquete `openai` (ya presente en
requirements.txt) contra cualquier proveedor que exponga el endpoint OpenAI
Chat Completions (/v1/chat/completions) con soporte de imágenes:

  - OpenRouter    -> base_url: https://openrouter.ai/api/v1
                     model: meta-llama/llama-3.2-11b-vision-instruct:free
                     (u otro modelo de visión barato/gratuito)
  - DeepSeek      -> base_url: https://api.deepseek.com
                     model: deepseek-chat
                     (NOTA: la API pública de DeepSeek es texto-only; verificar
                     el soporte de imágenes antes de usarla como fallback)
  - Cualquier otro proveedor compatible con /v1/chat/completions.

Las credenciales se leen de settings.py (bloque FALLBACK_AI_*). La respuesta
se parsea con el MISMO esquema JSON unificado que Gemini
(PROMPT_SISTEMA_CATALOGACION en ai_vision_service), por lo que el usuario no
nota el corte. Si este motor también falla, la excepción original de cuota se
re-lanza para que el endpoint siga respondiendo 429 con el mensaje claro.
"""

import logging
import time
from typing import Optional, Dict, Any

from django.core.exceptions import ImproperlyConfigured

# El prompt único y el parser de JSON compartidos viven en ai_vision_service
# para garantizar que ambos motores devuelvan EXACTAMENTE el mismo esquema.
from .ai_vision_service import (
    PROMPT_SISTEMA_CATALOGACION,
    TEXTO_USUARIO_ANALISIS,
    _extraer_json_de_respuesta,
    es_error_cuota_excedida,
    AIQuotaExceededError,
)

logger = logging.getLogger(__name__)


class OpenAICompatVisionClient:
    """
    Cliente de visión compatible con OpenAI Chat Completions.

    Se usa como SEGUNDO motor (fallback) cuando Gemini devuelve HTTP 429.
    Lazy-inicializa el cliente `openai.OpenAI` para no endurecer la dependencia
    en el import del módulo.
    """

    def __init__(self):
        from django.conf import settings

        if not getattr(settings, 'FALLBACK_AI_ENABLED', True):
            raise ImproperlyConfigured(
                "El motor de respaldo de IA está deshabilitado "
                "(FALLBACK_AI_ENABLED=False)."
            )

        self.api_key = getattr(settings, 'FALLBACK_AI_API_KEY', '') or ''
        self.base_url = getattr(settings, 'FALLBACK_AI_BASE_URL', '') or ''
        self.model = getattr(settings, 'FALLBACK_AI_MODEL', '') or ''
        self.timeout = getattr(settings, 'FALLBACK_AI_TIMEOUT', 120)

        if not self.api_key:
            raise ImproperlyConfigured(
                "FALLBACK_AI_API_KEY (o DEEPSEEK_API_KEY / OPENROUTER_API_KEY) "
                "no está configurada. Sin API key no hay motor de respaldo."
            )
        if not self.base_url or not self.model:
            raise ImproperlyConfigured(
                "FALLBACK_AI_BASE_URL y FALLBACK_AI_MODEL son obligatorios "
                "para el motor de respaldo de IA."
            )

        self._client = None

    def _get_client(self):
        """Inicializa el cliente OpenAI si no está creado (lazy)."""
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout,
            )
        return self._client

    def analyze_base64(
        self,
        image_base64: str,
        rag_context: str = "",
    ) -> Optional[Dict[str, Any]]:
        """
        Envía una imagen en Base64 al motor de respaldo para análisis.

        Args:
            image_base64: Imagen codificada en Base64 (con o sin prefijo
                data:image).
            rag_context: Contexto de objetos similares ya catalogados
                (opcional).

        Returns:
            Diccionario con la respuesta JSON del modelo (mismo esquema
            unificado que Gemini), o None si falla.
        """
        if ',' in image_base64:
            image_base64 = image_base64.split(',', 1)[1]

        system_prompt = PROMPT_SISTEMA_CATALOGACION
        if rag_context:
            system_prompt += "\n\n" + rag_context

        data_url = f"data:image/jpeg;base64,{image_base64}"
        start_time = time.time()

        try:
            client = self._get_client()
            response = client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": TEXTO_USUARIO_ANALISIS,
                            },
                            {
                                "type": "image_url",
                                "image_url": {"url": data_url},
                            },
                        ],
                    }
                ],
                temperature=0.1,
                max_tokens=1024,
            )

            elapsed = time.time() - start_time
            content = (response.choices[0].message.content or "").strip()
            if not content:
                logger.error(
                    "Motor de respaldo (%s) respondió sin contenido.", self.model
                )
                return None

            logger.info(
                "Motor de respaldo (%s) respondió en %.1fs.", self.model, elapsed
            )
            logger.info("Respuesta fallback (primeros 300): %s", content[:300])

            result = _extraer_json_de_respuesta(content)
            if result is not None:
                logger.info(
                    "JSON del fallback parseado correctamente. Campos: %s",
                    list(result.keys()),
                )
            return result

        except Exception as e:
            elapsed = time.time() - start_time
            logger.error(
                "Error al comunicarse con el motor de respaldo (%s) después "
                "de %.1fs: %s",
                self.model,
                elapsed,
                e,
            )
            if es_error_cuota_excedida(e):
                logger.error(
                    "El motor de respaldo también devolvió cuota/rate limit."
                )
                raise AIQuotaExceededError(str(e)) from e
            return None

    def _check_health(self) -> bool:
        """
        Verifica que la API key del motor de respaldo sea válida.

        No ejecuta inferencia: solo lista modelos para confirmar autenticación.
        """
        try:
            client = self._get_client()
            client.models.list()
            return True
        except Exception as e:
            logger.warning("Motor de respaldo no disponible: %s", e)
            return False

