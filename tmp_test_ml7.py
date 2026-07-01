import requests
import re
import json

# Scraping de la web pública de MercadoLibre (no la API)
url = "https://listado.mercadolibre.com.ar/iphone-14"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
}
r = requests.get(url, headers=headers, timeout=15)
print("STATUS:", r.status_code)
print("LENGTH:", len(r.text))

if r.ok:
    # Buscar datos en formato JSON dentro de scripts
    # MercadoLibre suele tener los datos en window.__INITIAL_STATE__ o similar
    matches = re.findall(r'window\.__PRELOADED_STATE__\s*=\s*({.*?});', r.text, re.DOTALL)
    if matches:
        print("\n__PRELOADED_STATE__ encontrado!")
        data = json.loads(matches[0])
        print("KEYS:", list(data.keys())[:10])
    else:
        print("\nNo se encontro __PRELOADED_STATE__")
    
    # Buscar cualquier JSON grande en scripts
    scripts = re.findall(r'<script[^>]*>([^<]+)</script>', r.text)
    print(f"\nScripts encontrados: {len(scripts)}")
    for i, s in enumerate(scripts):
        if 'results' in s.lower() or 'items' in s.lower() or 'precio' in s.lower():
            print(f"Script {i}: {s[:200]}...")
    
    # Buscar precios en el HTML
    prices = re.findall(r'\$\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]+)?)', r.text)
    print(f"\nPrecios encontrados (primeros 10): {prices[:10]}")
    
    # Buscar titles
    titles = re.findall(r'<h2[^>]*class="[^"]*ui-search-item__title[^"]*"[^>]*>(.*?)</h2>', r.text, re.DOTALL)
    print(f"\nTítulos encontrados: {len(titles)}")
    for t in titles[:3]:
        print(" -", t.strip())
    
    # Mostrar extracto
    print("\n--- EXTRACTO HTML (chars 5000-7000) ---")
    print(r.text[5000:7000])
else:
    print("ERROR:", r.text[:500])
