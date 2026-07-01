import requests
from bs4 import BeautifulSoup
import json
import re

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
    # Buscar datos en JSON-LD o en scripts
    soup = BeautifulSoup(r.text, 'html.parser')
    
    # Buscar datos estructurados
    scripts = soup.find_all('script', type='application/ld+json')
    print(f"\nJSON-LD scripts encontrados: {len(scripts)}")
    
    # Buscar precios en el HTML
    prices = re.findall(r'\$[\s]*([0-9.,]+)', r.text)
    print(f"\nPrecios encontrados (primeros 10): {prices[:10]}")
    
    # Buscar items en el HTML
    titles = re.findall(r'<h2[^>]*class="[^"]*ui-search-item__title[^"]*"[^>]*>(.*?)</h2>', r.text, re.DOTALL)
    print(f"\nTítulos encontrados: {len(titles)}")
    for t in titles[:3]:
        print(" -", t.strip())
    
    # Mostrar un extracto del HTML para entender la estructura
    print("\n--- EXTRACTO HTML (primeros 2000 chars) ---")
    print(r.text[:2000])
else:
    print("ERROR:", r.text[:500])
