import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from inventario.models import MercadoLibreToken
n = MercadoLibreToken.objects.count()
MercadoLibreToken.objects.all().delete()
print(f"Token eliminado. Habia {n} token(s)")
