import requests

url = 'https://api.mercadolibre.com/sites/MLA/search?q=iPhone+14+Pro+Max&limit=3'

# Probar con Referer de navegador real
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
    'Referer': 'https://www.mercadolibre.com.ar/',
    'Origin': 'https://www.mercadolibre.com.ar',
}
r = requests.get(url, headers=headers, timeout=10)
print(f'Status: {r.status_code}')
if r.status_code == 200:
    data = r.json()
    results = data.get('results', [])
    print(f'Resultados: {len(results)}')
    for item in results[:3]:
        print(f'  - {item.get("title","?")[:60]} | ${item.get("price",0)}')
else:
    print(f'Error: {r.text[:300]}')
