"""
Prueba directa de la API pública de MercadoLibre.
Probando con headers de navegador para evitar 403.
"""
import requests
import json

# Headers de navegador real para evitar bloqueos
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
}

url = "https://api.mercadolibre.com/sites/MLA/search"

# ============================================================
# PRUEBA 1: Con headers de navegador
# ============================================================
print("=" * 60)
print("PRUEBA 1: Con User-Agent de navegador")
print("=" * 60)
params = {"q": "Manual Electronica", "limit": 5, "sort": "price_asc"}
try:
    resp = requests.get(url, params=params, headers=HEADERS, timeout=15)
    print(f"Status: {resp.status_code}")
    data = resp.json()
    total = data.get('paging', {}).get('total', 'N/A')
    print(f"Total resultados: {total}")
    for item in data.get('results', [])[:5]:
        print(f"  - {item.get('title')}: ${item.get('price')} {item.get('currency_id')}")
        print(f"    Link: {item.get('permalink')}")
    if not data.get('results'):
        print("SIN RESULTADOS. Response:")
        print(json.dumps(data, indent=2, ensure_ascii=False)[:2000])
except Exception as e:
    print(f"ERROR: {e}")

# ============================================================
# PRUEBA 2: iPhone 14 con headers
# ============================================================
print("\n" + "=" * 60)
print("PRUEBA 2: 'iPhone 14' con headers")
print("=" * 60)
params2 = {"q": "iPhone 14", "limit": 5}
try:
    resp2 = requests.get(url, params=params2, headers=HEADERS, timeout=15)
    print(f"Status: {resp2.status_code}")
    data2 = resp2.json()
    total2 = data2.get('paging', {}).get('total', 'N/A')
    print(f"Total resultados: {total2}")
    for item in data2.get('results', [])[:5]:
        print(f"  - {item.get('title')}: ${item.get('price')} {item.get('currency_id')}")
except Exception as e:
    print(f"ERROR: {e}")

# ============================================================
# PRUEBA 3: Sin sort (por si sort=price_asc causa problemas)
# ============================================================
print("\n" + "=" * 60)
print("PRUEBA 3: 'Manual Electronica' SIN sort")
print("=" * 60)
params3 = {"q": "Manual Electronica", "limit": 5}
try:
    resp3 = requests.get(url, params=params3, headers=HEADERS, timeout=15)
    print(f"Status: {resp3.status_code}")
    data3 = resp3.json()
    total3 = data3.get('paging', {}).get('total', 'N/A')
    print(f"Total resultados: {total3}")
    for item in data3.get('results', [])[:5]:
        print(f"  - {item.get('title')}: ${item.get('price')} {item.get('currency_id')}")
except Exception as e:
    print(f"ERROR: {e}")

print("\n✅ Pruebas completadas")
