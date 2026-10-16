"""
Servicio de Visión por IA — Motor exclusivo: Gemini 2.5 Flash-Lite.

Conecta con la API de Google Gemini usando el SDK google-genai para procesar
imágenes de objetos y extraer información estructurada.

Taxonomía unificada:
- La clasificación se hace EXCLUSIVAMENTE con la FK `categoria` del modelo
  Objeto, apuntando a una de las 11 categorías oficiales de Mercado Libre
  (definidas por su `meli_category_id`).
- Ya NO se crean subclases multi-tabla (LibroRevista, Tecnologia, MuebleArte,
  Ropa). Todos los campos específicos (autor, marca, material, tamano, etc.)
  se escriben directamente sobre el Objeto.
"""

import json
import logging
import base64
import os
import re
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field, asdict
from decimal import Decimal

from django.core.exceptions import ImproperlyConfigured

# --- Contrato publico re-exportado (compatibilidad de imports existentes) ---
from .ai_vision_nucleo import (  # noqa: F401
    CONFIANZA_MINIMA, MAX_IMAGE_SIZE_MB, COMPRESS_QUALITY, MAX_IMAGE_DIMENSION,
    MENSAJE_LIMITE_IA, AIQuotaExceededError, es_error_cuota_excedida,
    CATEGORIAS_MELI_OFICIALES, VisionResult,
    PROMPT_SISTEMA_CATALOGACION, TEXTO_USUARIO_ANALISIS, _extraer_json_de_respuesta,
)
from .ai_vision_gemini import GeminiClient  # noqa: F401
from .ai_vision_creacion import AIVisionCreacionMixin

logger = logging.getLogger(__name__)


# =============================================================================
# SERVICIO DE VISION
# =============================================================================
class AIVisionService(AIVisionCreacionMixin):
    """
    Servicio principal de visión por IA.
    Orquesta el análisis de imágenes y la lógica de campos pendientes.
    Motor exclusivo: Gemini 2.5 Flash-Lite.

    Crea instancias directas del modelo Objeto (taxonomía unificada) y
    asigna la categoría usando los meli_category_id oficiales.
    """

    def __init__(self):
        self._gemini_client = None

    def _get_gemini_client(self) -> GeminiClient:
        """Lazy initialization del cliente Gemini."""
        if self._gemini_client is None:
            self._gemini_client = GeminiClient()
        return self._gemini_client

    def _buscar_objetos_similares(self, max_resultados: int = 5) -> str:
        """
        Busca objetos ya catalogados en la BD para usarlos como contexto (RAG).
        Delega en rag_service.buscar_objetos_similares().
        """
        from .rag_service import buscar_objetos_similares as _buscar
        return _buscar(max_resultados=max_resultados)

    def _comprimir_imagen_base64(
        self,
        image_base64: str,
        max_size_mb: float = 1.0,
        max_dimension: int = MAX_IMAGE_DIMENSION,
        quality: int = COMPRESS_QUALITY,
    ) -> str:
        """
        Comprime una imagen en Base64 si excede el tamaño máximo.
        Usa PIL/Pillow para redimensionar y comprimir.

        Args:
            image_base64: Imagen en formato Base64 (con o sin prefijo data:image).
            max_size_mb: Tamaño máximo en MB para la imagen comprimida.
            max_dimension: Máximo de píxeles en el lado mayor.
            quality: Calidad JPEG.

        Returns:
            Imagen Base64 comprimida (sin prefijo data:image).
        """
        if ',' in image_base64:
            image_base64 = image_base64.split(',', 1)[1]

        estimated_bytes = len(image_base64) * 0.73
        estimated_mb = estimated_bytes / (1024 * 1024)

        if estimated_mb <= max_size_mb:
            return image_base64

        logger.info(
            "Comprimiendo imagen: %.2fMB -> objetivo <%.2fMB (max_dim=%dpx, quality=%d%%)",
            estimated_mb, max_size_mb, max_dimension, quality
        )

        try:
            from PIL import Image
            import io

            image_bytes = base64.b64decode(image_base64)
            img = Image.open(io.BytesIO(image_bytes))

            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')

            if max(img.width, img.height) > max_dimension:
                ratio = max_dimension / max(img.width, img.height)
                new_width = int(img.width * ratio)
                new_height = int(img.height * ratio)
                img = img.resize((new_width, new_height), Image.LANCZOS)
                logger.info("Imagen redimensionada a %dx%d", new_width, new_height)

            output = io.BytesIO()
            current_quality = quality
            img.save(output, format='JPEG', quality=current_quality, optimize=True)

            compressed_size_mb = len(output.getvalue()) / (1024 * 1024)
            while compressed_size_mb > max_size_mb and current_quality > 10:
                current_quality -= 5
                output = io.BytesIO()
                img.save(output, format='JPEG', quality=current_quality, optimize=True)
                compressed_size_mb = len(output.getvalue()) / (1024 * 1024)

            compressed_b64 = base64.b64encode(output.getvalue()).decode('utf-8')
            logger.info(
                "Imagen comprimida: %.2fMB -> %.2fMB (calidad: %d%%)",
                estimated_mb, compressed_size_mb, current_quality
            )
            return compressed_b64

        except ImportError:
            logger.warning("Pillow no instalado. Enviando imagen sin comprimir.")
            return image_base64
        except Exception as e:
            logger.error("Error al comprimir imagen: %s", e)
            return image_base64

    def _determinar_campos_pendientes(self, result: Dict[str, Any]) -> List[str]:
        """
        Analiza el resultado de la IA y determina qué campos
        tienen baja confianza o están vacíos.

        Retorna una lista de nombres de campos que requieren input del usuario.
        """
        campos_pendientes = []
        confianza = result.get("confianza_general", 0)

        campos_obligatorios = ["nombre", "estado_conservacion"]
        for campo in campos_obligatorios:
            valor = result.get(campo, "")
            if not valor or (isinstance(valor, str) and valor.strip() == ""):
                campos_pendientes.append(campo)

        if confianza < CONFIANZA_MINIMA:
            campos_a_revisar = ["marca", "autor", "anio", "precio_estimado_mercado", "color"]
            for campo in campos_a_revisar:
                valor = result.get(campo)
                if not valor or (isinstance(valor, str) and valor.strip() == "") or valor is None:
                    campos_pendientes.append(campo)

        # Un objeto sin categoría oficial asignable requiere la decisión del usuario
        meli_category_id = result.get("meli_category_id") or MAPEO_CATEGORIA_LEGADA_A_MELI.get(
            result.get("categoria", ""), ""
        )
        if not meli_category_id:
            campos_pendientes.append("categoria")

        # Si es un libro (por campos detectados), autor y año son relevantes
        if result.get("isbn_issn") or result.get("editorial") or result.get("nombre_serie"):
            if not result.get("autor"):
                campos_pendientes.append("autor")
            if not result.get("anio"):
                campos_pendientes.append("anio")

        if result.get("categoria") in ("tecnologia", "computacion"):
            if not result.get("marca"):
                campos_pendientes.append("marca")

        return list(set(campos_pendientes))

    def _mapear_resultado(self, raw_result: Dict[str, Any]) -> VisionResult:
        """
        Mapea el resultado crudo de la IA a un VisionResult estructurado.
        Resuelve el meli_category_id oficial (con fallback de la taxonomía legada).
        """
        categoria_legada = raw_result.get("categoria", "otro")
        meli_category_id = raw_result.get("meli_category_id") or raw_result.get("categoria_meli")
        if not meli_category_id:
            meli_category_id = MAPEO_CATEGORIA_LEGADA_A_MELI.get(categoria_legada, "") or ""

        result = VisionResult(
            nombre=raw_result.get("nombre", ""),
            marca=raw_result.get("marca", ""),
            autor=raw_result.get("autor", ""),
            anio=raw_result.get("anio"),
            estado_conservacion=raw_result.get("estado_conservacion", ""),
            precio_estimado_mercado=raw_result.get("precio_estimado_mercado"),
            descripcion=raw_result.get("descripcion", ""),
            color=raw_result.get("color", ""),
            categoria=categoria_legada,
            meli_category_id=str(meli_category_id) if meli_category_id else "",
            confianza_general=raw_result.get("confianza_general", 0.0),
            raw_response=json.dumps(raw_result),
            isbn_issn=raw_result.get("isbn_issn", ""),
            edicion=raw_result.get("edicion", ""),
            nombre_serie=raw_result.get("nombre_serie", ""),
            titulo_tomo=raw_result.get("titulo_tomo", ""),
            numero_tomo=raw_result.get("numero_tomo"),
            editorial=raw_result.get("editorial", ""),
            idioma=raw_result.get("idioma", ""),
        )
        result.campos_pendientes = self._determinar_campos_pendientes(raw_result)
        return result

    def _vision_result_no_disponible(self, mensaje: str) -> VisionResult:
        """Retorna un VisionResult con todos los campos como pendientes."""
        return VisionResult(
            confianza_general=0.0,
            campos_pendientes=[
                "nombre", "marca", "autor", "anio",
                "estado_conservacion", "precio_estimado_mercado",
                "descripcion", "color", "categoria"
            ],
            raw_response=mensaje,
        )

    def procesar_imagen(self, image_path: str) -> VisionResult:
        """
        Procesa una imagen desde una ruta de archivo y retorna un VisionResult.
        Comprime la imagen automáticamente antes de enviarla a Gemini.

        Args:
            image_path: Ruta a la imagen a analizar.

        Returns:
            VisionResult con los datos extraídos y campos pendientes.
        """
        with open(image_path, "rb") as f:
            image_b64 = base64.b64encode(f.read()).decode("utf-8")
        return self.procesar_imagen_desde_base64(image_b64)

    def procesar_imagen_desde_bytes(self, image_bytes: bytes, filename: str = "temp.jpg") -> VisionResult:
        """
        Procesa una imagen desde bytes (útil para uploads).

        Args:
            image_bytes: Contenido binario de la imagen.
            filename: Nombre temporal para guardar la imagen.

        Returns:
            VisionResult con los datos extraídos.
        """
        temp_path = Path(f"/tmp/{filename}")
        temp_path.write_bytes(image_bytes)
        try:
            return self.procesar_imagen(str(temp_path))
        finally:
            if temp_path.exists():
                temp_path.unlink()

    def procesar_imagen_desde_base64(self, image_base64: str) -> VisionResult:
        """
        Procesa una imagen desde una cadena Base64 usando Gemini.
        Es un alias de procesar_imagen_desde_base64_con_motor(motor='gemini').

        Args:
            image_base64: Imagen codificada en Base64.

        Returns:
            VisionResult con los datos extraídos y campos pendientes.
        """
        return self.procesar_imagen_desde_base64_con_motor(image_base64, motor='gemini')

    def procesar_imagen_desde_base64_con_motor(self, image_base64: str, motor: str = 'gemini') -> VisionResult:
        """
        Procesa una imagen desde una cadena Base64 usando el motor de visión.

        Args:
            image_base64: Imagen codificada en Base64.
            motor: 'gemini' (único motor). Cualquier otro valor se resuelve
                   igualmente con Gemini: no existe integración de IA local.

        Returns:
            VisionResult con los datos extraídos y campos pendientes.
        """
        # Buscar objetos similares ya catalogados (RAG) para mejorar precisión
        rag_context = self._buscar_objetos_similares()
        if rag_context:
            logger.info("RAG: incluyendo objetos similares como contexto")

        # Gemini: compresión ligera para reducir payload y latencia
        image_base64_comprimida = self._comprimir_imagen_base64(
            image_base64,
            max_size_mb=1.0,
            max_dimension=1024,
            quality=70,
        )

        gemini_client = self._get_gemini_client()
        try:
            raw_result = gemini_client.analyze_base64(
                image_base64_comprimida, rag_context=rag_context
            )
        except AIQuotaExceededError as e:
            # FAILOVER AUTOMÁTICO: Gemini devolvió HTTP 429 (rate limit /
            # cuota agotada). Se conmuta al motor de respaldo (OpenRouter /
            # DeepSeek u otro OpenAI-compatible) sin que el usuario note el
            # corte. El motor de respaldo devuelve el MISMO JSON unificado.
            logger.warning(
                "Cuota/rate limit de Gemini (HTTP 429) al procesar imagen. "
                "Ejecutando failover automático al motor de respaldo..."
            )
            return self._procesar_con_failover(
                image_base64_comprimida,
                rag_context=rag_context,
                error_original=e,
            )

        if raw_result is None:
            return self._vision_result_no_disponible("Gemini no disponible")

        return self._mapear_resultado(raw_result)

    def _procesar_con_failover(
        self,
        image_base64: str,
        rag_context: str = "",
        error_original: Optional[Exception] = None,
    ) -> VisionResult:
        """
        Conmuta al motor de respaldo (OpenAI-compatible) cuando Gemini devuelve
        HTTP 429.

        Si el motor de respaldo también falla o no está configurado, re-lanza
        la excepción original de cuota para que el endpoint responda 429 con
        el mensaje claro al usuario (nunca se deja al usuario sin respuesta).
        """
        from django.conf import settings

        if not getattr(settings, 'FALLBACK_AI_ENABLED', True):
            logger.warning(
                "Failover deshabilitado (FALLBACK_AI_ENABLED=False). "
                "Se propaga el error original de cuota."
            )
            raise error_original if error_original else AIQuotaExceededError()

        try:
            from .ai_failover_service import OpenAICompatVisionClient

            fallback = OpenAICompatVisionClient()
            raw_result = fallback.analyze_base64(
                image_base64, rag_context=rag_context
            )
        except ImproperlyConfigured as e:
            logger.error(
                "Motor de respaldo no configurado (%s). Re-propagando el error "
                "original de cuota.",
                e,
            )
            raise error_original if error_original else AIQuotaExceededError()
        except Exception as e:
            logger.error(
                "El motor de respaldo también falló (%s). Re-propagando el "
                "error original de cuota.",
                e,
            )
            raise error_original if error_original else AIQuotaExceededError()

        if raw_result is None:
            logger.error(
                "El motor de respaldo no devolvió resultado. Re-propagando el "
                "error original de cuota."
            )
            raise error_original if error_original else AIQuotaExceededError()

        logger.warning(
            "Failover exitoso: la imagen se procesó con el motor de respaldo "
            "(%s) en lugar de Gemini.",
            fallback.model,
        )
        resultado = self._mapear_resultado(raw_result)
        resultado.motor_utilizado = fallback.model
        return resultado

