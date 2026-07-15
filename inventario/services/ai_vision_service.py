"""
Servicio de Visión por IA — Motor exclusivo: Gemini 2.5 Flash-Lite.

Conecta con la API de Google Gemini usando el SDK google-genai para procesar
imágenes de objetos y extraer información estructurada.

Flujo:
  1. Recibe una imagen (path, bytes o Base64)
  2. La envía a Gemini solicitando un JSON estructurado
  3. Analiza la respuesta y determina campos con baja confianza
  4. Retorna datos estructurados + lista de campos pendientes
  5. Alimenta el Historial de Precios para reportes de valoración

NOTA: El motor 'local' (LM Studio) se ha postergado. Si se solicita,
el servicio retorna un mensaje controlado indicando que estará disponible
próximamente.
"""

import json
import logging
import base64
import os
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field, asdict
from decimal import Decimal

from django.core.exceptions import ImproperlyConfigured

logger = logging.getLogger(__name__)


# =============================================================================
# CONFIGURACIÓN
# =============================================================================
CONFIANZA_MINIMA = 0.6       # umbral mínimo de confianza para considerar un campo válido
MAX_IMAGE_SIZE_MB = 10       # tamaño máximo de imagen en MB
COMPRESS_QUALITY = 70        # calidad JPEG para compresión
MAX_IMAGE_DIMENSION = 1024   # resolución máxima en lado mayor


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

        # Prompt del sistema
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

            response = client.models.generate_content(
                model=self.MODEL_NAME,
                contents=[
                    genai_types.Part.from_bytes(
                        data=base64.b64decode(image_base64),
                        mime_type="image/jpeg",
                    ),
                    genai_types.Part.from_text(
                        text="Analiza este objeto y devuelve los datos en JSON valido, sin texto adicional, sin markdown."
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

            # Intentar parsear como JSON
            try:
                result = json.loads(content)
                logger.info("JSON parseado correctamente. Campos: %s", list(result.keys()))
                return result
            except json.JSONDecodeError:
                # Intentar extraer JSON de un bloque de código
                import re
                json_match = re.search(r'```(?:json)?\s*\n?(\{.*?\})\s*\n?```', content, re.DOTALL)
                if not json_match:
                    json_match = re.search(r'\{.*\}', content, re.DOTALL)
                if json_match:
                    try:
                        candidate = json_match.group(1) if json_match.lastindex else json_match.group()
                        result = json.loads(candidate)
                        logger.info("JSON extraído de bloque de código. Campos: %s", list(result.keys()))
                        return result
                    except json.JSONDecodeError as e2:
                        logger.error("JSON candidate también falló: %s", e2)
                logger.error("No se pudo parsear la respuesta de Gemini como JSON")
                return None

        except Exception as e:
            elapsed = time_module.time() - start_time
            logger.error("Error al comunicarse con Gemini después de %.1fs: %s", elapsed, e)
            return None


# =============================================================================
# SERVICIO DE VISIÓN
# =============================================================================
class AIVisionService:
    """
    Servicio principal de visión por IA.
    Orquesta el análisis de imágenes y la lógica de campos pendientes.
    Motor exclusivo: Gemini 2.5 Flash-Lite.

    Si se solicita el motor 'local' (LM Studio), retorna un mensaje
    controlado indicando que estará disponible próximamente.
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

        campos_obligatorios = ["nombre", "estado_conservacion", "categoria"]
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

        if result.get("categoria") == "libro":
            if not result.get("autor"):
                campos_pendientes.append("autor")
            if not result.get("anio"):
                campos_pendientes.append("anio")

        if result.get("categoria") == "tecnologia":
            if not result.get("marca"):
                campos_pendientes.append("marca")

        return list(set(campos_pendientes))

    def _mapear_resultado(self, raw_result: Dict[str, Any]) -> VisionResult:
        """
        Mapea el resultado crudo de la IA a un VisionResult estructurado.
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
        Procesa una imagen desde una cadena Base64 usando el motor especificado.

        Args:
            image_base64: Imagen codificada en Base64.
            motor: 'gemini' para Google Gemini 2.5 Flash-Lite.
                   'local' retorna un mensaje de "próximamente".

        Returns:
            VisionResult con los datos extraídos y campos pendientes.
        """
        if motor == 'local':
            logger.info("Motor 'local' (LM Studio) solicitado pero no disponible")
            return self._vision_result_no_disponible(
                "El motor de IA local (LM Studio) no está disponible en esta versión. "
                "Estará disponible próximamente. Por ahora, usa el motor 'gemini'."
            )

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
        raw_result = gemini_client.analyze_base64(image_base64_comprimida, rag_context=rag_context)

        if raw_result is None:
            return self._vision_result_no_disponible("Gemini no disponible")

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
                estado_carga = 'completo'
                if vision_result.campos_pendientes:
                    estado_carga = 'incompleto'

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
