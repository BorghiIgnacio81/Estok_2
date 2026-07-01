"""
Servicio de OAuth para MercadoLibre.
Maneja el flujo completo: autorización, callback, refresh automático.
"""

import logging
import urllib.request
import urllib.parse
import json
import os
from datetime import datetime, timedelta
from typing import Optional

from django.utils import timezone

from ..models import MercadoLibreToken

logger = logging.getLogger(__name__)

# URLs de la API de OAuth de MercadoLibre
ML_AUTH_URL = "https://auth.mercadolibre.com.ar/authorization"
ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token"

# URL de callback (debe coincidir con lo configurado en el DevCenter de ML)
CALLBACK_URL = "https://eeestok.duckdns.org/api/mercadolibre/callback/"


def get_client_id() -> Optional[str]:
    return os.environ.get("MERCADOLIBRE_CLIENT_ID")


def get_client_secret() -> Optional[str]:
    return os.environ.get("MERCADOLIBRE_CLIENT_SECRET")


def get_auth_url(state: str = "estok_ml_auth") -> str:
    """
    Genera la URL de autorización para redirigir al usuario a MercadoLibre.
    """
    client_id = get_client_id()
    if not client_id:
        raise ValueError("MERCADOLIBRE_CLIENT_ID no está configurado")

    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": CALLBACK_URL,
        "state": state,
    }
    return f"{ML_AUTH_URL}?{urllib.parse.urlencode(params)}"


def exchange_code_for_token(code: str) -> Optional[dict]:
    """
    Intercambia un código de autorización por un token de acceso.
    """
    client_id = get_client_id()
    client_secret = get_client_secret()
    if not client_id or not client_secret:
        logger.error("MERCADOLIBRE_CLIENT_ID o MERCADOLIBRE_CLIENT_SECRET no configurados")
        return None

    data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": CALLBACK_URL,
    }).encode("utf-8")

    try:
        req = urllib.request.Request(
            ML_TOKEN_URL,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            token_data = json.loads(response.read().decode("utf-8"))

        logger.info("Token obtenido exitosamente de MercadoLibre")
        return token_data

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else "sin cuerpo"
        logger.error("Error HTTP al obtener token: %d %s - %s", e.code, e.reason, error_body)
        return None
    except Exception as e:
        logger.error("Error inesperado al obtener token: %s", e)
        return None


def save_token(token_data: dict) -> Optional[MercadoLibreToken]:
    """
    Guarda o actualiza el token en la base de datos.
    Solo existe un token activo a la vez.
    """
    # Eliminar token anterior si existe
    MercadoLibreToken.objects.all().delete()

    token = MercadoLibreToken.objects.create(
        access_token=token_data.get("access_token", ""),
        refresh_token=token_data.get("refresh_token", ""),
        token_type=token_data.get("token_type", "Bearer"),
        expires_in=token_data.get("expires_in", 21600),
        scope=token_data.get("scope", ""),
        user_id=token_data.get("user_id"),
    )
    logger.info("Token guardado en DB (user_id=%s)", token.user_id)
    return token


def refresh_access_token() -> Optional[str]:
    """
    Refresca el token de acceso usando el refresh_token almacenado.
    Retorna el nuevo access_token o None si falla.
    """
    token = MercadoLibreToken.objects.first()
    if not token:
        logger.warning("No hay token para refrescar")
        return None

    client_id = get_client_id()
    client_secret = get_client_secret()
    if not client_id or not client_secret:
        logger.error("Credenciales de ML no configuradas")
        return None

    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": token.refresh_token,
    }).encode("utf-8")

    try:
        req = urllib.request.Request(
            ML_TOKEN_URL,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            new_token_data = json.loads(response.read().decode("utf-8"))

        # Actualizar el token en DB
        token.access_token = new_token_data.get("access_token", token.access_token)
        token.refresh_token = new_token_data.get("refresh_token", token.refresh_token)
        token.expires_in = new_token_data.get("expires_in", token.expires_in)
        token.scope = new_token_data.get("scope", token.scope)
        token.save()

        logger.info("Token refrescado exitosamente")
        return token.access_token

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else "sin cuerpo"
        logger.error("Error HTTP al refrescar token: %d %s - %s", e.code, e.reason, error_body)
        # Si el refresh falla (ej: token expirado), eliminar el token
        if e.code == 400:
            logger.warning("Refresh token inválido, eliminando token de DB")
            token.delete()
        return None
    except Exception as e:
        logger.error("Error inesperado al refrescar token: %s", e)
        return None


def get_valid_access_token() -> Optional[str]:
    """
    Obtiene un access_token válido, refrescándolo si es necesario.
    Retorna None si no hay token o no se puede refrescar.
    """
    token = MercadoLibreToken.objects.first()
    if not token:
        logger.warning("No hay token de MercadoLibre en DB")
        return None

    # Verificar si el token está por expirar (menos de 5 minutos)
    tiempo_vida = (timezone.now() - token.updated_at).total_seconds()
    if tiempo_vida > (token.expires_in - 300):  # 5 min de margen
        logger.info("Token por expirar, refrescando...")
        return refresh_access_token()

    return token.access_token


def delete_token() -> bool:
    """Elimina el token de MercadoLibre de la base de datos."""
    count, _ = MercadoLibreToken.objects.all().delete()
    logger.info("Token eliminado de DB (%d objetos eliminados)", count)
    return count > 0
