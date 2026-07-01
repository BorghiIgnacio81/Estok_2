import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from django.urls import get_resolver
r = get_resolver()
# Listar todas las rutas que contengan "mercadolibre"
for pattern in r.url_patterns:
    p = str(pattern.pattern)
    if 'mercadolibre' in p:
        print(f"  {p}")
print("---")
# También listar names
for name, pattern in r.reverse_dict.items():
    if 'mercadolibre' in str(name):
        print(f"  name={name}")
