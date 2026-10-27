"""
Búsqueda de productos en MercadoLibre ARGENTINA (site MLA) para precios de
referencia.

Contexto del bug que corrige este módulo:
- Se buscaba "Disco Duro WD Purple 1TB" y el scraper devolvía el PRIMER item del
  HTML sin validar nada: podía ser un producto totalmente distinto (un mazo de
  cartas en inglés a US$ 51) y ese precio basura se inyectaba como referencia.
- Causa raíz: el HTML de `listado.mercadolibre.com.ar` puede responder con la
  vitrina GLOBAL (precios en dólares) o con una página de verificación según la
  IP de origen, y el scraper tomaba el primer `<li>` sin verificar título ni
  moneda.

Reglas de este módulo (site MLA forzado + filtro de coincidencia):
1. Sitio pineado a MLA (Argentina):
   - API oficial: `https://api.mercadolibre.com/sites/MLA/search` (el `MLA` va
     en el PATH del endpoint, es el parámetro de sitio que exige la API).
   - Fallback HTML: host `.com.ar` (equivalente a site MLA).
2. Moneda: TODO candidato con moneda distinta de ARS se descarta (nunca se
   convierte ni se asume USD → $ARS). El símbolo se lee del propio item.
3. Coincidencia: el título del candidato debe compartir las palabras clave
   esenciales de la búsqueda (ej: "WD", "Purple", "Disco"). Si el primer
   resultado no coincide, se evalúan los siguientes; si ninguno coincide se
   devuelve un error CONTROLADO (`sin_coincidencia`) en vez de datos basura.
4. Plan B: si la búsqueda original no da coincidencias se reintenta con una
   variante de TEXTO PLANO (sin comillas, paréntesis ni signos).
5. SANITIZACIÓN DE LA CONSULTA: los conectores ('de', 'para', 'con', 'y'…),
   signos y adjetivos irrelevantes se eliminan y la cadena se recorta a las
   MAX_PALABRAS_BUSQUEDA palabras clave principales. Una consulta de 12
   palabras no devuelve resultados en el full-text de ML.
6. PRECIO DE REFERENCIA ROBUSTO (no «el primero que aparezca»): se recolectan
   TODAS las publicaciones coincidentes, se descarta el 20 % de los valores
   extremos más bajos (cables/repuestos) y el 20 % más alto (publicaciones
   infladas) y se toma la MEDIANA de lo que queda. Así una publicación basura
   no define el valor del objeto.
"""

import logging
import math
import re
import statistics
import unicodedata
from typing import Any, Dict, List, Optional

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# =============================================================================
# CONSTANTES DE SITIO (ARGENTINA)
# =============================================================================
SITE_ID = "MLA"
MONEDA_ARS = "ARS"
ML_API_BASE = "https://api.mercadolibre.com"
LISTADO_MLA = "https://listado.mercadolibre.com.ar"

# Cuántos resultados se evalúan como máximo antes de descartar la búsqueda.
MAX_CANDIDATOS = 20
# Piso de cordura en ARS: descarta centavos sueltos o precios en dólares que
# se hayan colado sin símbolo (nada del inventario vale menos de AR$ 100).
MIN_PRECIO_ARS = 100.0
# Máximo de palabras clave que viajan al buscador de ML: las consultas largas
# («Cargador original Apple para MacBook Pro 2019 de 96W con cable») devuelven
# cero resultados por full-text y terminan en una estimación de IA.
MAX_PALABRAS_BUSQUEDA = 4
# Recorte de valores extremos en cada cola para la mediana robusta:
# 20 % inferior = cables/repuestos sueltos, 20 % superior = publicaciones
# infladas (o variantes premium que no representan el ítem buscado).
PORCENTAJE_RECORTE = 0.20
# Muestras coincidentes suficientes para no seguir probando variantes.
MIN_MUESTRAS_SUFICIENTES = 5

HEADERS_NAVEGADOR = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
}

# Palabras vacías: no aportan a la validación de coincidencia.
STOPWORDS = {
    "de", "del", "la", "las", "el", "los", "un", "una", "unos", "unas",
    "con", "sin", "para", "por", "y", "o", "u", "en", "al", "a", "the",
    "new", "nuevo", "nueva", "usado", "usada", "original", "kit", "set",
    "tipo", "color", "marca", "modelo", "gama", "alta", "linea",
}


class ErrorRedML(Exception):
    """Error de red / bloqueo al consultar MercadoLibre (no es 'sin resultados')."""


# =============================================================================
# NORMALIZACIÓN Y COINCIDENCIA DE TÍTULOS
# =============================================================================
def _sin_acentos(texto: str) -> str:
    """Quita diacríticos para comparar títulos ('Sillón' == 'Sillon')."""
    descompuesto = unicodedata.normalize("NFKD", texto or "")
    return "".join(c for c in descompuesto if not unicodedata.combining(c))


def _normalizar(texto: str) -> str:
    """Minúsculas, sin acentos y con espacios colapsados."""
    return re.sub(r"\s+", " ", _sin_acentos(texto or "").lower()).strip()


def _compactar(texto: str) -> str:
    """Sólo letras y dígitos: permite comparar '1TB' con '1 TB'."""
    return re.sub(r"[^a-z0-9]", "", _normalizar(texto))


def tokens_relevantes(nombre: str) -> List[str]:
    """
    Palabras clave esenciales de la búsqueda (sin stopwords ni duplicados).

    Ej: "Disco Duro WD Purple 1TB" → ["disco", "duro", "wd", "purple", "1tb"]
    """
    tokens: List[str] = []
    for bruto in re.split(r"[^a-z0-9]+", _normalizar(nombre)):
        if len(bruto) < 2 or bruto in STOPWORDS or bruto in tokens:
            continue
        tokens.append(bruto)
    return tokens


def _coincide_por_tokens(tokens: List[str], titulo: str) -> bool:
    """
    true si el título contiene las palabras clave esenciales de la búsqueda.

    Umbral: la mitad de los tokens (mínimo 1). Los tokens con dígitos (modelos
    como "1TB" o "WD10PURZ") también se buscan en la versión compacta del
    título, para tolerar el espaciado que usa MercadoLibre.
    """
    if not tokens:
        # Sin palabras clave utilizables no hay nada que filtrar.
        return True

    palabras = set(re.split(r"[^a-z0-9]+", _normalizar(titulo)))
    compacto = _compactar(titulo)
    coincidencias = 0
    for token in tokens:
        if token in palabras:
            coincidencias += 1
        elif any(c.isdigit() for c in token) and token in compacto:
            coincidencias += 1

    requeridas = max(1, math.ceil(len(tokens) * 0.5))
    return coincidencias >= requeridas


def titulo_coincide(nombre: str, titulo: str) -> bool:
    """Valida que el título del resultado corresponda a lo que se buscó."""
    return _coincide_por_tokens(tokens_relevantes(nombre), titulo)


def sanitizar_busqueda(nombre: str) -> str:
    """
    Consulta LIMPIA para MercadoLibre: palabras clave sin conectores ni signos,
    recortada a las MAX_PALABRAS_BUSQUEDA principales.

    Ej: "Cargador original Apple para MacBook Pro 2019 de 96W con cable"
        → "cargador apple macbook pro"
    """
    palabras = tokens_relevantes(nombre)
    if not palabras:
        # Sin tokens utilizables (nombre vacío o sólo conectores) se conserva el
        # texto original: nunca se dispara una búsqueda con cadena vacía.
        return re.sub(r"\s+", " ", (nombre or "")).strip()
    return " ".join(palabras[:MAX_PALABRAS_BUSQUEDA])


def variantes_busqueda(nombre: str) -> List[str]:
    """
    Variantes a probar, en orden de precisión:
      1. la consulta SANITIZADA (palabras clave, sin conectores),
      2. el texto plano completo (sin comillas, paréntesis ni signos),
      3. la cadena original (por si el nombre ya era una consulta válida).
    """
    original = (nombre or "").strip()
    limpia = sanitizar_busqueda(nombre)
    plano = re.sub(r"[^\w\s]", " ", _sin_acentos(original), flags=re.UNICODE)
    plano = re.sub(r"\s+", " ", plano).strip()

    variantes: List[str] = []
    for variante in (limpia, plano, original):
        if variante and variante not in variantes:
            variantes.append(variante)
    return variantes


# =============================================================================
# EXTRACCIÓN / VALIDACIÓN DE PRECIOS
# =============================================================================
def _extraer_precio(texto: str) -> Optional[float]:
    """
    Extrae un número de precio de un texto.
    Maneja formatos como "$ 1.234,56", "$1,234.56", "ARS 1.234", etc.
    """
    if not texto:
        return None
    limpio = texto.replace("$", "").replace("ARS", "").replace("USD", "").strip()
    # Formato argentino: 1.234,56 (punto de miles, coma decimal)
    if re.match(r"^[\d\.]+,\d{2}$", limpio):
        limpio = limpio.replace(".", "").replace(",", ".")
    else:
        limpio = limpio.replace(",", "")
    try:
        return float(limpio)
    except (ValueError, TypeError):
        return None


def _moneda_desde_simbolo(simbolo: str) -> str:
    """
    Moneda del item a partir de su símbolo visible.

    Cualquier variante de dólar ("US$", "USD", "U$S") devuelve "USD" para que el
    candidato se descarte. Sin símbolo se asume el sitio local (MLA = ARS).
    """
    texto = _normalizar(simbolo).upper()
    if "USD" in texto or "US" in texto:
        return "USD"
    return MONEDA_ARS


def _candidato_valido(titulo: str, precio: Any, moneda: str, link: str) -> Optional[Dict[str, Any]]:
    """Normaliza y valida un candidato (moneda ARS + piso de cordura)."""
    if not titulo or not link:
        return None
    if moneda != MONEDA_ARS:
        logger.warning("Descartado '%s': moneda %s (se exige ARS)", titulo, moneda)
        return None
    if not isinstance(precio, (int, float)) or precio < MIN_PRECIO_ARS:
        logger.warning("Descartado '%s': precio inválido ($%s)", titulo, precio)
        return None
    return {
        "titulo": titulo,
        "precio": float(precio),
        "moneda": MONEDA_ARS,
        "link": link,
    }


def _recortar_extremos(precios: List[float]) -> List[float]:
    """
    Mediana RECORTADA: descarta el 20 % de los valores más bajos (cables,
    repuestos, publicaciones incompletas) y el 20 % más alto (publicaciones
    infladas). Con menos de 5 muestras no se recorta nada: el `floor` del 20 %
    sería 0 y no hay colas que valga la pena tirar.
    """
    ordenados = sorted(precios)
    n = len(ordenados)
    if n < 5:
        return ordenados
    corte = int(n * PORCENTAJE_RECORTE)
    if corte <= 0:
        return ordenados
    return ordenados[corte:n - corte]


def precio_referencia_robusto(
    candidatos: List[Dict[str, Any]], tokens: List[str]
) -> Optional[Dict[str, Any]]:
    """
    Precio de referencia ESTADÍSTICAMENTE robusto de una lista de candidatos.

    1. Se conservan sólo los títulos que coinciden con las palabras clave.
    2. Se ordenan los precios y se recorta el 20 % inferior y el 20 % superior.
    3. El precio de referencia es la MEDIANA de la muestra recortada.
    4. El título/enlace que se devuelve es el de la publicación más cercana a
       esa mediana (la más representativa), no el primero del listado.

    Returns:
        Dict con `precio` (mediana) + los datos de la publicación elegida, o
        None si ninguna publicación coincide con la búsqueda.
    """
    coincidentes = [
        candidato for candidato in candidatos
        if _coincide_por_tokens(tokens, candidato["titulo"])
    ]
    if not coincidentes:
        return None

    muestra = _recortar_extremos([c["precio"] for c in coincidentes])
    if not muestra:
        return None

    mediana = float(statistics.median(muestra))
    elegido = min(coincidentes, key=lambda c: abs(c["precio"] - mediana))
    return {
        "titulo": elegido["titulo"],
        "precio": round(mediana, 2),
        "moneda": MONEDA_ARS,
        "link": elegido["link"],
        # Trazabilidad del cálculo (la exponen los logs y la ficha del objeto).
        "precio_publicacion": elegido["precio"],
        "muestras": len(muestra),
        "muestras_totales": len(coincidentes),
        "metodo": "mediana_recortada",
    }


# =============================================================================
# FUENTES DE CANDIDATOS
# =============================================================================
def _candidatos_desde_api(q: str, access_token: str) -> Optional[List[Dict[str, Any]]]:
    """
    Consulta la API oficial PINEADA A MLA y devuelve candidatos en ARS.

    Returns:
        Lista de candidatos, o None si la API rechazó la consulta (sin permiso /
        sin token / aplicación no habilitada) para que el caller use el HTML.
    Raises:
        ErrorRedML: timeout o falla de conexión.
    """
    url = f"{ML_API_BASE}/sites/{SITE_ID}/search"
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
    params = {"q": q, "limit": MAX_CANDIDATOS}

    try:
        resp = requests.get(url, params=params, headers=headers, timeout=15)
    except requests.RequestException as exc:
        raise ErrorRedML(f"Falla de red en API MLA: {exc}") from exc

    if resp.status_code != 200:
        logger.warning("API /sites/%s/search devolvió status %s", SITE_ID, resp.status_code)
        return None

    try:
        data = resp.json()
    except ValueError as exc:
        logger.warning("JSON inválido de la API MLA: %s", exc)
        return None

    # Blindaje de sitio: si la respuesta declara otro site, no se usa.
    site_devuelto = str(data.get("site_id") or SITE_ID).upper()
    if site_devuelto != SITE_ID:
        logger.warning("La API devolvió site %s (se exige %s): descartado", site_devuelto, SITE_ID)
        return None

    candidatos: List[Dict[str, Any]] = []
    for item in data.get("results") or []:
        candidato = _candidato_valido(
            titulo=str(item.get("title") or ""),
            precio=item.get("price"),
            moneda=str(item.get("currency_id") or MONEDA_ARS).upper(),
            link=str(item.get("permalink") or ""),
        )
        if candidato:
            candidatos.append(candidato)
    return candidatos


def _candidatos_desde_html(q: str) -> List[Dict[str, Any]]:
    """
    Scrapea `listado.mercadolibre.com.ar` (host de site MLA) y devuelve items
    que pasan la validación de moneda y precio.

    Raises:
        ErrorRedML: timeout, falla de conexión o status HTTP != 200.
    """
    url = f"{LISTADO_MLA}/search?q={requests.utils.quote(q)}"
    logger.info("Buscando en listado MLA: %s", url)

    try:
        resp = requests.get(url, headers=HEADERS_NAVEGADOR, timeout=15)
    except requests.RequestException as exc:
        raise ErrorRedML(f"Falla de red en listado MLA: {exc}") from exc

    if resp.status_code != 200:
        raise ErrorRedML(f"listado MLA respondió status {resp.status_code}")

    soup = BeautifulSoup(resp.text, "html.parser")
    items = (
        soup.select("ol.ui-search-layout li.ui-search-layout__item")
        or soup.select("div.ui-search-result__content")
        or soup.select("[data-testid='result-item']")
    )
    if not items:
        logger.warning("Sin resultados parseables en el HTML de MLA")
        return []

    candidatos: List[Dict[str, Any]] = []
    for item in items[:MAX_CANDIDATOS]:
        titulo_el = (
            item.select_one("h2.ui-search-item__title")
            or item.select_one("[data-testid='item-title']")
            or item.select_one("h2")
        )
        precio_el = (
            item.select_one("span.andes-money-amount__fraction")
            or item.select_one("[data-testid='price-part']")
            or item.select_one(".ui-search-price__part .andes-money-amount__fraction")
        )
        simbolo_el = item.select_one("span.andes-money-amount__currency-symbol")
        link_el = item.select_one("a.ui-search-item__group__element") or item.select_one("a")

        candidato = _candidato_valido(
            titulo=titulo_el.get_text(strip=True) if titulo_el else "",
            precio=_extraer_precio(precio_el.get_text(strip=True) if precio_el else ""),
            moneda=_moneda_desde_simbolo(simbolo_el.get_text(strip=True) if simbolo_el else ""),
            link=str(link_el.get("href") or "") if link_el else "",
        )
        if candidato:
            candidatos.append(candidato)
    return candidatos


# =============================================================================
# API PÚBLICA DEL MÓDULO
# =============================================================================
def buscar_en_mercadolibre(nombre: str, access_token: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Busca el precio de referencia del producto en MercadoLibre ARGENTINA (MLA).

    La consulta que viaja a ML es la SANITIZADA (palabras clave, sin conectores,
    máximo MAX_PALABRAS_BUSQUEDA términos). El precio devuelto NO es el de la
    primera publicación: se recolectan TODAS las coincidencias, se descarta el
    20 % inferior y el 20 % superior de los valores y se toma la MEDIANA.

    Args:
        nombre: Término de búsqueda (ej: "Disco Duro WD Purple 1TB").
        access_token: Token OAuth de ML (opcional). Si está presente se consulta
            la API oficial pineada a MLA (devuelve `currency_id` verificable).

    Returns:
        Dict {titulo, precio, moneda, link, muestras} del precio de referencia
        robusto, o:
        - {"fuente_error": "sin_coincidencia"} → la fuente respondió pero ningún
          título corresponde (no se inyecta un match erróneo).
        - {"fuente_error": "error_red"} → timeout/conexión/status bloqueado.
    """
    tokens = tokens_relevantes(nombre)
    hubo_respuesta_api = False
    error_red_scraping = False
    # Muestra acumulada de TODAS las variantes (sin duplicar publicaciones).
    acumulados: List[Dict[str, Any]] = []
    vistos = set()

    for variante in variantes_busqueda(nombre):
        candidatos: List[Dict[str, Any]] = []

        if access_token:
            try:
                desde_api = _candidatos_desde_api(variante, access_token)
                if desde_api is not None:
                    hubo_respuesta_api = True
                    candidatos = desde_api
            except ErrorRedML as exc:
                logger.warning("API MLA falló: %s", exc)

        if not candidatos:
            try:
                candidatos = _candidatos_desde_html(variante)
            except ErrorRedML as exc:
                logger.warning("Scraping MLA falló: %s", exc)
                error_red_scraping = True
                candidatos = []

        # Acumular sin duplicar publicaciones (la misma aparece en 2 variantes).
        for candidato in candidatos:
            clave = (
                str(candidato["link"] or "").strip()
                or _compactar(candidato["titulo"]),
                round(float(candidato["precio"]), 2),
            )
            if clave in vistos:
                continue
            vistos.add(clave)
            acumulados.append(candidato)

        # Con suficientes muestras coincidentes no se gastan más requests: la
        # mediana recortada ya es estable.
        coincidentes = sum(
            1 for c in acumulados if _coincide_por_tokens(tokens, c["titulo"])
        )
        if coincidentes >= MIN_MUESTRAS_SUFICIENTES:
            break

    # Precio de referencia robusto: mediana de la muestra recortada al 20 %.
    elegido = precio_referencia_robusto(acumulados, tokens)
    if elegido:
        logger.info(
            "MLA referencia robusta: '%s' - ARS %.2f (mediana de %s muestras de %s)",
            elegido["titulo"],
            elegido["precio"],
            elegido["muestras"],
            elegido["muestras_totales"],
        )
        return elegido

    # Sin coincidencias validadas: se distingue red caída de "no hay match".
    if hubo_respuesta_api:
        return {"fuente_error": "sin_coincidencia"}
    if error_red_scraping:
        return {"fuente_error": "error_red"}
    return {"fuente_error": "sin_coincidencia"}
