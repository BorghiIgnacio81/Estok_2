import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from django.urls import get_resolver
r = get_resolver()
for p in r.reverse_dict.keys():
    if 'mercadolibre' in str(p):
        print(p)
