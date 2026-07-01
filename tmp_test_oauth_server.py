"""
Prueba OAuth desde el servidor.
Genera URL de auth con PKCE y la imprime.
"""
import os, sys
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import django
django.setup()

from inventario.services.mercadolibre_oauth import get_auth_url

url, cv = get_auth_url()
print("URL:", url)
print("CV:", cv)
