"""
Servicio de búsqueda de precios de referencia en MercadoLibre Argentina.

Usa OAuth de usuario con refresh automático.
El token se guarda en la base de datos (MercadoLibreToken) y se refresca
automáticamente cuando expira usando el refresh_token.

Flujo:
  1. El usuario visita /api/mercadolibre/auth/ → redirige a ML para autorizar
  2. ML redirige a /api/mercadolibre/callback/ → guarda tokens en DB
  3. PriceSearchService obtiene el token de DB y lo refresca si es necesario
"""

import logging
from typing import Dict, Any, List, Optional

import requests

from inventario.services import mercadolibre_oauth as ml_oauth

logger = logging.getLogger(__name__)


class MercadoLibreAuthError(Exception):
    """Error de autenticación con MercadoLibre."""
    pass


class PriceSearchService:
    """
    Servicio para buscar precios de referencia en MercadoLibre Argentina.
    Usa OAuth de usuario con refresh automático desde la base de datos.
    """

    SEARCH_URL = "https://api.mercadolibre.com/sites/MLA/search"
    ITEM_URL = "https://api.mercadolibre.com/items/"

    def _get_access_token(self) -> str:
        """
        Obtiene un access_token válido desde la base de datos.
        Si está expirado, lo refresca automáticamente.
        """
        token = ml_oauth.obtener_token_valido()
        if not token:
            raise MercadoLibreAuthError(
                "No hay token de MercadoLibre configurado. "
                "Andá a Configuración → Conectar con MercadoLibre "
                "para autorizar la aplicación."
            )
        return token.access_token

    def _get_headers(self) -> Dict[str, str]:
        """Retorna headers con autenticación."""
        access_token = self._get_access_token()
        return {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        }

    def buscar_precios(
        self,
        query: str,
        limit: int = 5,
        sort: str = "price_asc",
    ) -> Dict[str, Any]:
        """
        Busca precios de referencia en MercadoLibre Argentina.

        Args:
            query: Término de búsqueda (ej: "iPhone 14", "Manual Electronica")
            limit: Cantidad máxima de resultados (default: 5, max: 20)
            sort: Ordenamiento (price_asc, price_desc, relevance)

        Returns:
            Dict con:
                - resultados: Lista de resultados
                - promedio: Precio promedio
                - minimo: Precio mínimo
                - maximo: Precio máximo
                - cantidad: Cantidad de resultados
                - fuente: "mercadolibre"
        """
        limit = min(max(limit, 1), 20)

        try:
            headers = self._get_headers()
        except MercadoLibreAuthError as e:
            return {
                "error": str(e),
                "resultados": [],
                "promedio": 0,
                "minimo": 0,
                "maximo": 0,
                "cantidad": 0,
                "fuente": "mercadolibre",
                "no_configurado": True,
            }

        params = {"q": query, "limit": limit}
        if sort in ("price_asc", "price_desc", "relevance"):
            params["sort"] = sort

        try:
            logger.info("🔍 Buscando en MercadoLibre: '%s' (limit=%d)", query, limit)
            response = requests.get(
                self.SEARCH_URL,
                params=params,
                headers=headers,
                timeout=15,
            )

            if response.status_code == 401:
                logger.error("❌ Token de MercadoLibre expirado o inválido")
                return {
                    "error": (
                        "El token de MercadoLibre expiró. "
                        "Andá a Configuración → Conectar con MercadoLibre "
                        "para renovar la autorización."
                    ),
                    "resultados": [],
                    "promedio": 0,
                    "minimo": 0,
                    "maximo": 0,
                    "cantidad": 0,
                    "fuente": "mercadolibre",
                    "token_expirado": True,
                }

            response.raise_for_status()
            data = response.json()

            resultados = []
            for item in data.get('results', []):
                resultados.append({
                    "titulo": item.get('title', ''),
                    "precio": item.get('price', 0),
                    "moneda": item.get('currency_id', 'ARS'),
                    "url": item.get('permalink', ''),
                    "vendedor": item.get('seller', {}).get('nickname', 'Desconocido'),
                    "condicion": item.get('condition', ''),
                    "ubicacion": item.get('address', {}).get('city_name', ''),
                })

            precios = [r['precio'] for r in resultados if r['precio'] > 0]

            return {
                "resultados": resultados,
                "promedio": sum(precios) / len(precios) if precios else 0,
                "minimo": min(precios) if precios else 0,
                "maximo": max(precios) if precios else 0,
                "cantidad": len(resultados),
                "fuente": "mercadolibre",
            }

        except requests.exceptions.Timeout:
            logger.error("Timeout al consultar MercadoLibre")
            return {
                "error": "La consulta a MercadoLibre tardó demasiado. Intenta de nuevo.",
                "resultados": [],
                "promedio": 0,
                "minimo": 0,
                "maximo": 0,
                "cantidad": 0,
                "fuente": "mercadolibre",
            }
        except requests.exceptions.RequestException as e:
            logger.error("Error al consultar MercadoLibre: %s", e)
            return {
                "error": f"Error al consultar MercadoLibre: {str(e)}",
                "resultados": [],
                "promedio": 0,
                "minimo": 0,
                "maximo": 0,
                "cantidad": 0,
                "fuente": "mercadolibre",
            }

    def obtener_detalle_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        """
        Obtiene el detalle de un item específico de MercadoLibre.

        Args:
            item_id: ID del item (ej: "MLA1234567890")

        Returns:
            Dict con datos del item, o None si hay error.
        """
        try:
            headers = self._get_headers()
        except MercadoLibreAuthError:
            return None

        try:
            resp = requests.get(
                f"{self.ITEM_URL}{item_id}",
                headers=headers,
                timeout=10,
            )
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.RequestException as e:
            logger.error("Error al obtener detalle de item %s: %s", item_id, e)
            return None
