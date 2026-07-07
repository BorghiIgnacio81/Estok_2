"""
Servicio de Precio de Referencia.

Busca precios de referencia para objetos mediante:
1. Scraping de listado.mercadolibre.com.ar (primario)
2. Fallback a Gemini API para estimación por IA
"""

import logging
import re
import os
from decimal import Decimal
from typing import Optional, Dict, Any

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Factores de ajuste según estado de conservación
FACTORES_AJUSTE = {
    "excelente": 1.0,
    "bueno": 0.9,
    "regular": 0.6,
    "malo": 0.5,
    "muy_malo": 0.4,
}

HEADERS_NAVEGADOR = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
}


def _ajustar_precio(precio: float, estado: str) -> float:
    """Aplica el factor de ajuste según estado de conservación."""
    factor = FACTORES_AJUSTE.get(estado, 0.9)
    return round(precio * factor, 2)


def _extraer_precio(texto: str) -> Optional[float]:
    """
    Extrae un número de precio de un texto.
    Maneja formatos como "$ 1.234,56", "$1,234.56", "ARS 1.234", etc.
    """
    if not texto:
        return None
    # Limpiar: quitar símbolos de moneda y espacios
    texto = texto.replace("$", "").replace("ARS", "").replace("USD", "").strip()
    # Detectar formato argentino: 1.234,56 (punto como separador de miles, coma decimal)
    if re.match(r'^[\d\.]+,\d{2}$', texto):
        texto = texto.replace(".", "").replace(",", ".")
    else:
        # Formato internacional: 1,234.56 (coma como separador de miles)
        texto = texto.replace(",", "")
    try:
        return float(texto)
    except (ValueError, TypeError):
        return None


def buscar_en_mercadolibre(q: str) -> Optional[Dict[str, Any]]:
    """
    Scrapea listado.mercadolibre.com.ar para obtener el primer resultado.

    Args:
        q: Término de búsqueda (ej: "iphone 14")

    Returns:
        Dict con titulo, precio, link o None si no encuentra nada.
    """
    url = f"https://listado.mercadolibre.com.ar/search?q={requests.utils.quote(q)}"
    logger.info("Scraping ML: %s", url)

    try:
        resp = requests.get(url, headers=HEADERS_NAVEGADOR, timeout=15)
        if resp.status_code != 200:
            logger.warning("ML respondió con status %s", resp.status_code)
            return None

        soup = BeautifulSoup(resp.text, "html.parser")

        # Intentar varios selectores para el primer resultado
        # Selector 1: estructura moderna de ML
        item = soup.select_one("ol.ui-search-layout li.ui-search-layout__item")
        if not item:
            # Selector 2: estructura alternativa
            item = soup.select_one("div.ui-search-result__content")
        if not item:
            # Selector 3: fallback genérico
            item = soup.select_one("[data-testid='result-item']")
        if not item:
            logger.warning("No se encontraron resultados en el HTML de ML")
            return None

        # Extraer título
        titulo_el = (
            item.select_one("h2.ui-search-item__title") or
            item.select_one("[data-testid='item-title']") or
            item.select_one("h2")
        )
        titulo = titulo_el.get_text(strip=True) if titulo_el else ""

        # Extraer precio
        precio_el = (
            item.select_one("span.andes-money-amount__fraction") or
            item.select_one("[data-testid='price-part']") or
            item.select_one(".ui-search-price__part .andes-money-amount__fraction")
        )
        precio_texto = precio_el.get_text(strip=True) if precio_el else ""
        precio = _extraer_precio(precio_texto)

        if not precio:
            logger.warning("No se pudo extraer precio del resultado")
            return None

        # Extraer link
        link_el = item.select_one("a.ui-search-item__group__element") or item.select_one("a")
        link = ""
        if link_el and link_el.get("href"):
            link = link_el["href"]

        logger.info("ML resultado: '%s' - $%.2f", titulo, precio)
        return {
            "titulo": titulo,
            "precio": precio,
            "link": link,
        }

    except requests.Timeout:
        logger.error("Timeout al scrapear ML")
        return None
    except Exception as e:
        logger.error("Error al scrapear ML: %s", e)
        return None


def _estimar_con_gemini(nombre: str, estado: str) -> Optional[Dict[str, Any]]:
    """
    Usa Gemini como fallback para estimar un precio.

    Args:
        nombre: Nombre del objeto.
        estado: Estado de conservación.

    Returns:
        Dict con titulo, precio_original, link (vacío) o None si falla.
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
            if precio > 0:
                logger.info("Gemini estimó $%.2f para '%s' (%s)", precio, nombre, estado)
                return {
                    "titulo": f"Estimación de IA: {nombre}",
                    "precio": precio,
                    "link": "",
                }

        logger.warning("Gemini no pudo estimar precio. Respuesta: %s", texto)
        return None

    except Exception as e:
        logger.error("Error al estimar con Gemini: %s", e)
        return None


def buscar_precio_referencia(nombre: str, estado: str = "bueno") -> Dict[str, Any]:
    """
    Busca un precio de referencia para un objeto.

    Primero intenta scraping de MercadoLibre.
    Si falla, usa Gemini como fallback.

    Args:
        nombre: Nombre del objeto a buscar.
        estado: Estado de conservación (excelente, bueno, regular, malo, muy_malo).

    Returns:
        Dict con la estructura de respuesta estándar.
    """
    # Intentar scraping de ML
    resultado_ml = buscar_en_mercadolibre(nombre)

    if resultado_ml:
        precio_original = resultado_ml["precio"]
        precio_ajustado = _ajustar_precio(precio_original, estado)
        factor = FACTORES_AJUSTE.get(estado, 0.9)
        porcentaje = int(factor * 100)

        return {
            "encontrado": True,
            "fuente": "mercadolibre_scraping",
            "titulo": resultado_ml["titulo"],
            "precio_original": precio_original,
            "precio_ajustado": precio_ajustado,
            "link": resultado_ml["link"],
            "estado_aplicado": estado,
            "porcentaje_aplicado": porcentaje,
        }

    # Fallback a Gemini
    logger.info("ML no encontró resultados, intentando Gemini fallback para '%s'", nombre)
    resultado_gemini = _estimar_con_gemini(nombre, estado)

    if resultado_gemini:
        precio_original = resultado_gemini["precio"]
        precio_ajustado = _ajustar_precio(precio_original, estado)
        factor = FACTORES_AJUSTE.get(estado, 0.9)
        porcentaje = int(factor * 100)

        return {
            "encontrado": True,
            "fuente": "gemini_estimacion",
            "titulo": resultado_gemini["titulo"],
            "precio_original": precio_original,
            "precio_ajustado": precio_ajustado,
            "link": "",
            "estado_aplicado": estado,
            "porcentaje_aplicado": porcentaje,
        }

    # No se encontró nada
    return {
        "encontrado": False,
        "fuente": None,
        "titulo": None,
        "precio_original": None,
        "precio_ajustado": None,
        "link": None,
        "estado_aplicado": estado,
        "porcentaje_aplicado": None,
    }
