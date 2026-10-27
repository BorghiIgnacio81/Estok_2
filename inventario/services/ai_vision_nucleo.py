"""
Nucleo del servicio de vision por IA: configuracion, contrato (VisionResult),
prompts de catalogacion y utilidades puras compartidas por los clientes de IA.
Extraido de ai_vision_service.py (Fase A refactor preventivo).
"""

import json
import logging
import re
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field, asdict

logger = logging.getLogger(__name__)


# =============================================================================
# CONFIGURACIÓN
# =============================================================================
CONFIANZA_MINIMA = 0.6       # umbral mínimo de confianza para considerar un campo válido
MAX_IMAGE_SIZE_MB = 10       # tamaño máximo de imagen en MB
COMPRESS_QUALITY = 70        # calidad JPEG para compresión
MAX_IMAGE_DIMENSION = 1024   # resolución máxima en lado mayor


# =============================================================================
# EXCEPCIÓN DE CUOTA / RATE LIMIT DE LA API DE IA
# =============================================================================
MENSAJE_LIMITE_IA = (
    "La IA no está disponible temporalmente (se alcanzó el límite de uso). "
    "Podés completar los campos a mano y guardar el objeto igual."
)


class AIQuotaExceededError(Exception):
    """
    Se lanza cuando la API de IA externa responde con HTTP 429 (Rate Limit)
    o con un error de cuota/uso excedido (RESOURCE_EXHAUSTED).

    Permite a los endpoints distinguir un límite temporal de la API de un
    fallo genérico de análisis y devolver un mensaje claro al usuario en
    producción en lugar del mensaje genérico de "foto incorrecta". También es
    la señal que dispara el failover en cadena (ver ai_failover_service).
    """


def es_error_cuota_excedida(error: Exception) -> bool:
    """
    Detecta errores de cuota / rate limit en las excepciones de la API de IA.

    Compatible con:
      · google.genai.errors.APIError / ClientError / ServerError (SDK actual):
        exponen `.code` con el status HTTP real (429).
      · google.api_core.exceptions.ResourceExhausted (.code == 429 o texto
        RESOURCE_EXHAUSTED) y errores de grpc.
      · openai.APIStatusError (.status_code == 429).
      · Cualquier excepción cuyo texto contenga las marcas típicas de límite
        de uso (429, quota, rate limit, too many requests).
    """
    for atributo in ('code', 'status_code', 'http_status'):
        codigo = getattr(error, atributo, None)
        if codigo == 429:
            return True
        # google.api_core expone `.code` como (StatusCode, mensaje) en algunas
        # versiones y httpx como HTTPStatus (IntEnum), que ya cubre == 429.
        if isinstance(codigo, tuple) and codigo and str(codigo[0]).upper().endswith(
            'RESOURCE_EXHAUSTED'
        ):
            return True

    respuesta = getattr(error, 'response', None)
    if getattr(respuesta, 'status_code', None) == 429:
        return True

    texto = str(error).lower()
    return any(
        marca in texto
        for marca in (
            '429',
            'quota',
            'rate limit',
            'too many requests',
            'resource_exhausted',
            'resource exhausted',
        )
    )


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
    # Motor que efectivamente analizó la imagen: "gemini" o el nombre del
    # modelo de respaldo (failover) cuando Gemini devolvió HTTP 429.
    motor_utilizado: str = "gemini"
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
# PROMPT ÚNICO DE CATALOGACIÓN (compartido entre Gemini y el motor de respaldo)
# Mantener ESTE único prompt garantiza que ambos motores devuelvan el MISMO
# esquema JSON unificado, sin duplicar lógica de prompt entre motores.
# =============================================================================
PROMPT_SISTEMA_CATALOGACION = (
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
    '  "precio_estimado_mercado": 150000.00,\n'
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
    "el tipo físico del objeto y es OBLIGATORIO (si no podés determinarlo usá 'otro'); "
    "'meli_category_id' es la clasificación oficial. 'nombre' y 'categoria' son OBLIGATORIOS: si la foto muestra un objeto real, SIEMPRE devolvé un nombre concreto y corto y una categoría de la lista, porque sin ellos el formulario no puede precargar el alta.\n\n"
    "REGLAS:\n"
    "- Si es un LIBRO: pon el título en 'nombre', autor en 'autor', editorial en 'editorial', "
    "categoria='libro'. Si ves ISBN en la portada o lomo, ponlo en 'isbn_issn'.\n"
    "- Si es CÓMIC: además pon 'nombre_serie', 'titulo_tomo', 'numero_tomo'.\n"
    "- Si es TECNOLOGÍA: pon 'marca', categoria='tecnologia' o 'computacion'.\n"
    "- 'precio_estimado_mercado' SIEMPRE en pesos argentinos (ARS) del mercado "
    "local actual, como número sin símbolo ni separadores (ej: 150000.00).\n"
    "- Si no puedes determinar un campo, déjalo vacío o null.\n"
    "- confianza_general: 0-1. Sé conservador.\n"
    "- Lee el texto visible en la imagen (títulos, autores).\n"
    "- No inventes información."
)

# Instrucción de usuario que acompaña a la imagen (idéntica en ambos motores).
TEXTO_USUARIO_ANALISIS = (
    "Analiza este objeto y devuelve los datos en JSON valido, sin texto "
    "adicional, sin markdown."
)


def _extraer_json_de_respuesta(content: str) -> Optional[Dict[str, Any]]:
    """
    Intenta parsear la respuesta cruda del modelo como JSON.

    Primero intenta json.loads directo; si falla, busca un bloque JSON dentro
    de un bloque de código markdown o el primer objeto JSON del texto.

    Es el ÚNICO parser de respuestas de IA del proyecto: lo usan Gemini y el
    motor de respaldo (failover) para garantizar el mismo resultado unificado.
    """
    try:
        result = json.loads(content)
        logger.info("JSON parseado correctamente. Campos: %s", list(result.keys()))
        return result
    except json.JSONDecodeError:
        pass

    json_match = re.search(
        r'```(?:json)?\s*\n?(\{.*?\})\s*\n?```', content, re.DOTALL
    )
    if not json_match:
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
    if json_match:
        try:
            candidate = json_match.group(1) if json_match.lastindex else json_match.group()
            result = json.loads(candidate)
            logger.info(
                "JSON extraído de bloque de código. Campos: %s",
                list(result.keys()),
            )
            return result
        except json.JSONDecodeError as e2:
            logger.error("JSON candidate también falló: %s", e2)

    logger.error("No se pudo parsear la respuesta del modelo como JSON")
    return None


