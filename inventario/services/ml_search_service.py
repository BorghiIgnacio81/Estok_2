"""
Servicio de búsqueda de precios en MercadoLibre Argentina.
Usa la API autenticada de MercadoLibre (requiere OAuth).

Documentación: https://developers.mercadolibre.com.ar/es_ar/items-y-busquedas
"""

import logging
import urllib.request
import urllib.parse
import urllib.error
import json
from dataclasses import dataclass, field, asdict
from typing import Optional

from .mercadolibre_oauth import get_valid_access_token

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
    Usa la API autenticada con OAuth.
    """

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

        # Obtener token de acceso OAuth
        access_token = get_valid_access_token()
        if not access_token:
            return MLSearchResponse(
                error="No hay token de MercadoLibre. Ve a /api/mercadolibre/auth/ para autorizar la app."
            )

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
        logger.info("Consultando ML API con OAuth: %s", url)

        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "User-Agent": "Estok/1.0",
                    "Accept": "application/json",
                }
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                data = json.loads(response.read().decode("utf-8"))

            results_raw = data.get("results", [])
            total = data.get("paging", {}).get("total", 0)

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

            return MLSearchResponse(
                results=results,
                total=total,
                query=query,
            )

        except urllib.error.HTTPError as e:
            logger.error("Error HTTP al consultar ML API: %d %s", e.code, e.reason)
            # Si es 401 o 403, el token puede haber expirado, intentar refrescar
            if e.code in (401, 403):
                logger.info("Token posiblemente expirado, intentando refrescar...")
                from .mercadolibre_oauth import refresh_access_token
                new_token = refresh_access_token()
                if new_token:
                    # Reintentar con el nuevo token
                    return self._reintentar_con_token(url, new_token, limit)
                return MLSearchResponse(
                    error="Token expirado y no se pudo refrescar. Ve a /api/mercadolibre/auth/ para re-autorizar."
                )
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

    def _reintentar_con_token(self, url: str, access_token: str, limit: int) -> MLSearchResponse:
        """Reintenta la búsqueda con un token nuevo."""
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "User-Agent": "Estok/1.0",
                    "Accept": "application/json",
                }
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                data = json.loads(response.read().decode("utf-8"))

            results_raw = data.get("results", [])
            total = data.get("paging", {}).get("total", 0)

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

            return MLSearchResponse(results=results, total=total, query="reintento")
        except Exception as e:
            logger.error("Error en reintento con token nuevo: %s", e)
            return MLSearchResponse(error=f"Error incluso después de refrescar token: {e}")
