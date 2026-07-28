"""
Servicio de OAuth para MercadoLibre (multi-usuario).
Maneja el flujo completo: autorización, callback, refresh automático.
Soporta PKCE (Proof Key for Code Exchange) requerido por ML.
Cada usuario tiene su propio token.
"""

import logging
import urllib.request
import urllib.parse
import json
import os
import secrets
import hashlib
import base64
from typing import Optional

from django.utils import timezone

from ..models import MercadoLibreToken

logger = logging.getLogger(__name__)

# URLs de la API de OAuth de MercadoLibre
ML_AUTH_URL = "https://auth.mercadolibre.com.ar/authorization"
ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token"

# URL de callback (debe coincidir con lo configurado en el DevCenter de ML)
CALLBACK_URL = "https://eeestok.duckdns.org/ml-callback/"


def get_client_id() -> Optional[str]:
    return os.environ.get("MERCADOLIBRE_CLIENT_ID")


def get_client_secret() -> Optional[str]:
    return os.environ.get("MERCADOLIBRE_CLIENT_SECRET")


def _generar_code_verifier() -> str:
    """Genera un code_verifier aleatorio según RFC 7636."""
    return secrets.token_urlsafe(64)[:128]


def _generar_code_challenge(verifier: str) -> str:
    """Genera el code_challenge S256 a partir del code_verifier."""
    sha256 = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(sha256).rstrip(b"=").decode("ascii")


def get_auth_url(user_id: str, state: str = "estok_ml_auth") -> tuple[str, str]:
    """
    Genera la URL de autorización para redirigir al usuario a MercadoLibre.
    Retorna (url, code_verifier).
    El code_verifier y user_id se codifican dentro del state para recuperarlos en el callback.
    """
    client_id = get_client_id()
    if not client_id:
        raise ValueError("MERCADOLIBRE_CLIENT_ID no está configurado")

    code_verifier = _generar_code_verifier()
    code_challenge = _generar_code_challenge(code_verifier)

    # Codificar user_id y code_verifier dentro del state
    state_with_data = f"{state}:{user_id}:{code_verifier}"

    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": CALLBACK_URL,
        "state": state_with_data,
        "scope": "offline_access read write",
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "prompt": "consent",
    }
    url = f"{ML_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return url, code_verifier


def exchange_code_for_token(code: str, code_verifier: Optional[str] = None) -> Optional[dict]:
    """
    Intercambia un código de autorización por un token de acceso.
    Si se proporciona code_verifier, se incluye en la solicitud (PKCE).
    """
    client_id = get_client_id()
    client_secret = get_client_secret()
    if not client_id or not client_secret:
        logger.error("MERCADOLIBRE_CLIENT_ID o MERCADOLIBRE_CLIENT_SECRET no configurados")
        return None

    params = {
        "grant_type": "authorization_code",
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": CALLBACK_URL,
    }
    if code_verifier:
        params["code_verifier"] = code_verifier

    data = urllib.parse.urlencode(params).encode("utf-8")

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


def save_token(user, token_data: dict) -> Optional[MercadoLibreToken]:
    """
    Guarda o actualiza el token en la base de datos para un usuario específico.
    Cada usuario tiene un solo token (OneToOneField).
    """
    token, created = MercadoLibreToken.objects.update_or_create(
        usuario=user,
        defaults={
            "access_token": token_data.get("access_token", ""),
            "refresh_token": token_data.get("refresh_token", ""),
            "token_type": token_data.get("token_type", "Bearer"),
            "expires_in": token_data.get("expires_in", 21600),
            "scope": token_data.get("scope", ""),
            "ml_user_id": token_data.get("user_id"),
        }
    )
    logger.info("Token guardado para usuario %s (ml_user_id=%s, created=%s)", user.username, token.ml_user_id, created)
    return token


def refresh_access_token(user) -> Optional[str]:
    """
    Refresca el token de acceso de un usuario usando su refresh_token almacenado.
    Retorna el nuevo access_token o None si falla.
    """
    try:
        token = MercadoLibreToken.objects.get(usuario=user)
    except MercadoLibreToken.DoesNotExist:
        logger.warning("No hay token para el usuario %s", user.username)
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

        logger.info("Token refrescado exitosamente para %s", user.username)
        return token.access_token

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else "sin cuerpo"
        logger.error("Error HTTP al refrescar token: %d %s - %s", e.code, e.reason, error_body)
        if e.code == 400:
            logger.warning("Refresh token inválido para %s, eliminando token", user.username)
            token.delete()
        return None
    except Exception as e:
        logger.error("Error inesperado al refrescar token: %s", e)
        return None


def get_valid_access_token(user) -> Optional[str]:
    """
    Obtiene un access_token válido para el usuario, refrescándolo si es necesario.
    Retorna None si no hay token o no se puede refrescar.
    """
    try:
        token = MercadoLibreToken.objects.get(usuario=user)
    except MercadoLibreToken.DoesNotExist:
        return None

    # Verificar si el token está por expirar (menos de 5 minutos)
    tiempo_vida = (timezone.now() - token.updated_at).total_seconds()
    if tiempo_vida > (token.expires_in - 300):
        logger.info("Token de %s por expirar, refrescando...", user.username)
        return refresh_access_token(user)

    return token.access_token


def has_valid_token(user) -> bool:
    """Verifica si el usuario tiene un token de ML conectado y válido."""
    return get_valid_access_token(user) is not None


def delete_token(user) -> bool:
    """Elimina el token de MercadoLibre del usuario."""
    try:
        token = MercadoLibreToken.objects.get(usuario=user)
        token.delete()
        return True
    except MercadoLibreToken.DoesNotExist:
        return False