"""
Servicio de respaldo (FAILOVER) para la visión por IA — CADENA MULTI-MOTOR.

Se activa AUTOMÁTICAMENTE cuando el motor primario (Gemini `GEMINI_MODEL`)
responde HTTP 429 (Rate Limit / cuota agotada) o no devuelve un resultado
utilizable. La cadena se recorre EN ORDEN y devuelve el primer JSON válido:

  1. Gemini con OTRO modelo y la MISMA API key
     (`GEMINI_FALLBACK_MODELS`). La cuota gratuita diaria de Google es POR
     MODELO (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`), así que
     cuando gemini-2.5-flash-lite agota sus 20 análisis/día, otro modelo
     (gemini-3.1-flash-lite, gemini-3.5-flash-lite, …) tiene cuota PROPIA.
     Verificado en producción: aceptan imágenes con la misma key.
  2. Gemini con API keys ADICIONALES (`GEMINI_FALLBACK_API_KEYS`,
     `GEMINI_API_KEY_2..5`), útil con una segunda cuenta/proyecto de Google.
  3. Proveedor OpenAI-compatible (`FALLBACK_AI_*`): OpenRouter, DeepSeek,
     Groq, Hugging Face Router o cualquier API con /v1/chat/completions y
     soporte de imágenes.

La URL del proveedor se NORMALIZA: un valor incompleto como
`https://groq.com` se corrige a `https://api.groq.com/openai/v1` (bug real
detectado en producción: la URL sin `/openai/v1` devolvía el HTML del sitio
y el fallback nunca podía responder).

Todos los motores comparten el MISMO prompt (PROMPT_SISTEMA_CATALOGACION) y
el MISMO parser de JSON, por lo que el esquema de respuesta es idéntico y el
usuario no nota el corte. Si TODA la cadena falla, se lanza
`AIQuotaExceededError` para que el endpoint responda 429 con un mensaje
claro y el frontend permita seguir completando el formulario a mano.
"""

import logging
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from django.core.exceptions import ImproperlyConfigured

# El prompt único y el parser de JSON compartidos viven en el núcleo para
# garantizar que TODOS los motores devuelvan EXACTAMENTE el mismo esquema
# (importar de ai_vision_nucleo evita un ciclo con ai_vision_service).
from .ai_vision_nucleo import (
    PROMPT_SISTEMA_CATALOGACION,
    TEXTO_USUARIO_ANALISIS,
    _extraer_json_de_respuesta,
    es_error_cuota_excedida,
    AIQuotaExceededError,
)
from .ai_vision_gemini import GeminiClient

logger = logging.getLogger(__name__)

# Prefijo ÚNICO de los logs del fallback (permite filtrarlos en producción).
ETIQUETA_LOG = '[IA Fallback]'

# Bases oficiales de los proveedores conocidos. Corrigen configuraciones
# incompletas de Coolify sin exigir que el operador recuerde la ruta exacta.
BASES_CONOCIDAS = {
    'groq.com': 'https://api.groq.com/openai/v1',
    'api.groq.com': 'https://api.groq.com/openai/v1',
    'openrouter.ai': 'https://openrouter.ai/api/v1',
    'api.openrouter.ai': 'https://openrouter.ai/api/v1',
    'deepseek.com': 'https://api.deepseek.com/v1',
    'api.deepseek.com': 'https://api.deepseek.com/v1',
    'huggingface.co': 'https://router.huggingface.co/v1',
    'router.huggingface.co': 'https://router.huggingface.co/v1',
}


def normalizar_base_url_proveedor(url: str) -> str:
    """
    Normaliza la base_url de un proveedor OpenAI-compatible.

    Casos reales atendidos:
      · `https://groq.com`            → `https://api.groq.com/openai/v1`
      · `api.groq.com`                → `https://api.groq.com/openai/v1`
      · `https://openrouter.ai`       → `https://openrouter.ai/api/v1`
      · `https://api.deepseek.com`    → `https://api.deepseek.com/v1`
      · `https://.../openai/v1`       → se respeta tal cual
    """
    base = (url or '').strip()
    if not base:
        return ''
    if '://' not in base:
        base = 'https://' + base

    partes = urlparse(base)
    host = (partes.hostname or '').lower()
    ruta = (partes.path or '').rstrip('/')
    oficial = BASES_CONOCIDAS.get(host)
    if not oficial:
        return base.rstrip('/')
    if ruta in ('', '/'):
        return oficial
    # Ruta ya declarada por el operador: solo se corrige si NO es una ruta API.
    if host.endswith('groq.com') and 'openai' not in ruta:
        return 'https://api.groq.com/openai/v1'
    if host.endswith('openrouter.ai') and '/api' not in ruta:
        return 'https://openrouter.ai/api/v1'
    return base.rstrip('/')



class OpenAICompatVisionClient:
    """
    Cliente de visión compatible con OpenAI Chat Completions.

    Se usa como motor de respaldo cuando Gemini devuelve HTTP 429.
    Lazy-inicializa el cliente `openai.OpenAI` para no endurecer la
    dependencia en el import del módulo.

    Los parámetros opcionales permiten instanciar VARIOS proveedores
    (OpenRouter, Groq, Hugging Face) en la misma cadena sin duplicar lógica.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        timeout: Optional[int] = None,
    ):
        from django.conf import settings

        if not getattr(settings, 'FALLBACK_AI_ENABLED', True):
            raise ImproperlyConfigured(
                "El motor de respaldo de IA está deshabilitado "
                "(FALLBACK_AI_ENABLED=False)."
            )

        self.api_key = (api_key or getattr(
            settings, 'FALLBACK_AI_API_KEY', ''
        ) or '').strip()
        self.base_url = normalizar_base_url_proveedor(
            base_url if base_url is not None
            else getattr(settings, 'FALLBACK_AI_BASE_URL', '')
        )
        self.model = (model or getattr(
            settings, 'FALLBACK_AI_MODEL', ''
        ) or '').strip()
        self.timeout = timeout or getattr(settings, 'FALLBACK_AI_TIMEOUT', 120)

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

        self.etiqueta = f'openai-compatible:{self.model}'
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
                        "role": "system",
                        "content": system_prompt,
                    },
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
                    "%s Motor de respaldo (%s) respondió sin contenido.",
                    ETIQUETA_LOG, self.model,
                )
                return None

            logger.info(
                "%s Motor de respaldo (%s) respondió en %.1fs.",
                ETIQUETA_LOG, self.model, elapsed,
            )
            logger.info(
                "%s Respuesta fallback (primeros 300): %s",
                ETIQUETA_LOG, content[:300],
            )

            result = _extraer_json_de_respuesta(content)
            if result is not None:
                logger.info(
                    "%s JSON del fallback parseado correctamente. Campos: %s",
                    ETIQUETA_LOG, list(result.keys()),
                )
            return result

        except Exception as e:
            elapsed = time.time() - start_time
            logger.error(
                "%s Error al comunicarse con el motor de respaldo (%s) "
                "después de %.1fs: %s",
                ETIQUETA_LOG, self.model, elapsed, e,
            )
            if es_error_cuota_excedida(e):
                logger.error(
                    "%s El motor de respaldo también devolvió cuota/rate limit.",
                    ETIQUETA_LOG,
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



# =============================================================================
# CADENA DE RESPALDO
# =============================================================================
def _modelos_gemini_respaldo() -> List[str]:
    """Modelos Gemini alternativos configurados, sin repetir el primario."""
    from django.conf import settings

    primario = (getattr(settings, 'GEMINI_MODEL', '') or '').strip().lower()
    vistos = {primario} if primario else set()
    modelos: List[str] = []
    for modelo in getattr(settings, 'GEMINI_FALLBACK_MODELS', []) or []:
        limpio = str(modelo or '').strip()
        if limpio and limpio.lower() not in vistos:
            vistos.add(limpio.lower())
            modelos.append(limpio)
    return modelos


def _proveedores_openai_compat() -> List[Tuple[str, Dict[str, Any]]]:
    """
    Proveedores OpenAI-compatible configurados, en orden de prioridad.

    Evita duplicar el mismo proveedor cuando su key es la MISMA que la
    principal (`FALLBACK_AI_API_KEY` ya resuelve OPENROUTER_API_KEY).
    """
    from django.conf import settings

    principal = (getattr(settings, 'FALLBACK_AI_API_KEY', '') or '').strip()
    proveedores: List[Tuple[str, Dict[str, Any]]] = []
    if principal:
        proveedores.append(('openai-compatible', {}))

    claves = {principal} if principal else set()
    groq = (getattr(settings, 'GROQ_API_KEY', '') or '').strip()
    if groq and groq not in claves:
        claves.add(groq)
        proveedores.append(('groq', {
            'api_key': groq,
            'base_url': 'https://api.groq.com/openai/v1',
            'model': getattr(settings, 'GROQ_VISION_MODEL', ''),
        }))

    hf = (getattr(settings, 'HUGGINGFACE_API_KEY', '') or '').strip()
    if hf and hf not in claves:
        claves.add(hf)
        proveedores.append(('huggingface', {
            'api_key': hf,
            'base_url': 'https://router.huggingface.co/v1',
            'model': getattr(settings, 'HUGGINGFACE_VISION_MODEL', ''),
        }))
    return proveedores


def crear_cadena_respaldo() -> List[Tuple[str, Any]]:
    """
    Construye la cadena ORDENADA de motores secundarios.

    Returns:
        Lista de `(etiqueta, cliente)`; cada cliente expone `analyze_base64`.
    """
    from django.conf import settings

    if not getattr(settings, 'FALLBACK_AI_ENABLED', True):
        logger.warning(
            "%s Failover deshabilitado (FALLBACK_AI_ENABLED=False).",
            ETIQUETA_LOG,
        )
        return []

    timeout = getattr(settings, 'GEMINI_FALLBACK_TIMEOUT', 60)
    cadena: List[Tuple[str, Any]] = []

    # 1) Mismo Gemini con OTRO modelo (cuota diaria independiente por modelo).
    for modelo in _modelos_gemini_respaldo():
        try:
            cadena.append((
                f'gemini:{modelo}',
                GeminiClient(model=modelo, timeout=timeout),
            ))
        except ImproperlyConfigured as exc:
            logger.warning(
                "%s Gemini de respaldo (%s) no configurado: %s",
                ETIQUETA_LOG, modelo, exc,
            )

    # 2) Gemini con API keys adicionales (segunda cuenta/proyecto de Google).
    for indice, clave in enumerate(
        getattr(settings, 'GEMINI_FALLBACK_API_KEYS', []) or [], start=2
    ):
        try:
            cadena.append((
                f'gemini-key-{indice}',
                GeminiClient(api_key=clave, timeout=timeout),
            ))
        except ImproperlyConfigured as exc:
            logger.warning(
                "%s Gemini key #%s no configurada: %s",
                ETIQUETA_LOG, indice, exc,
            )

    # 3) Proveedores OpenAI-compatible (OpenRouter / DeepSeek / Groq / HF).
    for etiqueta, extra in _proveedores_openai_compat():
        try:
            cliente = OpenAICompatVisionClient(**extra)
            cadena.append((f'{etiqueta}:{cliente.model}', cliente))
        except ImproperlyConfigured as exc:
            logger.warning(
                "%s Proveedor %s no configurado: %s", ETIQUETA_LOG, etiqueta, exc
            )

    return cadena



def analizar_con_cadena(
    image_base64: str,
    rag_context: str = "",
) -> Tuple[Dict[str, Any], str]:
    """
    Recorre la cadena de IA secundaria y devuelve el primer resultado válido.

    Args:
        image_base64: Imagen comprimida en Base64 (sin prefijo data:image).
        rag_context: Contexto RAG de objetos ya catalogados (opcional).

    Returns:
        `(json_del_modelo, etiqueta_del_motor_que_respondió)`.

    Raises:
        AIQuotaExceededError: si NINGÚN motor de la cadena pudo responder.
    """
    cadena = crear_cadena_respaldo()
    if not cadena:
        logger.error(
            "%s No hay IA secundaria configurada "
            "(GEMINI_FALLBACK_MODELS / FALLBACK_AI_API_KEY).",
            ETIQUETA_LOG,
        )
        raise AIQuotaExceededError(
            'No hay proveedores de IA secundarios configurados.'
        )

    from django.conf import settings

    # Presupuesto TOTAL de la cadena: evita dejar colgado el fetch del navegador.
    max_total = getattr(settings, 'FALLBACK_AI_MAX_TOTAL', 180)
    limite = time.monotonic() + max_total if max_total else None

    errores: List[str] = []
    for etiqueta, cliente in cadena:
        if limite is not None and time.monotonic() >= limite:
            logger.warning(
                "%s Tiempo máximo de la cadena (%ss) alcanzado; se cortan "
                "los intentos restantes.", ETIQUETA_LOG, max_total,
            )
            errores.append(f'tiempo máximo ({max_total}s) alcanzado')
            break

        logger.warning("%s Probando IA secundaria: %s", ETIQUETA_LOG, etiqueta)
        try:
            resultado = cliente.analyze_base64(
                image_base64, rag_context=rag_context
            )
        except Exception as exc:  # noqa: BLE001 — un motor caído no corta la cadena
            logger.warning("%s %s falló: %s", ETIQUETA_LOG, etiqueta, exc)
            errores.append(f'{etiqueta}: {exc}')
            continue

        if resultado:
            logger.warning(
                "%s IA secundaria OK: %s (%s intento/s fallido/s antes).",
                ETIQUETA_LOG, etiqueta, len(errores),
            )
            return resultado, etiqueta

        logger.warning(
            "%s %s no devolvió un JSON utilizable.", ETIQUETA_LOG, etiqueta
        )
        errores.append(f'{etiqueta}: sin JSON')

    logger.error(
        "%s Toda la cadena de IA secundaria falló (%s intento/s): %s",
        ETIQUETA_LOG, len(cadena), ' | '.join(errores)[:500],
    )
    raise AIQuotaExceededError(
        ' | '.join(errores)[:500] or 'Todos los motores de IA fallaron.'
    )

