"""
Servicio de búsqueda de precios de referencia en MercadoLibre Argentina.

Usa un access_token de USUARIO de MercadoLibre (no Client Credentials).
El token de usuario tiene acceso a la API pública de búsqueda /sites/MLA/search.

Requiere la variable de entorno:
  - MERCADOLIBRE_ACCESS_TOKEN: Token generado desde tu cuenta de MercadoLibre
    (https://developers.mercadolibre.com.ar -> "Tu aplicación" -> "Access Token")

El token de usuario expira cada 6 horas. Cuando expire, el servicio devolverá
un error indicando que necesitás renovarlo manualmente desde el panel de
desarrollador de MercadoLibre.
"""

import json
import logging
import time
from typing import Dict, Any, List, Optional

import requests

from django.conf import settings

logger = logging.getLogger(__name__)


class MercadoLibreAuthError(Exception):
    """Error de autenticación con MercadoLibre."""
    pass


class MercadoLibreAPIError(Exception):
    """Error en la consulta a la API de MercadoLibre."""
    pass


class PriceSearchService:
    """
    Servicio para buscar precios de referencia en MercadoLibre Argentina.
    Usa un access_token de usuario (no Client Credentials).
    """

    SEARCH_URL = "https://api.mercadolibre.com/sites/MLA/search"
    ITEM_URL = "https://api.mercadolibre.com/items/"
    USER_URL = "https://api.mercadolibre.com/users/me"

    def __init__(self):
        self.access_token = getattr(settings, 'MERCADOLIBRE_ACCESS_TOKEN', None)
        if not self.access_token:
            import os
            self.access_token = os.environ.get('MERCADOLIBRE_ACCESS_TOKEN', '')

    def _get_headers(self) -> Dict[str, str]:
        """Retorna headers con autenticación."""
        if not self.access_token:
            raise MercadoLibreAuthError(
                "MERCADOLIBRE_ACCESS_TOKEN no está configurado. "
                "Generalo desde https://developers.mercadolibre.com.ar "
                "y agregalo como variable de entorno en Coolify."
            )
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Accept": "application/json",
        }

    def verificar_token(self) -> Dict[str, Any]:
        """
        Verifica si el access_token es válido consultando /users/me.
        Útil para diagnosticar problemas de autenticación.
        """
        try:
            resp = requests.get(
                self.USER_URL,
                headers=self._get_headers(),
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "valido": True,
                    "usuario": data.get("nickname", ""),
                    "id": data.get("id", ""),
                    "email": data.get("email", ""),
                }
            elif resp.status_code == 401:
                return {
                    "valido": False,
                    "error": "Token expirado o inválido. Renovalo desde developers.mercadolibre.com.ar",
                    "detalle": resp.json().get("message", ""),
                }
            else:
                return {
                    "valido": False,
                    "error": f"Error inesperado: {resp.status_code}",
                    "detalle": resp.text[:200],
                }
        except requests.exceptions.RequestException as e:
            return {
                "valido": False,
                "error": f"Error de conexión: {e}",
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
                        "Andá a https://developers.mercadolibre.com.ar, "
                        "iniciá sesión, entrá a 'Tu aplicación', "
                        "copiá el nuevo Access Token y actualizalo en Coolify."
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
