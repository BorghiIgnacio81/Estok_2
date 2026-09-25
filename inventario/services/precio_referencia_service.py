"""
Servicio de Precio de Referencia (MercadoLibre Argentina + fallback IA).

Busca precios de referencia para objetos mediante:
1. MercadoLibre ARGENTINA (site MLA): delega en `mercadolibre_busqueda`, que
   fuerza el site MLA, valida que el título coincida con la búsqueda y descarta
   cualquier moneda distinta de ARS (ver docstring de ese módulo: es el fix del
   match erróneo que inyectaba precios en dólares).
2. Fallback a Gemini API para estimación por IA (estimación pedida en ARS).

Todos los precios devueltos salen con `moneda = "ARS"`.
"""

import logging
import re
import os
from typing import Optional, Dict, Any

import requests

from .mercadolibre_busqueda import MONEDA_ARS, buscar_en_mercadolibre

# Re-export: `buscar_en_mercadolibre` era parte de la API histórica de este
# módulo y hoy vive en `mercadolibre_busqueda`. Se mantiene el acceso.
__all__ = ["buscar_precio_referencia", "buscar_en_mercadolibre"]

logger = logging.getLogger(__name__)

# Factores de ajuste según estado de conservación
FACTORES_AJUSTE = {
    "excelente": 1.0,
    "bueno": 0.9,
    "regular": 0.6,
    "malo": 0.5,
    "muy_malo": 0.4,
}

def _ajustar_precio(precio: float, estado: str) -> float:
    """Aplica el factor de ajuste según estado de conservación."""
    factor = FACTORES_AJUSTE.get(estado, 0.9)
    return round(precio * factor, 2)


def _respuesta_encontrada(
    titulo: str, precio: float, link: str, estado: str, fuente: str
) -> Dict[str, Any]:
    """Respuesta estándar de precio encontrado (siempre en pesos argentinos)."""
    factor = FACTORES_AJUSTE.get(estado, 0.9)
    return {
        "encontrado": True,
        "fuente": fuente,
        "fuente_error": None,
        "titulo": titulo,
        "precio_original": precio,
        "precio_ajustado": _ajustar_precio(precio, estado),
        "moneda": MONEDA_ARS,
        "link": link,
        "estado_aplicado": estado,
        "porcentaje_aplicado": int(factor * 100),
    }


def _respuesta_vacia(estado: str, fuente_error: Optional[str]) -> Dict[str, Any]:
    """
    Respuesta estándar SIN precio (error controlado).

    Se usa tanto para 'sin coincidencia confiable' como para 'error_red': nunca
    se devuelve un precio proveniente de un match no verificado.
    """
    return {
        "encontrado": False,
        "fuente": None,
        "fuente_error": fuente_error,
        "titulo": None,
        "precio_original": None,
        "precio_ajustado": None,
        "moneda": None,
        "link": None,
        "estado_aplicado": estado,
        "porcentaje_aplicado": None,
    }


def _estimar_con_gemini(nombre: str, estado: str) -> Optional[Dict[str, Any]]:
    """
    Usa Gemini como fallback para estimar un precio.

    Args:
        nombre: Nombre del objeto.
        estado: Estado de conservación.

    Returns:
        Dict con titulo, precio_original, link (búsqueda en ML) o None si falla.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY no configurada, no se puede usar fallback Gemini")
        return None

    try:
        import google.genai as genai
        from google.genai import types as genai_types

        client = genai.Client(api_key=api_key)

        estado_labels = {
            "excelente": "excelente (como nuevo)",
            "bueno": "bueno (uso normal, sin daños)",
            "regular": "regular (con signos de uso, algunos defectos)",
            "malo": "malo (dañado, funcional pero con problemas)",
            "muy_malo": "muy malo (roto, incompleto, para reparación)",
        }
        desc_estado = estado_labels.get(estado, estado)

        prompt = (
            f"Estimá el precio de mercado en Argentina (ARS) para el siguiente objeto usado:\n"
            f"Objeto: {nombre}\n"
            f"Estado: {desc_estado}\n\n"
            f"Respondé SOLO con un número entero en ARS, sin texto adicional, sin signo $, sin puntos. "
            f"Ejemplo: 150000\n"
            f"Si no tenés idea, respondé 0."
        )

        response = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=50,
            ),
        )

        texto = response.text.strip()
        # Extraer solo dígitos
        match = re.search(r'(\d+)', texto)
        if match:
            precio = float(match.group(1))
            # Validación de cordura: precio positivo y menor a $50M ARS
            if 0 < precio <= 50_000_000:
                logger.info("Gemini estimó $%.2f para '%s' (%s)", precio, nombre, estado)
                # Generar link de búsqueda en ML para que el usuario pueda ver resultados reales
                ml_search_url = f"https://listado.mercadolibre.com.ar/{requests.utils.quote(nombre)}"
                return {
                    "titulo": f"Estimación de IA: {nombre}",
                    "precio": precio,
                    "link": ml_search_url,
                }
            else:
                logger.warning(
                    "Gemini devolvió precio fuera de rango: $%.2f para '%s'. Descartado.",
                    precio, nombre,
                )

        logger.warning("Gemini no pudo estimar precio. Respuesta: %s", texto)
        return None

    except Exception as e:
        logger.error("Error al estimar con Gemini: %s", e)
        return None


def buscar_precio_referencia(
    nombre: str,
    estado: str = "bueno",
    access_token: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Busca un precio de referencia para un objeto (SIEMPRE en pesos argentinos).

    Primero consulta MercadoLibre ARGENTINA (site MLA) con validación de
    coincidencia de título y moneda ARS. Si no hay un match confiable, estima con
    Gemini. Si nada resulta confiable devuelve un error CONTROLADO en lugar de
    inyectar el precio de un producto equivocado.

    Args:
        nombre: Nombre del objeto a buscar.
        estado: Estado de conservación (excelente, bueno, regular, malo, muy_malo).
        access_token: Token OAuth de ML del usuario (opcional). Si está presente
            se usa la API oficial pineada a MLA (`/sites/MLA/search`); si no, el
            scraping del listado `.com.ar` (ambos con validación de moneda ARS).

    Returns:
        Dict con la estructura de respuesta estándar (incluye `moneda`).
    """
    resultado_ml = buscar_en_mercadolibre(nombre, access_token=access_token)
    fuente_error = (
        resultado_ml.get("fuente_error") if isinstance(resultado_ml, dict) else None
    )

    # Red caída/bloqueada: no se estima con IA sobre datos dudosos.
    if fuente_error == "error_red":
        logger.warning(
            "Error de red al buscar en MLA para '%s', omitiendo Gemini fallback", nombre
        )
        return _respuesta_vacia(estado, "error_red")

    if resultado_ml and "precio" in resultado_ml:
        return _respuesta_encontrada(
            titulo=resultado_ml["titulo"],
            precio=resultado_ml["precio"],
            link=resultado_ml["link"],
            estado=estado,
            fuente="mercadolibre_mla",
        )

    # Fallback a Gemini (estimación pedida explícitamente en ARS).
    logger.info("MLA sin coincidencias para '%s', intentando Gemini fallback", nombre)
    resultado_gemini = _estimar_con_gemini(nombre, estado)
    if resultado_gemini:
        return _respuesta_encontrada(
            titulo=resultado_gemini["titulo"],
            precio=resultado_gemini["precio"],
            link=resultado_gemini["link"],
            estado=estado,
            fuente="gemini_estimacion",
        )

    # Error controlado: sin coincidencia verificada no se devuelve ningún precio.
    return _respuesta_vacia(estado, fuente_error or "sin_coincidencia")
