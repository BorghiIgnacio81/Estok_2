"""
Servicio de Visión por IA Local (LM Studio + Qwen2-VL-7B).

Conecta con la API local de LM Studio en http://localhost:1234/v1
usando la librería `openai` (compatible con OpenAI API) para procesar
imágenes de objetos y extraer información estructurada.

Optimizado para GPU AMD Radeon RX 9060 XT con 8GB VRAM.

Flujo:
  1. Recibe una imagen (path, bytes o Base64)
  2. La envía al modelo local solicitando un JSON estructurado
  3. Analiza la respuesta y determina campos con baja confianza
  4. Retorna datos estructurados + lista de campos pendientes
  5. Alimenta el Historial de Precios para reportes de valoración
"""

import json
import logging
import base64
import os
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field, asdict
from decimal import Decimal

from openai import OpenAI

logger = logging.getLogger(__name__)


# =============================================================================
# CONFIGURACIÓN (desde variables de entorno de Django)
# =============================================================================
from django.conf import settings

LM_STUDIO_URL = getattr(settings, 'AI_API_ENDPOINT', "http://localhost:1234/v1")
LM_STUDIO_TIMEOUT = getattr(settings, 'AI_API_TIMEOUT', 120)
LM_STUDIO_TIMEOUT_ALTA_RES = getattr(settings, 'AI_HIGH_RES_TIMEOUT', 180)
CONFIANZA_MINIMA = 0.6  # umbral mínimo de confianza para considerar un campo válido
# Nombre del modelo desplegado en LM Studio
# Podés ver los modelos disponibles en http://localhost:1234/v1/models
# Si cambiás de modelo en LM Studio, actualizá este valor
MODEL_NAME = "qwen2.5-vl-7b-instruct"  # modelo desplegado en LM Studio
MAX_IMAGE_SIZE_MB = 10  # tamaño máximo de imagen en MB
# El modelo qwen2.5-vl-7b-instruct tiene contexto de solo 4096 tokens.
# La imagen en Base64 + prompt no debe exceder ese límite.
# Con calidad 30 y resolución 640px, una imagen ocupa ~200-400 tokens.
MAX_IMAGE_SIZE_FOR_GPU_MB = 1  # tamaño máximo para enviar a GPU (comprimir si excede)
COMPRESS_QUALITY = 30  # calidad JPEG para compresión (0-100) - baja para no exceder 4096 tokens
MAX_IMAGE_DIMENSION = 640  # resolución máxima para no exceder contexto del modelo





# =============================================================================
# ESTRUCTURAS DE DATOS
# =============================================================================
@dataclass
class VisionResult:
    """Resultado del análisis de visión por IA."""
    nombre: str = ""
    marca: str = ""
    autor: str = ""
    anio: Optional[int] = None
    estado_conservacion: str = ""
    precio_estimado_mercado: Optional[float] = None
    descripcion: str = ""
    color: str = ""
    categoria: str = ""  # libro, tecnologia, mueble, ropa, otro
    confianza_general: float = 0.0
    campos_pendientes: List[str] = field(default_factory=list)
    raw_response: str = ""
    # Campos específicos para libros
    isbn_issn: str = ""
    edicion: str = ""
    # Campos específicos para cómics
    nombre_serie: str = ""
    titulo_tomo: str = ""
    numero_tomo: Optional[int] = None
    editorial: str = ""
    idioma: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if k != 'raw_response'}


# =============================================================================
# CLIENTE LM STUDIO (usando librería openai)
# =============================================================================
class LMStudioClient:
    """
    Cliente para conectar con la API local de LM Studio.
    Utiliza la librería `openai` que es compatible con la API de OpenAI
    y funciona con servidores locales como LM Studio.

    Optimizado para GPU AMD Radeon RX 9060 XT con 8GB VRAM.
    """

    def __init__(self, base_url: str = LM_STUDIO_URL, timeout: int = LM_STUDIO_TIMEOUT):
        self.base_url = base_url
        self.timeout = timeout
        # Cliente OpenAI apuntando al servidor local de LM Studio
        self.client = OpenAI(
            base_url=base_url,
            api_key="not-needed",  # LM Studio no requiere API key
            timeout=timeout,
            max_retries=2,
        )

    def _check_health(self) -> bool:
        """Verifica que el servidor de LM Studio esté corriendo."""
        try:
            models = self.client.models.list()
            return True
        except Exception as e:
            logger.warning("LM Studio no está disponible en %s: %s", self.base_url, e)
            return False

    def _encode_image(self, image_path: str) -> str:
        """Codifica una imagen a base64."""
        with open(image_path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")

    def analyze_image(self, image_path: str) -> Optional[Dict[str, Any]]:
        """
        Envía una imagen al modelo local para análisis.

        Args:
            image_path: Ruta absoluta o relativa a la imagen.

        Returns:
            Diccionario con la respuesta JSON del modelo, o None si falla.
        """
        if not self._check_health():
            logger.error("LM Studio no está disponible")
            return None

        # Codificar imagen
        try:
            image_b64 = self._encode_image(image_path)
        except FileNotFoundError:
            logger.error("Imagen no encontrada: %s", image_path)
            return None
        except Exception as e:
            logger.error("Error al codificar imagen: %s", e)
            return None

        return self._analyze_base64(image_b64)

    def analyze_base64(self, image_base64: str, rag_context: str = "") -> Optional[Dict[str, Any]]:
        """
        Envía una imagen en formato Base64 al modelo local para análisis.

        Args:
            image_base64: Imagen codificada en Base64.
            rag_context: Contexto de objetos similares ya catalogados (opcional).

        Returns:
            Diccionario con la respuesta JSON del modelo, o None si falla.
        """
        if not self._check_health():
            logger.error("LM Studio no está disponible")
            return None

        return self._analyze_base64(image_base64, rag_context=rag_context)

    def _detect_high_resolution(self, image_b64: str) -> bool:
        """
        Detecta si una imagen es de alta resolución (>4K) basado en el tamaño del Base64.
        Una imagen 4K JPEG (~8-10MB) produce ~11-13MB en Base64.
        """
        try:
            # Estimar tamaño original: Base64 es ~37% más grande que el binario
            estimated_bytes = len(image_b64) * 0.73
            estimated_mb = estimated_bytes / (1024 * 1024)
            return estimated_mb > 5  # >5MB estimado = probable alta resolución
        except:
            return False

    def _analyze_base64(self, image_b64: str, rag_context: str = "") -> Optional[Dict[str, Any]]:
        """
        Lógica interna para analizar una imagen en Base64.
        Maneja timeouts dinámicos según la resolución estimada de la imagen.
        Si se proporciona rag_context, lo incluye en el prompt del sistema
        para mejorar la precisión basándose en objetos ya catalogados.

        Args:
            image_b64: Imagen codificada en Base64.
            rag_context: Contexto de objetos similares ya catalogados (opcional).

        Returns:
            Diccionario con la respuesta JSON del modelo, o None si falla.
        """
        # Detectar si es alta resolución y ajustar timeout
        is_high_res = self._detect_high_resolution(image_b64)
        if is_high_res:
            logger.info("Imagen de alta resolución detectada. Usando timeout extendido (%ds)", LM_STUDIO_TIMEOUT_ALTA_RES)
            self.client.timeout = LM_STUDIO_TIMEOUT_ALTA_RES

        # Prompt del sistema - instrucciones para el modelo
        # VERSIÓN OPTIMIZADA: reducida para no exceder el contexto de 4096 tokens de qwen2.5-vl-7b-instruct
        system_prompt = (
            "Eres un experto en catalogación de objetos. Responde ÚNICAMENTE con JSON válido, "
            "sin texto adicional, sin markdown. Usa esta estructura:\n\n"
            "{\n"
            '  "nombre": "Nombre del objeto",\n'
            '  "marca": "Marca o fabricante",\n'
            '  "autor": "Autor del libro",\n'
            '  "anio": 2020,\n'
            '  "isbn_issn": "ISBN o ISSN si visible",\n'
            '  "edicion": "Edición",\n'
            '  "estado_conservacion": "excelente|bueno|regular|malo|muy_malo",\n'
            '  "precio_estimado_mercado": 150.00,\n'
            '  "descripcion": "Descripción breve del objeto",\n'
            '  "color": "Color predominante",\n'
            '  "categoria": "libro|tecnologia|mueble|ropa|otro",\n'
            '  "confianza_general": 0.85,\n'
            '  "nombre_serie": "Serie si es cómic",\n'
            '  "titulo_tomo": "Título del tomo",\n'
            '  "numero_tomo": 1,\n'
            '  "editorial": "Editorial",\n'
            '  "idioma": "Idioma"\n'
            "}\n\n"
            "REGLAS:\n"
            "- Si es un LIBRO: pon el título en 'nombre', autor en 'autor', editorial en 'editorial', "
            "categoria='libro'. Si ves ISBN en la portada o lomo, ponlo en 'isbn_issn'.\n"
            "- Si es CÓMIC: además pon 'nombre_serie', 'titulo_tomo', 'numero_tomo'.\n"
            "- Si es TECNOLOGÍA: pon 'marca', categoria='tecnologia'.\n"
            "- Si no puedes determinar un campo, déjalo vacío o null.\n"
            "- confianza_general: 0-1. Sé conservador.\n"
            "- Lee el texto visible en la imagen (títulos, autores).\n"
            "- No inventes información."
        )

        # Agregar contexto RAG si existe
        if rag_context:
            system_prompt += "\n\n" + rag_context


        import time as time_module
        start_time = time_module.time()
        
        # Log del tamaño de la imagen
        img_size_mb = len(image_b64) * 0.73 / (1024 * 1024)
        logger.info("Enviando imagen a LM Studio para análisis (modelo: %s, tamaño: %.2fMB)...", MODEL_NAME, img_size_mb)

        try:
            response = self.client.chat.completions.create(
                model=MODEL_NAME,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_b64}"
                                }
                            },
                            {
                                "type": "text",
                                "text": "Analiza este objeto y devuelve la información en formato JSON."
                            }
                        ]
                    }
                ],
                temperature=0.1,  # Baja temperatura para respuestas más deterministas
                max_tokens=1024,
                # NOTA: qwen2.5-vl-7b-instruct NO soporta response_format json_object
                # Así que pedimos JSON explícitamente en el prompt del sistema
            )

            elapsed = time_module.time() - start_time
            # Extraer el contenido del mensaje
            content = response.choices[0].message.content
            logger.info("✅ LM Studio respondió en %.1fs. Respuesta: %s", elapsed, content[:300])

            # Intentar parsear como JSON
            try:
                result = json.loads(content)
                logger.info("✅ JSON parseado correctamente. Campos: %s", list(result.keys()))
                return result
            except json.JSONDecodeError:
                # Intentar extraer JSON de un bloque de código
                import re
                json_match = re.search(r'\{.*\}', content, re.DOTALL)
                if json_match:
                    try:
                        result = json.loads(json_match.group())
                        logger.info("✅ JSON extraído de bloque de código. Campos: %s", list(result.keys()))
                        return result
                    except:
                        pass
                logger.error("❌ No se pudo parsear la respuesta como JSON: %s", content[:500])
                return None

        except Exception as e:
            elapsed = time_module.time() - start_time
            logger.error("❌ Error al comunicarse con LM Studio después de %.1fs: %s", elapsed, e)
            return None


# =============================================================================
# CLIENTE GEMINI (Google Gen AI SDK)
# =============================================================================
class GeminiClient:
    """
    Cliente para conectar con la API de Gemini 2.5 Flash-Lite de Google.
    Utiliza el SDK oficial `google-genai` (google.genai).

    Lee la API key desde la variable de entorno GEMINI_API_KEY.

    Nota: El paquete `google-generativeai` (0.8.x) está deprecado.
    Esta implementación usa `google-genai` (>=2.0) que es el SDK actual.
    """

    MODEL_NAME = "gemini-2.5-flash-lite"  # alias estable de Gemini 2.5 Flash-Lite

    def __init__(self):
        self.api_key = os.environ.get('GEMINI_API_KEY')
        if not self.api_key:
            logger.warning("GEMINI_API_KEY no está configurada en el entorno")
        self._client = None

    def _get_client(self):
        """Inicializa el cliente de Gemini si no está creado."""
        if self._client is None:
            import google.genai as genai
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    def _check_health(self) -> bool:
        """Verifica que la API key de Gemini sea válida."""
        if not self.api_key:
            return False
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
            Misma estructura que LMStudioClient._analyze_base64().
        """
        if not self.api_key:
            logger.error("GEMINI_API_KEY no está configurada")
            return None

        # Limpiar prefijo data:image si existe
        if ',' in image_base64:
            image_base64 = image_base64.split(',', 1)[1]

        # Prompt del sistema - idéntico al de LM Studio para misma estructura
        system_prompt = (
            "Eres un experto en catalogación de objetos. Responde ÚNICAMENTE con JSON válido, "
            "sin texto adicional, sin markdown. Usa esta estructura:\n\n"
            "{\n"
            '  "nombre": "Nombre del objeto",\n'
            '  "marca": "Marca o fabricante",\n'
            '  "autor": "Autor del libro",\n'
            '  "anio": 2020,\n'
            '  "isbn_issn": "ISBN o ISSN si visible",\n'
            '  "edicion": "Edición",\n'
            '  "estado_conservacion": "excelente|bueno|regular|malo|muy_malo",\n'
            '  "precio_estimado_mercado": 150.00,\n'
            '  "descripcion": "Descripción breve del objeto",\n'
            '  "color": "Color predominante",\n'
            '  "categoria": "libro|tecnologia|mueble|ropa|otro",\n'
            '  "confianza_general": 0.85,\n'
            '  "nombre_serie": "Serie si es cómic",\n'
            '  "titulo_tomo": "Título del tomo",\n'
            '  "numero_tomo": 1,\n'
            '  "editorial": "Editorial",\n'
            '  "idioma": "Idioma"\n'
            "}\n\n"
            "REGLAS:\n"
            "- Si es un LIBRO: pon el título en 'nombre', autor en 'autor', editorial en 'editorial', "
            "categoria='libro'. Si ves ISBN en la portada o lomo, ponlo en 'isbn_issn'.\n"
            "- Si es CÓMIC: además pon 'nombre_serie', 'titulo_tomo', 'numero_tomo'.\n"
            "- Si es TECNOLOGÍA: pon 'marca', categoria='tecnologia'.\n"
            "- Si no puedes determinar un campo, déjalo vacío o null.\n"
            "- confianza_general: 0-1. Sé conservador.\n"
            "- Lee el texto visible en la imagen (títulos, autores).\n"
            "- No inventes información."
        )

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

            # FIX: system_prompt debe ir como system_instruction, NO como contenido de usuario
            response = client.models.generate_content(
                model=self.MODEL_NAME,
                contents=[
                    genai_types.Part.from_bytes(
                        data=base64.b64decode(image_base64),
                        mime_type="image/jpeg",
                    ),
                    genai_types.Part.from_text(text="Analiza este objeto y devuelve los datos en JSON valido, sin texto adicional, sin markdown."),
                ],
                config=genai_types.GenerateContentConfig(
                    # system_instruction debe ser Content, NO Part
                    system_instruction=genai_types.Content(
                        parts=[genai_types.Part.from_text(text=system_prompt)]
                    ),
                    temperature=0.1,
                    max_output_tokens=1024,
                ),
            )

            elapsed = time_module.time() - start_time
            # Obtener texto de forma segura (response.text puede fallar si la respuesta fue bloqueada)
            try:
                content = response.text
            except (ValueError, AttributeError) as e:
                logger.error("❌ Gemini response.text fallo: %s", e)
                # Intentar extraer de candidates
                try:
                    content = response.candidates[0].content.parts[0].text
                except Exception:
                    logger.error("❌ Tampoco se pudo extraer texto de candidates")
                    return None
            # LOG TEMPORAL: respuesta COMPLETA de Gemini para diagnosticar parseo
            logger.info("✅ Gemini respondió en %.1fs.", elapsed)
            logger.info("⚡ GEMINI_RESPUESTA_CRUDA_INICIO ⚡\n%s\n⚡ GEMINI_RESPUESTA_CRUDA_FIN ⚡", content)
            logger.info("✅ Gemini respuesta (primeros 300): %s", content[:300])
            logger.info("✅ Gemini respuesta (últimos 300): %s", content[-300:] if len(content) > 300 else content)
            logger.info("✅ Gemini respuesta length: %d chars, repr de primeros 50: %s", len(content), repr(content[:50]))

            # Intentar parsear como JSON
            try:
                result = json.loads(content)
                logger.info("✅ JSON parseado correctamente. Campos: %s", list(result.keys()))
                return result
            except json.JSONDecodeError:
                # Intentar extraer JSON de un bloque de código
                import re
                # Buscar JSON con o sin markdown ```json ... ```
                json_match = re.search(r'```(?:json)?\s*\n?(\{.*?\})\s*\n?```', content, re.DOTALL)
                if not json_match:
                    json_match = re.search(r'\{.*\}', content, re.DOTALL)
                if json_match:
                    try:
                        candidate = json_match.group(1) if json_match.lastindex else json_match.group()
                        result = json.loads(candidate)
                        logger.info("✅ JSON extraído de bloque de código. Campos: %s", list(result.keys()))
                        return result
                    except json.JSONDecodeError as e2:
                        logger.error("❌ JSON candidate también falló: %s. Texto: %s", e2, candidate[:200])
                else:
                    logger.error("❌ No se encontró ni siquiera patrón {...} en la respuesta")
                logger.error("❌ No se pudo parsear la respuesta de Gemini como JSON. Respuesta COMPLETA:\n%s", content)
                return None

        except Exception as e:
            elapsed = time_module.time() - start_time
            logger.error("❌ Error al comunicarse con Gemini después de %.1fs: %s", elapsed, e)
            return None


# =============================================================================
# SERVICIO DE VISIÓN
# =============================================================================
class AIVisionService:
    """
    Servicio principal de visión por IA.
    Orquesta el análisis de imágenes y la lógica de campos pendientes.
    Soporta motores: 'local' (LM Studio) y 'gemini' (Google Gemini 2.5 Flash-Lite).
    """

    def __init__(self):
        self.client = LMStudioClient()
        self._gemini_client = None

    def _get_gemini_client(self) -> GeminiClient:
        """Lazy initialization del cliente Gemini."""
        if self._gemini_client is None:
            self._gemini_client = GeminiClient()
        return self._gemini_client

    def _buscar_objetos_similares(self, max_resultados: int = 5) -> str:
        """
        Busca objetos ya catalogados en la BD para usarlos como contexto (RAG).
        Ayuda al modelo a ser más preciso basándose en objetos similares ya registrados.

        Args:
            max_resultados: Máximo de objetos a incluir como contexto.

        Returns:
            String con la lista de objetos similares formateada para el prompt,
            o string vacío si no hay objetos en la BD.
        """
        try:
            from ..models import Objeto, LibroRevista, Tecnologia, MuebleArte, Ropa
            from django.db.models import Q

            # Obtener objetos no eliminados, ordenados por fecha descendente
            objetos = Objeto.objects.filter(
                deleted_at__isnull=True
            ).exclude(
                Q(nombre__isnull=True) | Q(nombre__exact='') | Q(nombre__exact='Objeto sin nombre')
            ).order_by('-fecha_registro')[:max_resultados]

            if not objetos:
                return ""

            contexto = "OBJETOS YA CATALOGADOS EN TU INVENTARIO (usa como referencia):\n"
            for obj in objetos:
                try:
                    # Intentar obtener datos del modelo hijo
                    libro = None
                    tecnologia = None
                    mueble = None
                    try:
                        libro = obj.librorevista
                    except:
                        pass
                    try:
                        tecnologia = obj.tecnologia
                    except:
                        pass
                    try:
                        mueble = obj.mueblearte
                    except:
                        pass
                    try:
                        ropa = obj.ropa
                    except:
                        pass

                    detalles = f"- '{obj.nombre}'"
                    if libro:
                        detalles += f" [LIBRO] autor:{libro.autor or '?'} editorial:{libro.editorial or '?'}"
                        if libro.isbn_issn:
                            detalles += f" ISBN:{libro.isbn_issn}"
                    elif tecnologia:
                        detalles += f" [TECNOLOGIA] marca:{tecnologia.marca or '?'} modelo:{tecnologia.modelo or '?'}"
                    elif mueble:
                        detalles += f" [MUEBLE] material:{mueble.material or '?'} artista:{mueble.artista_fabricante or '?'}"
                    elif ropa:
                        detalles += f" [ROPA] talla:{ropa.tamano or '?'}"
                    else:
                        detalles += f" [OTRO]"

                    if obj.estado_conservacion:
                        detalles += f" estado:{obj.estado_conservacion}"
                    if obj.valor_estimado:
                        detalles += f" valor:${float(obj.valor_estimado):.2f}"

                    contexto += detalles + "\n"
                except:
                    continue

            contexto += "\nUSA ESTOS OBJETOS COMO REFERENCIA para identificar el nuevo objeto.\n"
            return contexto

        except Exception as e:
            logger.warning("Error al buscar objetos similares para RAG: %s", e)
            return ""

    def _comprimir_imagen_base64(self, image_base64: str, max_size_mb: float = MAX_IMAGE_SIZE_FOR_GPU_MB, max_dimension: int = MAX_IMAGE_DIMENSION, quality: int = COMPRESS_QUALITY) -> str:
        """
        Comprime una imagen en Base64 si excede el tamaño máximo para GPU.
        Usa PIL/Pillow para redimensionar y comprimir la imagen antes de enviarla
        al modelo, evitando saturar la VRAM de la GPU Radeon RX 9060 XT (8GB).

        Args:
            image_base64: Imagen en formato Base64 (con o sin prefijo data:image).
            max_size_mb: Tamaño máximo en MB para la imagen comprimida.
            max_dimension: Máximo de píxeles en el lado mayor (default: 640 para LM Studio).
            quality: Calidad JPEG (default: 30 para LM Studio, 70 para Gemini).

        Returns:
            Imagen Base64 comprimida (sin prefijo data:image).
        """
        # Limpiar prefijo si existe
        if ',' in image_base64:
            image_base64 = image_base64.split(',', 1)[1]

        # Estimar tamaño actual
        estimated_bytes = len(image_base64) * 0.73
        estimated_mb = estimated_bytes / (1024 * 1024)

        # Si ya está dentro del límite, devolver sin cambios
        if estimated_mb <= max_size_mb:
            return image_base64

        logger.info(
            "Comprimiendo imagen: %.2fMB -> objetivo <%.2fMB (max_dim=%dpx, quality=%d%%)",
            estimated_mb, max_size_mb, max_dimension, quality
        )

        try:
            from PIL import Image
            import io

            # Decodificar Base64 a bytes
            image_bytes = base64.b64decode(image_base64)

            # Abrir con PIL
            img = Image.open(io.BytesIO(image_bytes))

            # Convertir a RGB si es necesario (RGBA -> RGB)
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')

            # Redimensionar si es muy grande
            if max(img.width, img.height) > max_dimension:
                ratio = max_dimension / max(img.width, img.height)
                new_width = int(img.width * ratio)
                new_height = int(img.height * ratio)
                img = img.resize((new_width, new_height), Image.LANCZOS)
                logger.info("Imagen redimensionada a %dx%d (máx %dpx)", new_width, new_height, max_dimension)

            # Comprimir con calidad ajustable
            output = io.BytesIO()
            current_quality = quality
            img.save(output, format='JPEG', quality=current_quality, optimize=True)

            # Verificar tamaño resultante
            compressed_size_mb = len(output.getvalue()) / (1024 * 1024)

            # Si aún excede, reducir calidad progresivamente
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

        # Campos obligatorios que siempre deben estar presentes
        campos_obligatorios = ["nombre", "estado_conservacion", "categoria"]
        for campo in campos_obligatorios:
            valor = result.get(campo, "")
            if not valor or (isinstance(valor, str) and valor.strip() == ""):
                campos_pendientes.append(campo)

        # Si la confianza es baja, marcar campos específicos como pendientes
        if confianza < CONFIANZA_MINIMA:
            campos_a_revisar = ["marca", "autor", "anio", "precio_estimado_mercado", "color"]
            for campo in campos_a_revisar:
                valor = result.get(campo)
                if not valor or (isinstance(valor, str) and valor.strip() == "") or valor is None:
                    campos_pendientes.append(campo)

        # Para libros, el autor y año son críticos
        if result.get("categoria") == "libro":
            if not result.get("autor"):
                campos_pendientes.append("autor")
            if not result.get("anio"):
                campos_pendientes.append("anio")

        # Para tecnología, la marca es crítica
        if result.get("categoria") == "tecnologia":
            if not result.get("marca"):
                campos_pendientes.append("marca")

        return list(set(campos_pendientes))  # eliminar duplicados

    def _mapear_resultado(self, raw_result: Dict[str, Any]) -> VisionResult:
        """
        Mapea el resultado crudo de la IA a un VisionResult estructurado.

        Args:
            raw_result: Diccionario con la respuesta JSON del modelo.

        Returns:
            VisionResult con los datos mapeados.
        """
        result = VisionResult(
            nombre=raw_result.get("nombre", ""),
            marca=raw_result.get("marca", ""),
            autor=raw_result.get("autor", ""),
            anio=raw_result.get("anio"),
            estado_conservacion=raw_result.get("estado_conservacion", ""),
            precio_estimado_mercado=raw_result.get("precio_estimado_mercado"),
            descripcion=raw_result.get("descripcion", ""),
            color=raw_result.get("color", ""),
            categoria=raw_result.get("categoria", "otro"),
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

        # Determinar campos pendientes
        result.campos_pendientes = self._determinar_campos_pendientes(raw_result)

        return result

    def procesar_imagen(self, image_path: str) -> VisionResult:
        """
        Procesa una imagen desde una ruta de archivo y retorna un VisionResult.
        Comprime la imagen automáticamente antes de enviarla al modelo.

        Args:
            image_path: Ruta a la imagen a analizar.

        Returns:
            VisionResult con los datos extraídos y campos pendientes.
        """
        # Leer la imagen y comprimirla antes de enviar
        import base64 as b64_module
        with open(image_path, "rb") as f:
            image_b64 = b64_module.b64encode(f.read()).decode("utf-8")
        image_b64_comprimida = self._comprimir_imagen_base64(image_b64)
        raw_result = self.client.analyze_base64(image_b64_comprimida)

        if raw_result is None:
            return VisionResult(
                confianza_general=0.0,
                campos_pendientes=[
                    "nombre", "marca", "autor", "anio",
                    "estado_conservacion", "precio_estimado_mercado",
                    "descripcion", "color", "categoria"
                ],
                raw_response="LM Studio no disponible"
            )

        return self._mapear_resultado(raw_result)

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
        Procesa una imagen desde una cadena Base64 usando el motor LOCAL (LM Studio).
        Comprime la imagen automáticamente antes de enviarla al modelo
        para no exceder el contexto de 4096 tokens de qwen2.5-vl-7b-instruct.

        Incluye contexto RAG: busca objetos similares ya catalogados en la BD
        y los pasa como referencia al modelo para mejorar la precisión.

        Args:
            image_base64: Imagen codificada en Base64.

        Returns:
            VisionResult con los datos extraídos y campos pendientes.
        """
        return self.procesar_imagen_desde_base64_con_motor(image_base64, motor='local')

    def procesar_imagen_desde_base64_con_motor(self, image_base64: str, motor: str = 'local') -> VisionResult:
        """
        Procesa una imagen desde una cadena Base64 usando el motor especificado.

        Args:
            image_base64: Imagen codificada en Base64.
            motor: 'local' para LM Studio, 'gemini' para Google Gemini 2.5 Flash-Lite.

        Returns:
            VisionResult con los datos extraídos y campos pendientes.
        """
        # Buscar objetos similares ya catalogados (RAG) para mejorar precisión
        rag_context = self._buscar_objetos_similares()
        if rag_context:
            logger.info("📚 RAG: incluyendo %d objetos similares como contexto", rag_context.count("\n- '"))

        if motor == 'gemini':
            # Gemini: compresión ligera para reducir payload y latencia
            # Las fotos de cámara de celular pueden pesar 3-8MB, lo que hace
            # que la subida a la API de Google sea lenta y costosa en tokens.
            # Comprimimos a 1024px/70% calidad (~200-500KB) - suficiente para
            # que el modelo vea detalles sin mandar MB innecesarios.
            image_base64_comprimida = self._comprimir_imagen_base64(
                image_base64,
                max_size_mb=1.0,       # máximo 1MB
                max_dimension=1024,    # máximo 1024px en lado mayor
                quality=70,            # calidad JPEG 70%
            )
            gemini_client = self._get_gemini_client()
            raw_result = gemini_client.analyze_base64(image_base64_comprimida, rag_context=rag_context)

            if raw_result is None:
                return VisionResult(
                    confianza_general=0.0,
                    campos_pendientes=[
                        "nombre", "marca", "autor", "anio",
                        "estado_conservacion", "precio_estimado_mercado",
                        "descripcion", "color", "categoria"
                    ],
                    raw_response="Gemini no disponible"
                )

            return self._mapear_resultado(raw_result)
        else:
            # Local (LM Studio): comprimir para no exceder contexto de 4096 tokens
            image_base64_comprimida = self._comprimir_imagen_base64(image_base64)
            raw_result = self.client.analyze_base64(image_base64_comprimida, rag_context=rag_context)

            if raw_result is None:
                return VisionResult(
                    confianza_general=0.0,
                    campos_pendientes=[
                        "nombre", "marca", "autor", "anio",
                        "estado_conservacion", "precio_estimado_mercado",
                        "descripcion", "color", "categoria"
                    ],
                    raw_response="LM Studio no disponible"
                )

            return self._mapear_resultado(raw_result)

    def crear_objeto_desde_vision(
        self,
        vision_result: VisionResult,
        user=None,
        ubicacion=None,
        contenedor=None
    ) -> Optional[Dict[str, Any]]:
        """
        Crea un objeto en la base de datos a partir de un resultado de visión.
        Registra automáticamente el precio en el Historial de Precios.

        Args:
            vision_result: Resultado del análisis de visión.
            user: Usuario que realiza la carga (opcional).
            ubicacion: Ubicación del objeto (opcional).
            contenedor: Contenedor del objeto (opcional).

        Returns:
            Dict con el objeto creado y metadatos, o None si falla.
        """
        from ..models import Objeto, HistorialPrecio

        try:
            from django.db import transaction

            with transaction.atomic():
                # Determinar el estado de carga
                estado_carga = 'completo'
                if vision_result.campos_pendientes:
                    estado_carga = 'incompleto'

                # Crear el objeto base
                objeto = Objeto.objects.create(
                    nombre=vision_result.nombre or "Objeto sin nombre",
                    descripcion=vision_result.descripcion,
                    ubicacion=ubicacion,
                    contenedor=contenedor,
                    estado_conservacion=vision_result.estado_conservacion or 'bueno',
                    valor_estimado=(
                        Decimal(str(vision_result.precio_estimado_mercado))
                        if vision_result.precio_estimado_mercado else None
                    ),
                    color=vision_result.color,
                    estado_carga=estado_carga,
                    campos_pendientes=vision_result.campos_pendientes,
                )

                # Crear modelo hijo según categoría
                if vision_result.categoria == 'libro':
                    from ..models import LibroRevista
                    LibroRevista.objects.create(
                        objeto_ptr=objeto,
                        autor=vision_result.autor,
                        anio=vision_result.anio,
                        nombre_serie=vision_result.nombre_serie,
                        titulo_tomo=vision_result.titulo_tomo,
                        numero_tomo=vision_result.numero_tomo,
                        editorial=vision_result.editorial,
                        idioma=vision_result.idioma,
                    )
                elif vision_result.categoria == 'tecnologia':
                    from ..models import Tecnologia
                    Tecnologia.objects.create(
                        objeto_ptr=objeto,
                        marca=vision_result.marca,
                    )
                elif vision_result.categoria == 'mueble':
                    from ..models import MuebleArte
                    MuebleArte.objects.create(
                        objeto_ptr=objeto,
                        artista_fabricante=vision_result.autor,
                    )
                elif vision_result.categoria == 'ropa':
                    from ..models import Ropa
                    Ropa.objects.create(objeto_ptr=objeto)

                # Registrar en el historial de precios si hay valor estimado
                if vision_result.precio_estimado_mercado:
                    HistorialPrecio.objects.create(
                        objeto=objeto,
                        valor_anterior=None,
                        valor_nuevo=Decimal(str(vision_result.precio_estimado_mercado)),
                        motivo="Valoración inicial por IA",
                        registrado_por=user,
                    )

                logger.info(
                    "Objeto creado desde visión: '%s' (categoría: %s, estado: %s)",
                    objeto.nombre, vision_result.categoria, estado_carga
                )

                return {
                    "id": str(objeto.id),
                    "nombre": objeto.nombre,
                    "categoria": vision_result.categoria,
                    "estado_carga": estado_carga,
                    "campos_pendientes": vision_result.campos_pendientes,
                    "valor_estimado": float(vision_result.precio_estimado_mercado)
                    if vision_result.precio_estimado_mercado else None,
                }

        except Exception as e:
            logger.error("Error al crear objeto desde visión: %s", e)
            return None
