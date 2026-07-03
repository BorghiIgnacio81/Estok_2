import requests, re, json

url = 'https://listado.mercadolibre.com.ar/iphone-14-pro-max'
r = requests.get(url, headers={
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}, timeout=15)
print(f'Status: {r.status_code}')
print(f'Length: {len(r.text)}')

# Buscar datos pre-renderizados en el HTML
# ML suele tener un script con window.__INITIAL_STATE__ o similar
matches = re.findall(r'<script[^>]*>(window\.__PRELOADED_STATE__|window\.__INITIAL_STATE__|window\.__DATA__)\s*=\s*({.*?});</script>', r.text, re.DOTALL)
print(f'Preloaded state matches: {len(matches)}')

# Buscar cualquier JSON grande
matches2 = re.findall(r'<script[^>]*id="[^"]*"[^>]*type="application/json"[^>]*>(.*?)</script>', r.text, re.DOTALL)
print(f'JSON scripts: {len(matches2)}')
for m in matches2[:2]:
    try:
        data = json.loads(m)
        print(f'  Keys: {list(data.keys())[:10]}')
    except:
        print(f'  (not json, len={len(m)})')

# Buscar el JSON-LD
matches3 = re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', r.text, re.DOTALL)
print(f'JSON-LD: {len(matches3)}')
for m in matches3[:2]:
    try:
        data = json.loads(m)
        s = json.dumps(data)
        print(f'  Data: {s[:300]}')
    except:
        print(f'  (not json, len={len(m)})')

# Ver si hay algun patron de item
sample = r.text[5000:8000]
print(f'Sample HTML (5000-8000):')
print(sample[:500])
