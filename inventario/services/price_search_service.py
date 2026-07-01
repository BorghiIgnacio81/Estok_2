"""
Servicio de búsqueda de precios de referencia en MercadoLibre Argentina.

Usa la API oficial de MercadoLibre con autenticación OAuth (Client Credentials).
Requiere las variables de entorno:
  - MERCADOLIBRE_CLIENT_ID
  - MERCADOLIBRE_CLIENT_SECRET

El access_token se obtiene automáticamente y se cachea hasta que expira.
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
    Maneja autenticación OAuth y cacheo de tokens.
    """

    TOKEN_URL = "https://api.mercadolibre.com/oauth/token"
    SEARCH_URL = "https://api.mercadolibre.com/sites/MLA/search"
    ITEM_URL = "https://api.mercadolibre.com/items/"

    # Cache de token en memoria (se pierde al reiniciar el servidor)
    _token_cache: Dict[str, Any] = {
        "access_token": None,
        "expires_at": 0,
    }

    def __init__(self):
        self.client_id = getattr(settings, 'MERCADOLIBRE_CLIENT_ID', None) or \
            getattr(settings, 'MERCADOLIBRE_CLIENT_ID', None)
        self.client_secret = getattr(settings, 'MERCADOLIBRE_CLIENT_SECRET', None) or \
            getattr(settings, 'MERCADOLIBRE_CLIENT_SECRET', None)

        # Fallback a variables de entorno directas
        if not self.client_id:
            import os
            self.client_id = os.environ.get('MERCADOLIBRE_CLIENT_ID', '')
        if not self.client_secret:
            import os
            self.client_secret = os.environ.get('MERCADOLIBRE_CLIENT_SECRET', '')

    def _obtener_token(self) -> str:
        """
        Obtiene un access_token de MercadoLibre usando Client Credentials.
        Usa cache en memoria para evitar pedir token en cada request.
        """
        # Verificar si el token cacheado sigue vigente
        ahora = time.time()
        if (self._token_cache["access_token"] and
                self._token_cache["expires_at"] > ahora + 60):  # 1 min de margen
            return self._token_cache["access_token"]

        if not self.client_id or not self.client_secret:
            raise MercadoLibreAuthError(
                "MERCADOLIBRE_CLIENT_ID y MERCADOLIBRE_CLIENT_SECRET no están configurados. "
                "Agregalos como variables de entorno en Coolify."
            )

        try:
            logger.info("🔄 Solicitando nuevo access_token a MercadoLibre...")
            resp = requests.post(
                self.TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                },
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()

            token = data.get("access_token")
            expires_in = data.get("expires_in", 21600)  # 6 horas por defecto

            if not token:
                raise MercadoLibreAuthError(
                    f"Respuesta sin access_token: {json.dumps(data, ensure_ascii=False)}"
                )

            # Cachear
            self._token_cache["access_token"] = token
            self._token_cache["expires_at"] = ahora + expires_in

            logger.info("✅ Access_token obtenido (expira en %d segundos)", expires_in)
            return token

        except requests.exceptions.RequestException as e:
            raise MercadoLibreAuthError(f"Error al obtener token de MercadoLibre: {e}")

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
            token = self._obtener_token()
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
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                },
                timeout=15,
            )

            if response.status_code == 401:
                # Token expirado, limpiar cache y reintentar una vez
                self._token_cache["access_token"] = None
                self._token_cache["expires_at"] = 0
                logger.warning("⚠️ Token expirado, reintentando con token nuevo...")
                try:
                    token = self._obtener_token()
                    response = requests.get(
                        self.SEARCH_URL,
                        params=params,
                        headers={
                            "Authorization": f"Bearer {token}",
                            "Accept": "application/json",
                        },
                        timeout=15,
                    )
                except MercadoLibreAuthError as e:
                    return {
                        "error": f"Error de autenticación incluso después de renovar token: {e}",
                        "resultados": [],
                        "promedio": 0,
                        "minimo": 0,
                        "maximo": 0,
                        "cantidad": 0,
                        "fuente": "mercadolibre",
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
            token = self._obtener_token()
        except MercadoLibreAuthError:
            return None

        try:
            resp = requests.get(
                f"{self.ITEM_URL}{item_id}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                },
                timeout=10,
            )
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.RequestException as e:
            logger.error("Error al obtener detalle de item %s: %s", item_id, e)
            return None
