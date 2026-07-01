import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from inventario.services.price_search_service import PriceSearchService

s = PriceSearchService()
resultado = s.buscar_precios("iPhone 14 Pro", limit=3)
print(f"Resultado: {resultado}")
