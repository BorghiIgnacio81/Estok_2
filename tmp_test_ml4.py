import requests

# Probar sin token pero con User-Agent de navegador
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "application/json",
}
r = requests.get("https://api.mercadolibre.com/sites/MLA/search", 
    params={"q":"iPhone 14","limit":3},
    headers=headers,
    timeout=10)
print("STATUS:", r.status_code)
if r.ok:
    data = r.json()
    print("RESULTS:", len(data.get("results",[])))
    for item in data.get("results",[])[:2]:
        print(" -", item.get("title"), "$", item.get("price"))
else:
    print("ERROR:", r.text[:300])
