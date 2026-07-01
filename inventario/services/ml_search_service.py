"""
Servicio de búsqueda de precios en MercadoLibre Argentina.
Usa API pública por defecto; si hay token OAuth disponible, lo usa.

Documentación: https://developers.mercadolibre.com.ar/es_ar/items-y-busquedas
"""

import logging
import urllib.request
import urllib.parse
import urllib.error
import json
from dataclasses import dataclass, field, asdict
from typing import Optional

logger = logging.getLogger(__name__)

# URL base de la API de MercadoLibre
MLA_API_BASE = "https://api.mercadolibre.com/sites/MLA/search"


@dataclass
class MLSearchResult:
    """Resultado individual de búsqueda en MercadoLibre."""
    title: str
    price: float
    currency_id: str
    permalink: str
    thumbnail: str
    condition: str
    seller_city: Optional[str] = None
    available_quantity: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class MLSearchResponse:
    """Respuesta completa de la búsqueda."""
    results: list = field(default_factory=list)
    total: int = 0
    query: str = ""
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "results": [r.to_dict() for r in self.results],
            "total": self.total,
            "query": self.query,
            "error": self.error,
        }


class MLSearcher:
    """
    Buscador de precios en MercadoLibre Argentina.
    - Si hay token OAuth disponible, lo usa (mayor rate limit).
    - Si no hay token, usa API pública (sin autenticación).
    """

    def _obtener_token_si_disponible(self) -> Optional[str]:
        """
        Intenta obtener un token OAuth válido.
        Si la tabla MercadoLibreToken no existe (migración no aplicada),
        captura el error y retorna None silenciosamente.
        """
        try:
            from .mercadolibre_oauth import get_valid_access_token
            return get_valid_access_token()
        except Exception as e:
            logger.debug("No hay token OAuth disponible (modo público): %s", e)
            return None

    def _hacer_request(self, url: str, access_token: Optional[str] = None) -> dict:
        """
        Hace un request a la API de ML, con o sin token.
        Retorna el JSON parseado o lanza excepción.
        """
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
        }
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"

        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))

    def _parsear_resultados(self, data: dict, limit: int) -> list:
        """Parsea los resultados crudos de ML a MLSearchResult."""
        results_raw = data.get("results", [])
        results = []
        for item in results_raw[:limit]:
            results.append(MLSearchResult(
                title=item.get("title", ""),
                price=float(item.get("price", 0)),
                currency_id=item.get("currency_id", "ARS"),
                permalink=item.get("permalink", ""),
                thumbnail=item.get("thumbnail", ""),
                condition=item.get("condition", ""),
                seller_city=item.get("address", {}).get("city_name"),
                available_quantity=item.get("available_quantity", 0),
            ))
        return results

    def buscar(self, query: str, limit: int = 5, sort: str = "price_asc") -> MLSearchResponse:
        """
        Busca productos en MercadoLibre Argentina.

        Args:
            query: Término de búsqueda (ej: "iPhone 12", "Samsung TV 55")
            limit: Cantidad máxima de resultados (default 5, max 50)
            sort: Ordenamiento ('price_asc', 'price_desc', 'relevance')

        Returns:
            MLSearchResponse con resultados o error
        """
        if not query or not query.strip():
            return MLSearchResponse(error="El término de búsqueda no puede estar vacío")

        query = query.strip()

        # Mapeo de sort a parámetro de ML
        sort_map = {
            "price_asc": "price_asc",
            "price_desc": "price_desc",
            "relevance": "",
        }
        sort_param = sort_map.get(sort, "price_asc")

        params = {
            "q": query,
            "limit": min(limit, 50),
            "sort": sort_param,
        }

        url = f"{MLA_API_BASE}?{urllib.parse.urlencode(params)}"

        # Intentar con OAuth primero
        access_token = self._obtener_token_si_disponible()
        modo = "OAuth" if access_token else "público"
        logger.info("Consultando ML API (modo %s): %s", modo, url)

        try:
            data = self._hacer_request(url, access_token)
            total = data.get("paging", {}).get("total", 0)
            results = self._parsear_resultados(data, limit)
            return MLSearchResponse(results=results, total=total, query=query)

        except urllib.error.HTTPError as e:
            logger.error("Error HTTP al consultar ML API: %d %s", e.code, e.reason)

            # Si estábamos usando OAuth y dio 401/403, intentar refrescar
            if access_token and e.code in (401, 403):
                logger.info("Token OAuth expirado, intentando refrescar...")
                try:
                    from .mercadolibre_oauth import refresh_access_token
                    new_token = refresh_access_token()
                    if new_token:
                        logger.info("Token refrescado, reintentando con OAuth...")
                        try:
                            data = self._hacer_request(url, new_token)
                            total = data.get("paging", {}).get("total", 0)
                            results = self._parsear_resultados(data, limit)
                            return MLSearchResponse(results=results, total=total, query=query)
                        except Exception as e2:
                            logger.error("Error incluso con token refrescado: %s", e2)
                            # Caer a modo público como fallback
                except Exception as refresh_err:
                    logger.error("Error al refrescar token: %s", refresh_err)

                # Fallback: reintentar sin token (modo público)
                logger.info("Reintentando sin token (modo público)...")
                try:
                    data = self._hacer_request(url, access_token=None)
                    total = data.get("paging", {}).get("total", 0)
                    results = self._parsear_resultados(data, limit)
                    return MLSearchResponse(results=results, total=total, query=query)
                except Exception as e3:
                    logger.error("Error también en modo público: %s", e3)
                    return MLSearchResponse(error=f"Error HTTP {e.code} incluso después de reintentar: {e3}")

            return MLSearchResponse(error=f"Error HTTP {e.code}: {e.reason}")

        except urllib.error.URLError as e:
            logger.error("Error de conexión al consultar ML API: %s", e.reason)
            return MLSearchResponse(error=f"Error de conexión: {e.reason}")
        except json.JSONDecodeError as e:
            logger.error("Error al decodificar respuesta de ML API: %s", e)
            return MLSearchResponse(error=f"Error al procesar respuesta: {e}")
        except Exception as e:
            logger.error("Error inesperado al consultar ML API: %s", e)
            return MLSearchResponse(error=f"Error inesperado: {e}")
