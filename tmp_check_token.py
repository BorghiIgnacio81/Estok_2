import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from inventario.models import MercadoLibreToken
t = MercadoLibreToken.objects.first()
if t:
    print(f"Token: {t.access_token[:30]}...")
    print(f"Refresh: {t.refresh_token[:30] if t.refresh_token else 'N/A'}...")
    print(f"Expira: {t.token_expiry}")
    print(f"Usuario: {t.usuario_id}")
else:
    print("No hay token")
