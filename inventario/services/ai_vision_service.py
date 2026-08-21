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
# LAS 11 CATEGORÍAS OFICIALES DE MERCADO LIBRE ARGENTINA
# (deben coincidir con inventario/management/commands/cargar_categorias_meli.py)
# =============================================================================
CATEGORIAS_MELI_OFICIALES = {
    "MLA1574": "Muebles",
    "MLA1798": "Arte",
    "MLA1367": "Coleccionables",
    "MLA1368": "Antigüedades",
    "MLA1592": "Jardín",
    "MLA1648": "Computación",
    "MLA1051": "Electrónica",
    "MLA1403": "Cocina",
    "MLA1577": "Hogar",
    "MLA1500": "Herramientas",
    "MLA1506": "Materiales",
}

# Fallback para respuestas de la IA que aún usen la taxonomía legada
# (libro/tecnologia/mueble/ropa/otro). Solo se usa si la IA no devolvió
# un meli_category_id oficial. None = sin categoría oficial asignable.
MAPEO_CATEGORIA_LEGADA_A_MELI: Dict[str, Optional[str]] = {
    "libro": "MLA1367",        # Coleccionables (cómics, libros de colección)
    "tecnologia": "MLA1051",   # Electrónica
    "computacion": "MLA1648",  # Computación
    "mueble": "MLA1574",       # Muebles
    "arte": "MLA1798",         # Arte
    "ropa": None,              # sin categoría oficial
    "otro": None,
}


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
    categoria: str = ""  # categoría legada (libro, tecnologia, mueble, ropa, otro)
    meli_category_id: str = ""  # categoría oficial de Mercado Libre (MLAxxxxx)
    confianza_general: float = 0.0
    campos_pendientes: List[str] = field(default_factory=list)
    raw_response: str = ""
    # Campos específicos de libros / revistas / cómics
    isbn_issn: str = ""
    edicion: str = ""
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
            '  "categoria": "libro|tecnologia|mueble|ropa|arte|computacion|otro",\n'
            '  "meli_category_id": "MLAXXXXX",\n'
            '  "confianza_general": 0.85,\n'
            '  "nombre_serie": "Serie si es cómic",\n'
            '  "titulo_tomo": "Título del tomo",\n'
            '  "numero_tomo": 1,\n'
            '  "editorial": "Editorial",\n'
            '  "idioma": "Idioma"\n'
            "}\n\n"
            "CATEGORÍAS OFICIALES (elegí UNA sola de esta lista para 'meli_category_id'):\n"
            "MLA1574 Muebles\n"
            "MLA1798 Arte\n"
            "MLA1367 Coleccionables\n"
            "MLA1368 Antigüedades\n"
            "MLA1592 Jardín\n"
            "MLA1648 Computación\n"
            "MLA1051 Electrónica\n"
            "MLA1403 Cocina\n"
            "MLA1577 Hogar\n"
            "MLA1500 Herramientas\n"
            "MLA1506 Materiales\n"
            "- Si el objeto no encaja en ninguna de las 11 oficiales, usa 'meli_category_id': null.\n"
            "- El campo 'categoria' (libro|tecnologia|mueble|ropa|arte|computacion|otro) describe "
            "el tipo físico del objeto; 'meli_category_id' es la clasificación oficial.\n\n"
            "REGLAS:\n"
            "- Si es un LIBRO: pon el título en 'nombre', autor en 'autor', editorial en 'editorial', "
            "categoria='libro'. Si ves ISBN en la portada o lomo, ponlo en 'isbn_issn'.\n"
            "- Si es CÓMIC: además pon 'nombre_serie', 'titulo_tomo', 'numero_tomo'.\n"
            "- Si es TECNOLOGÍA: pon 'marca', categoria='tecnologia' o 'computacion'.\n"
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
        contenedor=None,
        estok=None,
    ) -> Optional[Dict[str, Any]]:
        """
        Crea un Objeto directamente (sin subclases multi-tabla) a partir de
        un resultado de visión. Asigna la Categoria oficial según el
        meli_category_id detectado. Registra automáticamente el precio en el
        Historial de Precios.

        Args:
            vision_result: Resultado del análisis de visión.
            user: Usuario que realiza la carga (opcional).
            ubicacion: Ubicación del objeto (opcional).
            contenedor: Contenedor del objeto (opcional).
            estok: Estok al que pertenece el objeto (opcional, aislamiento
                   multi-tenant).

        Returns:
            Dict con el objeto creado y metadatos, o None si falla.
        """
        from ..models import Objeto, HistorialPrecio, Categoria

        try:
            from django.db import transaction

            with transaction.atomic():
                estado_carga = 'completo'
                if vision_result.campos_pendientes:
                    estado_carga = 'incompleto'

                # Resolver la categoría oficial de las 11 Meli
                categoria = None
                if vision_result.meli_category_id:
                    if estok is not None:
                        categoria = Categoria.objects.filter(
                            meli_category_id=vision_result.meli_category_id,
                            estok=estok,
                        ).first()
                    if categoria is None:
                        categoria = Categoria.objects.filter(
                            meli_category_id=vision_result.meli_category_id,
                        ).first()

                objeto = Objeto.objects.create(
                    nombre=vision_result.nombre or "Objeto sin nombre",
                    descripcion=vision_result.descripcion,
                    estok=estok,
                    ubicacion=ubicacion,
                    contenedor=contenedor,
                    categoria=categoria,
                    estado_conservacion=vision_result.estado_conservacion or 'bueno',
                    valor_estimado=(
                        Decimal(str(vision_result.precio_estimado_mercado))
                        if vision_result.precio_estimado_mercado else None
                    ),
                    color=vision_result.color,
                    # Campos específicos migrados (antes subclases multi-tabla)
                    autor=vision_result.autor,
                    marca=vision_result.marca,
                    anio=vision_result.anio,
                    isbn_issn=vision_result.isbn_issn,
                    edicion=vision_result.edicion,
                    nombre_serie=vision_result.nombre_serie,
                    titulo_tomo=vision_result.titulo_tomo,
                    numero_tomo=vision_result.numero_tomo,
                    editorial=vision_result.editorial,
                    idioma=vision_result.idioma,
                    estado_carga=estado_carga,
                    campos_pendientes=vision_result.campos_pendientes,
                )

                if vision_result.precio_estimado_mercado:
                    HistorialPrecio.objects.create(
                        objeto=objeto,
                        valor_anterior=None,
                        valor_nuevo=Decimal(str(vision_result.precio_estimado_mercado)),
                        motivo="Valoración inicial por IA",
                        registrado_por=user,
                    )

                logger.info(
                    "Objeto creado desde visión: '%s' (categoría: %s, meli_id: %s, estado: %s)",
                    objeto.nombre,
                    objeto.categoria.nombre if objeto.categoria else None,
                    vision_result.meli_category_id,
                    estado_carga,
                )

                return {
                    "id": str(objeto.id),
                    "nombre": objeto.nombre,
                    "categoria": objeto.categoria.nombre if objeto.categoria else None,
                    "meli_category_id": vision_result.meli_category_id,
                    "estado_carga": estado_carga,
                    "campos_pendientes": vision_result.campos_pendientes,
                    "valor_estimado": float(vision_result.precio_estimado_mercado)
                    if vision_result.precio_estimado_mercado else None,
                }

        except Exception as e:
            logger.error("Error al crear objeto desde visión: %s", e)
            return None
