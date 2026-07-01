import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from inventario.models import MercadoLibreToken
t = MercadoLibreToken.objects.first()
if t:
    print(f"access_token={t.access_token[:50]}")
    print(f"refresh_token={t.refresh_token[:20] if t.refresh_token else 'VACIO'}")
    print(f"scope={t.scope}")
    print(f"user_id={t.user_id}")
else:
    print("NO HAY TOKEN")
