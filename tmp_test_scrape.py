import requests, re, json

url = 'https://listado.mercadolibre.com.ar/iphone-14-pro-max'
r = requests.get(url, headers={
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}, timeout=15)
print(f'Status: {r.status_code}')
if r.status_code == 200:
    # Buscar items en HTML
    items = re.findall(r'<h2[^>]*class="[^"]*ui-search-item__title[^"]*"[^>]*>(.*?)</h2>', r.text, re.DOTALL)
    print(f'Items por titulo: {len(items)}')
    for t in items[:3]:
        print(f'  - {t.strip()[:80]}')
    
    # Buscar precios
    prices = re.findall(r'<span[^>]*class="[^"]*andes-money-amount__fraction[^"]*"[^>]*>(.*?)</span>', r.text, re.DOTALL)
    print(f'Precios encontrados: {len(prices)}')
    for p in prices[:5]:
        print(f'  - {p.strip()}')
    
    # Buscar links
    links = re.findall(r'<a[^>]*class="[^"]*ui-search-link[^"]*"[^>]*href="([^"]*)"', r.text)
    print(f'Links encontrados: {len(links)}')
    for l in links[:3]:
        print(f'  - {l[:80]}')
else:
    print(r.text[:500])
