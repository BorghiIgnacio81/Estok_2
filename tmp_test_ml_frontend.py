import requests, json

# Simular exactamente lo que hace un fetch() del browser:
# - Sin User-Agent personalizado (requests pone el suyo por defecto)
# - Sin headers especiales
# - Desde la IP local del usuario
r = requests.get('https://api.mercadolibre.com/sites/MLA/search?q=iphone+14&limit=3', timeout=15)
print('STATUS:', r.status_code)
print()
if r.status_code == 200:
    data = r.json()
    print('Total results:', data.get('paging', {}).get('total', 'N/A'))
    results = data.get('results', [])[:2]
    for i, item in enumerate(results):
        title = item.get('title', '')
        price = item.get('price', 0)
        link = item.get('permalink', '')
        print(f'  {i+1}. {title} - ${price} - {link}')
else:
    print('ERROR:', r.text[:500])
