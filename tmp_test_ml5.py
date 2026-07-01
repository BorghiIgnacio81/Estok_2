import requests

# Probar el endpoint de categorias (público, sin auth)
r = requests.get("https://api.mercadolibre.com/sites/MLA/categories", timeout=10)
print("CATEGORIES:", r.status_code)
if r.ok:
    print("OK - categorias publicas funcionan")
else:
    print("ERROR:", r.text[:200])

# Probar search con un approach diferente - usando el frontend API
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Origin": "https://www.mercadolibre.com.ar",
    "Referer": "https://www.mercadolibre.com.ar/",
}
r2 = requests.get("https://api.mercadolibre.com/sites/MLA/search", 
    params={"q":"iPhone 14","limit":3},
    headers=headers,
    timeout=10)
print("\nSEARCH with browser headers:", r2.status_code)
if r2.ok:
    data = r2.json()
    print("RESULTS:", len(data.get("results",[])))
    for item in data.get("results",[])[:2]:
        print(" -", item.get("title"), "$", item.get("price"))
else:
    print("ERROR:", r2.text[:300])

# Probar con el access_token que ya tenemos (APP_USR-...)
token = "APP_USR-5829119544436508"
r3 = requests.get("https://api.mercadolibre.com/sites/MLA/search",
    params={"q":"iPhone 14","limit":3},
    headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    timeout=10)
print("\nSEARCH with APP_USR token:", r3.status_code)
if r3.ok:
    data = r3.json()
    print("RESULTS:", len(data.get("results",[])))
    for item in data.get("results",[])[:2]:
        print(" -", item.get("title"), "$", item.get("price"))
else:
    print("ERROR:", r3.text[:300])
