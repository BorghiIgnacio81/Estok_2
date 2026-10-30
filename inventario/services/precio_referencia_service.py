"""
Servicio de Precio de Referencia (MercadoLibre Argentina + fallback IA).

Busca precios de referencia para objetos mediante:
1. MercadoLibre ARGENTINA (site MLA): delega en `mercadolibre_busqueda`, que
   fuerza el site MLA, valida que el título coincida con la búsqueda y descarta
   cualquier moneda distinta de ARS (ver docstring de ese módulo: es el fix del
   match erróneo que inyectaba precios en dólares).
2. Fallback a Gemini API para estimación por IA (estimación pedida en ARS).

BÚSQUEDA FLEXIBLE DE LIBROS (ISBN + Título/Autor):
   Cuando el objeto trae ISBN (parámetro `isbn` o un código de 10/13 dígitos
   dentro del nombre), primero se ejecuta la búsqueda ESTRICTA por ISBN (edición
   exacta). Como una edición rara/coleccionable puede devolver muy pocas
   muestras o un valor desproporcionado (ej. $120.000 contra $30.000 de la
   edición común), SIEMPRE se ejecuta además la búsqueda COMPLEMENTARIA por
   «Título + Autor» y se publica la mediana representativa del mercado local
   cuando la muestra del ISBN resulta escasa o desproporcionada.

Todos los precios devueltos salen con `moneda = "ARS"`.
"""

import logging
import re
import os
import unicodedata
from typing import Optional, Dict, Any, Tuple

import requests

from .mercadolibre_busqueda import (
    MIN_MUESTRAS_SUFICIENTES,
    MONEDA_ARS,
    buscar_en_mercadolibre,
    extraer_isbn,
    quitar_isbn,
)

# Re-export: `buscar_en_mercadolibre` era parte de la API histórica de este
# módulo y hoy vive en `mercadolibre_busqueda`. Se mantiene el acceso.
__all__ = ["buscar_precio_referencia", "buscar_en_mercadolibre"]

logger = logging.getLogger(__name__)

# Factores de ajuste según estado de conservación.
#
# REGLA DE NEGOCIO (consistencia del valor de referencia):
#   · «nuevo» / «excelente» → 1.0 (valor de mercado pleno de la publicación),
#   · «bueno»               → 0.8 (desgaste normal),
#   · «regular»             → 0.6 (fallas visibles / uso intensivo).
# Los estados más degradados conservan su escala histórica para no inflar
# piezas que ya no son revendibles como el ítem de la publicación.
FACTORES_AJUSTE = {
    "nuevo": 1.0,
    "excelente": 1.0,
    "como_nuevo": 1.0,
    "bueno": 0.8,
    "regular": 0.6,
    "malo": 0.5,
    "muy_malo": 0.4,
}

# Estado sin datos o desconocido: se asume «bueno» (desgaste normal).
FACTOR_ESTADO_POR_DEFECTO = 0.8

# FLEXIBILIDAD DE LA BÚSQUEDA POR ISBN (libros):
#   · una edición exacta con MENOS de `MIN_MUESTRAS_SUFICIENTES` publicaciones
#     no representa al mercado (2 avisos de coleccionistas no son una mediana);
#   · una edición rara puede costar el doble o más que la edición común, así que
#     si la mediana del ISBN se aparta de la del «Título + Autor» por este factor
#     se publica la muestra complementaria (mercado local).
RATIO_DISPROPORCION_ISBN = 2.0

# Mensajes de la respuesta controlada (`encontrado = False`). El frontend los
# muestra tal cual (lib/precioReferencia.ts): un «sin resultados» NUNCA debe
# presentarse como «error de conexión».
MENSAJE_SIN_RESULTADOS = "No se encontraron publicaciones similares en Mercado Libre."
MENSAJE_ERROR_RED = (
    "No se pudo consultar Mercado Libre (problema de red o bloqueo temporal). "
    "Intentá de nuevo en unos minutos."
)


def _mensaje_sin_precio(fuente_error: Optional[str]) -> str:
    """Texto claro para el usuario según el motivo del `encontrado = False`."""
    if fuente_error == "error_red":
        return MENSAJE_ERROR_RED
    return MENSAJE_SIN_RESULTADOS


def _sin_acentos(texto: str) -> str:
    """Quita diacríticos («Muy Malo» ↔ «muy_malo» se comparan igual)."""
    descompuesto = unicodedata.normalize("NFKD", texto or "")
    return "".join(c for c in descompuesto if not unicodedata.combining(c))


def _normalizar_estado(estado: str) -> str:
    """
    Normaliza el estado recibido del formulario: minúsculas, sin acentos y con
    espacios/guiones convertidos a `_` («Muy Malo» → «muy_malo»).
    """
    base = re.sub(r"[\s\-]+", "_", _sin_acentos(estado or "").strip().lower())
    return base.strip("_")


def _factor_estado(estado: str) -> float:
    """Factor multiplicador del estado de conservación (1.0 / 0.8 / 0.6 …)."""
    return FACTORES_AJUSTE.get(
        _normalizar_estado(estado), FACTOR_ESTADO_POR_DEFECTO
    )


def _ajustar_precio(precio: float, estado: str) -> float:
    """Aplica el factor de ajuste según estado de conservación."""
    return round(precio * _factor_estado(estado), 2)


def _respuesta_encontrada(
    titulo: str,
    precio: float,
    link: str,
    estado: str,
    fuente: str,
    muestras: Optional[int] = None,
    metodo: Optional[str] = None,
    isbn: Optional[str] = None,
) -> Dict[str, Any]:
    """Respuesta estándar de precio encontrado (siempre en pesos argentinos)."""
    factor = _factor_estado(estado)
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
        # Cantidad de publicaciones usadas en la mediana recortada (None cuando
        # el precio proviene de una estimación de IA, sin muestra real).
        "muestras": muestras,
        # TRAZABILIDAD de la búsqueda flexible (libros): qué muestra definió la
        # mediana — 'isbn' (edición exacta), 'titulo_autor' (mercado local) o
        # None (búsqueda directa / estimación de IA) — y el ISBN consultado.
        "metodo_busqueda": metodo,
        "isbn_consultado": isbn or None,
        # Sin mensaje: la tarjeta del precio habla por sí sola.
        "mensaje": None,
    }


def _respuesta_vacia(estado: str, fuente_error: Optional[str]) -> Dict[str, Any]:
    """
    Respuesta estándar SIN precio (error controlado).

    Se usa tanto para 'sin coincidencia confiable' como para 'error_red': nunca
    se devuelve un precio proveniente de un match no verificado. Los precios van
    en `null` y `mensaje` explica el motivo en lenguaje claro para el usuario.
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
        "muestras": None,
        "mensaje": _mensaje_sin_precio(fuente_error),
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
            "nuevo": "nuevo (sin uso, en caja)",
            "como_nuevo": "como nuevo (impecable, sin marcas)",
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


def _consulta_titulo_autor(
    nombre: str, autor: Optional[str], isbn: str
) -> str:
    """
    Consulta COMPLEMENTARIA «Título + Autor», sin el código ISBN.

    Es la que representa al mercado local (la edición común del libro) y la que
    se usa cuando la búsqueda estricta por ISBN devuelve una muestra escasa o
    desproporcionada. Sin autor se consulta el título tal como vino.
    """
    titulo = quitar_isbn(nombre) if isbn else (nombre or "")
    autor_limpio = re.sub(r"\s+", " ", (autor or "")).strip()
    consulta = f"{titulo.strip()} {autor_limpio}".strip()
    return consulta or (nombre or "").strip()


def _tiene_precio(resultado: Optional[Dict[str, Any]]) -> bool:
    """True si el resultado de MLA trae un precio utilizable."""
    return bool(
        isinstance(resultado, dict)
        and isinstance(resultado.get("precio"), (int, float))
    )


def _elegir_muestra_representativa(
    resultado_isbn: Optional[Dict[str, Any]],
    resultado_titulo: Optional[Dict[str, Any]],
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Elige qué muestra define el precio de referencia de un LIBRO.

    Regla (búsqueda flexible ISBN + Título/Autor):
      · sin precio por ISBN → vale la muestra «Título + Autor»;
      · sin precio por «Título + Autor» → vale la del ISBN;
      · con AMBAS: se publica la del ISBN sólo si tiene muestra suficiente
        (`MIN_MUESTRAS_SUFICIENTES`) y su mediana NO se aparta del mercado local
        más de `RATIO_DISPROPORCION_ISBN` (ni por arriba ni por abajo). Si la
        edición es rara/cara o hay muy pocos avisos, gana la mediana del mercado
        local («Título + Autor»).

    Returns:
        (resultado elegido o None, 'isbn' | 'titulo_autor' | None)
    """
    if not _tiene_precio(resultado_isbn):
        if _tiene_precio(resultado_titulo):
            logger.info(
                "ISBN sin muestra utilizable: se usa la mediana «Título + Autor»"
            )
            return resultado_titulo, "titulo_autor"
        return None, None

    if not _tiene_precio(resultado_titulo):
        return resultado_isbn, "isbn"

    muestras_isbn = int(resultado_isbn.get("muestras") or 0)
    precio_isbn = float(resultado_isbn["precio"])
    precio_titulo = float(resultado_titulo["precio"])
    ratio = precio_isbn / precio_titulo if precio_titulo > 0 else 1.0

    if (
        muestras_isbn < MIN_MUESTRAS_SUFICIENTES
        or ratio >= RATIO_DISPROPORCION_ISBN
        or ratio <= (1 / RATIO_DISPROPORCION_ISBN)
    ):
        logger.info(
            "Edición por ISBN poco representativa (muestras=%s, ratio=%.2f): "
            "se publica la mediana «Título + Autor»",
            muestras_isbn,
            ratio,
        )
        return resultado_titulo, "titulo_autor"

    return resultado_isbn, "isbn"


def _resolver_busqueda_ml(
    *,
    nombre: str,
    autor: Optional[str],
    isbn: str,
    access_token: Optional[str],
    categoria: Optional[str],
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Ejecuta la búsqueda en Mercado Libre y devuelve (resultado, método usado).

    Con ISBN se hacen DOS consultas: la estricta por ISBN (edición exacta, sin
    filtro de categoría — cualquier restricción extra hace que MLA no devuelva
    la edición) y la complementaria por «Título + Autor» (mercado local). Sin
    ISBN se mantiene la búsqueda histórica (nombre/consulta + categoría).
    """
    consulta = _consulta_titulo_autor(nombre, autor, isbn)

    if not isbn:
        return (
            buscar_en_mercadolibre(consulta, access_token=access_token, categoria=categoria),
            None,
        )

    resultado_isbn = buscar_en_mercadolibre(isbn, access_token=access_token)
    resultado_titulo = buscar_en_mercadolibre(
        consulta, access_token=access_token, categoria=categoria
    )
    elegido, metodo = _elegir_muestra_representativa(resultado_isbn, resultado_titulo)
    if elegido:
        return elegido, metodo

    # Sin precio en ninguna de las dos: 'error_red' sólo si TODAS fallaron por
    # red; si al menos una respondió, el motivo real es «sin coincidencia».
    errores = [
        resultado.get("fuente_error")
        for resultado in (resultado_isbn, resultado_titulo)
        if isinstance(resultado, dict)
    ]
    if errores and all(error == "error_red" for error in errores):
        return {"fuente_error": "error_red"}, None
    return {"fuente_error": "sin_coincidencia"}, None


def buscar_precio_referencia(
    nombre: str,
    estado: str = "bueno",
    access_token: Optional[str] = None,
    categoria: Optional[str] = None,
    isbn: Optional[str] = None,
    autor: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Busca un precio de referencia para un objeto (SIEMPRE en pesos argentinos).

    Primero consulta MercadoLibre ARGENTINA (site MLA) con la búsqueda
    SANITIZADA (palabras clave, sin conectores, máx. 4 términos), validación de
    coincidencia de título y de moneda ARS. El valor devuelto es la MEDIANA de
    la muestra recortada (se descarta el 20 % más bajo y el 20 % más alto) y
    después se multiplica por el factor del estado (nuevo 1.0 / bueno 0.8 /
    regular 0.6). Si no hay un match confiable, estima con Gemini. Si nada
    resulta confiable devuelve un error CONTROLADO en lugar de inyectar el
    precio de un producto equivocado.

    BÚSQUEDA FLEXIBLE DE LIBROS: con `isbn` (o un código de 10/13 dígitos dentro
    de `nombre`) se ejecuta la búsqueda ESTRICTA por ISBN y, además, la
    COMPLEMENTARIA por «Título + Autor». Si la edición del ISBN tiene muy pocas
    publicaciones o su mediana se aparta del mercado local (edición rara de
    $120.000 frente a la común de $30.000), se publica la mediana del mercado
    local; `metodo_busqueda` deja la trazabilidad de la muestra usada.

    Args:
        nombre: Nombre del objeto a buscar (título del libro, incluya o no ISBN).
        estado: Estado de conservación (nuevo, excelente, bueno, regular, malo,
            muy_malo). Se normaliza (minúsculas, sin acentos).
        access_token: Token OAuth de ML del usuario (opcional). Si está presente
            se usa la API oficial pineada a MLA (`/sites/MLA/search`); si no, el
            scraping del listado `.com.ar` (ambos con validación de moneda ARS).
        categoria: Categoría del objeto (ID oficial «MLA1430», nombre «Ropa» o
            subtipo «ropa»). Restringe la búsqueda por `category` y, si esa
            búsqueda no devuelve ítems, se reintenta sin filtro (fallback).
        isbn: ISBN/ISSN del objeto (opcional). Habilita la búsqueda estricta por
            edición + la complementaria por «Título + Autor».
        autor: Autor del libro (opcional). Se suma a la consulta complementaria.

    Returns:
        Dict con la estructura de respuesta estándar (incluye `moneda` y, cuando
        no hay precio, `mensaje` con el motivo en lenguaje claro).
    """
    # Estado normalizado UNA sola vez: los factores (1.0 / 0.8 / 0.6) y el
    # `estado_aplicado` de la respuesta quedan coherentes entre sí.
    estado = _normalizar_estado(estado) or "bueno"

    # ISBN explícito (campo ISBN/ISSN) o detectado dentro del nombre. Se acepta
    # sólo con largo canónico: un ISSN corto o un texto suelto no habilitan la
    # búsqueda estricta por edición.
    isbn_objetivo = re.sub(r"[^0-9xX]", "", (isbn or "")).upper()
    if not (10 <= len(isbn_objetivo) <= 13):
        isbn_objetivo = extraer_isbn(f"{isbn or ''} {nombre}")
    # Consulta complementaria «Título + Autor» (sin el número del ISBN).
    consulta = _consulta_titulo_autor(nombre, autor, isbn_objetivo)

    resultado_ml, metodo = _resolver_busqueda_ml(
        nombre=nombre,
        autor=autor,
        isbn=isbn_objetivo,
        access_token=access_token,
        categoria=categoria,
    )
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
            # Publicaciones que sobrevivieron al recorte del 20 % por cola.
            muestras=resultado_ml.get("muestras"),
            metodo=metodo,
            isbn=isbn_objetivo,
        )

    # Fallback a Gemini (estimación pedida explícitamente en ARS). La consulta
    # lleva el título sin ISBN + autor cuando existe: es más precisa que el
    # nombre crudo y no cambia el contrato de la respuesta.
    logger.info("MLA sin coincidencias para '%s', intentando Gemini fallback", consulta)
    resultado_gemini = _estimar_con_gemini(consulta or nombre, estado)
    if resultado_gemini:
        return _respuesta_encontrada(
            titulo=resultado_gemini["titulo"],
            precio=resultado_gemini["precio"],
            link=resultado_gemini["link"],
            estado=estado,
            fuente="gemini_estimacion",
            isbn=isbn_objetivo,
        )

    # Error controlado: sin coincidencia verificada no se devuelve ningún precio.
    return _respuesta_vacia(estado, fuente_error or "sin_coincidencia")
