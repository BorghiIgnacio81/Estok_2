"""
Prueba completa del flujo OAuth de MercadoLibre con PKCE.
Genera URL de auth, simula el callback con code_verifier.
"""
import os
import sys
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

from inventario.services.mercadolibre_oauth import (
    get_auth_url,
    exchange_code_for_token,
    _generar_code_verifier,
    _generar_code_challenge,
    get_client_id,
    get_client_secret,
    CALLBACK_URL,
)

print("=== CONFIGURACIÓN ===")
print(f"CLIENT_ID: {get_client_id()}")
print(f"CLIENT_SECRET: {'***' if get_client_secret() else 'NO CONFIGURADO'}")
print(f"CALLBACK_URL: {CALLBACK_URL}")

print("\n=== GENERAR URL DE AUTORIZACIÓN ===")
url, verifier = get_auth_url()
print(f"URL: {url}")
print(f"VERIFIER: {verifier}")

# Extraer code_challenge de la URL
import urllib.parse
parsed = urllib.parse.urlparse(url)
params = urllib.parse.parse_qs(parsed.query)
print(f"CODE_CHALLENGE: {params.get('code_challenge', ['N/A'])[0]}")
print(f"CODE_CHALLENGE_METHOD: {params.get('code_challenge_method', ['N/A'])[0]}")

# Verificar que el challenge coincide
challenge = _generar_code_challenge(verifier)
print(f"CHALLENGE (recalculado): {challenge}")
print(f"Coinciden: {challenge == params.get('code_challenge', [''])[0]}")

print("\n=== INSTRUCCIONES ===")
print(f"1. Abrí esta URL en el navegador:")
print(f"   {url}")
print("2. Autorizá la app")
print("3. Vas a ser redirigido a /api/mercadolibre/callback/?code=...&state=...")
print("4. Copiá el valor de 'code' de la URL")
print("5. Ejecutá: python tmp_test_oauth_exchange.py <code>")
