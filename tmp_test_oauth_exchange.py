"""
Intercambia un código de autorización por token.
Uso: python tmp_test_oauth_exchange.py <code> <code_verifier>
"""
import os, sys
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import django
django.setup()

from inventario.services.mercadolibre_oauth import exchange_code_for_token, save_token

if len(sys.argv) < 3:
    print("Uso: python tmp_test_oauth_exchange.py <code> <code_verifier>")
    sys.exit(1)

code = sys.argv[1]
code_verifier = sys.argv[2]

print(f"Intercambiando código: {code[:50]}...")
print(f"Code verifier: {code_verifier[:50]}...")

token_data = exchange_code_for_token(code, code_verifier=code_verifier)
if token_data:
    print("TOKEN OBTENIDO EXITOSAMENTE:")
    print(f"  access_token: {token_data.get('access_token', 'N/A')[:50]}...")
    print(f"  refresh_token: {token_data.get('refresh_token', 'N/A')[:50]}...")
    print(f"  expires_in: {token_data.get('expires_in')}")
    print(f"  user_id: {token_data.get('user_id')}")
    print(f"  scope: {token_data.get('scope')}")
    
    # Guardar en DB
    token = save_token(token_data)
    if token:
        print(f"Token guardado en DB (id={token.id})")
    else:
        print("ERROR: No se pudo guardar el token")
else:
    print("ERROR: No se pudo obtener el token")
