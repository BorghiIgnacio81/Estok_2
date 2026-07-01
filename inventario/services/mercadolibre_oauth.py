"""
Servicio OAuth para MercadoLibre.
Maneja el flujo completo: autorización, callback, refresh automático.
"""

import logging
import os
from typing import Dict, Any, Optional

import requests
from django.conf import settings
from django.utils import timezone

from inventario.models import MercadoLibreToken

logger = logging.getLogger(__name__)


# =============================================================================
# URLs de MercadoLibre OAuth
# =============================================================================
ML_AUTH_URL = "https://auth.mercadolibre.com.ar/authorization"
ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token"


def get_client_id() -> str:
    """Obtiene el Client ID desde settings o variable de entorno."""
    client_id = getattr(settings, 'MERCADOLIBRE_CLIENT_ID', None)
    if not client_id:
        client_id = os.environ.get('MERCADOLIBRE_CLIENT_ID', '')
    return client_id


def get_client_secret() -> str:
    """Obtiene el Client Secret desde settings o variable de entorno."""
    client_secret = getattr(settings, 'MERCADOLIBRE_CLIENT_SECRET', None)
    if not client_secret:
        client_secret = os.environ.get('MERCADOLIBRE_CLIENT_SECRET', '')
    return client_secret


def get_redirect_uri() -> str:
    """
    Obtiene la URI de redirección para el callback OAuth.
    En producción usa el dominio configurado.
    """
    base_url = os.environ.get(
        'SITE_URL',
        'https://eeestok.duckdns.org'
    )
    return f"{base_url}/api/mercadolibre/callback/"


def generar_url_autorizacion() -> str:
    """
    Genera la URL de autorización de MercadoLibre.
    El usuario debe visitar esta URL para autorizar la app.
    """
    client_id = get_client_id()
    if not client_id:
        raise ValueError(
            "MERCADOLIBRE_CLIENT_ID no está configurado. "
            "Agregalo como variable de entorno en Coolify."
        )

    redirect_uri = get_redirect_uri()

    params = (
        f"response_type=code"
        f"&client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&scope=read+offline_access"
        f"&prompt=consent"
    )
    return f"{ML_AUTH_URL}?{params}"


def canjear_codigo_por_token(code: str) -> Dict[str, Any]:
    """
    Canjea el código de autorización por access_token y refresh_token.

    Args:
        code: Código de autorización recibido en el callback

    Returns:
        Dict con la respuesta de MercadoLibre (access_token, refresh_token, etc.)
    """
    client_id = get_client_id()
    client_secret = get_client_secret()
    redirect_uri = get_redirect_uri()

    if not client_id or not client_secret:
        raise ValueError(
            "MERCADOLIBRE_CLIENT_ID y MERCADOLIBRE_CLIENT_SECRET "
            "deben estar configurados."
        )

    try:
        resp = requests.post(
            ML_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.RequestException as e:
        logger.error("Error al canjear código por token: %s", e)
        raise


def refrescar_token(refresh_token: str) -> Dict[str, Any]:
    """
    Refresca el access_token usando el refresh_token.

    Args:
        refresh_token: El refresh_token almacenado

    Returns:
        Dict con los nuevos tokens
    """
    client_id = get_client_id()
    client_secret = get_client_secret()

    if not client_id or not client_secret:
        raise ValueError(
            "MERCADOLIBRE_CLIENT_ID y MERCADOLIBRE_CLIENT_SECRET "
            "deben estar configurados."
        )

    try:
        resp = requests.post(
            ML_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
            },
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.RequestException as e:
        logger.error("Error al refrescar token: %s", e)
        raise


def guardar_token(data: Dict[str, Any]) -> MercadoLibreToken:
    """
    Guarda o actualiza el token en la base de datos.

    Args:
        data: Respuesta de MercadoLibre con access_token, refresh_token, etc.

    Returns:
        La instancia de MercadoLibreToken guardada
    """
    token, created = MercadoLibreToken.objects.update_or_create(
        pk=MercadoLibreToken.objects.first().pk if MercadoLibreToken.objects.exists() else None,
        defaults={
            "access_token": data.get("access_token", ""),
            "refresh_token": data.get("refresh_token", ""),
            "user_id": data.get("user_id"),
            "expires_in": data.get("expires_in", 21600),
            "scope": data.get("scope", ""),
        }
    )
    if created:
        logger.info("✅ Nuevo token de MercadoLibre guardado en DB")
    else:
        logger.info("🔄 Token de MercadoLibre actualizado en DB")
    return token


def obtener_token_valido() -> Optional[MercadoLibreToken]:
    """
    Obtiene un token válido, refrescándolo si es necesario.

    Returns:
        Instancia de MercadoLibreToken con access_token vigente,
        o None si no hay token configurado.
    """
    token = MercadoLibreToken.objects.first()
    if not token:
        logger.warning("⚠️ No hay token de MercadoLibre en la base de datos")
        return None

    if token.esta_expirado:
        logger.info("🔄 Token de MercadoLibre expirado, refrescando...")
        try:
            data = refrescar_token(token.refresh_token)
            token.access_token = data.get("access_token", token.access_token)
            token.refresh_token = data.get("refresh_token", token.refresh_token)
            token.expires_in = data.get("expires_in", token.expires_in)
            token.scope = data.get("scope", token.scope)
            token.save()
            logger.info("✅ Token refrescado automáticamente")
        except Exception as e:
            logger.error("❌ Error al refrescar token: %s", e)
            return None

    return token


def verificar_estado_token() -> Dict[str, Any]:
    """
    Verifica el estado del token actual.
    Útil para el frontend y diagnóstico.

    Returns:
        Dict con información del estado del token
    """
    token = MercadoLibreToken.objects.first()
    if not token:
        return {
            "configurado": False,
            "mensaje": (
                "No hay token de MercadoLibre configurado. "
                "Andá a Configuración → Conectar con MercadoLibre "
                "para autorizar la aplicación."
            ),
        }

    return {
        "configurado": True,
        "expirado": token.esta_expirado,
        "user_id": token.user_id,
        "expira_en_segundos": token.expires_in,
        "ultima_actualizacion": token.updated_at.isoformat() if token.updated_at else None,
        "mensaje": (
            "Token expirado. Necesitás renovarlo."
            if token.esta_expirado
            else "Token vigente."
        ),
    }
