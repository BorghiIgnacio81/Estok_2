import os, sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()

from inventario.services.price_search_service import PriceSearchService
s = PriceSearchService()
r = s.buscar_precios("iPhone 14", limit=3)
print(r)
