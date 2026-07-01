import requests
r = requests.get("https://api.mercadolibre.com/sites/MLA/search", params={"q":"iPhone 14","limit":3}, timeout=10)
print("STATUS:", r.status_code)
if r.ok:
    data = r.json()
    print("RESULTS:", len(data.get("results",[])))
    for item in data.get("results",[])[:2]:
        print(" -", item.get("title"), "$", item.get("price"))
else:
    print("ERROR:", r.text[:300])
