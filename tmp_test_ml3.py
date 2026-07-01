import requests, os

# Probar con el token que obtuvimos via Client Credentials
token = None
try:
    resp = requests.post("https://api.mercadolibre.com/oauth/token", data={
        "grant_type": "client_credentials",
        "client_id": os.environ.get("MERCADOLIBRE_CLIENT_ID", "5829119544436508"),
        "client_secret": os.environ.get("MERCADOLIBRE_CLIENT_SECRET", ""),
    }, headers={"Accept":"application/json","Content-Type":"application/x-www-form-urlencoded"}, timeout=15)
    print("TOKEN RESP:", resp.status_code)
    if resp.ok:
        data = resp.json()
        token = data.get("access_token","")
        print("TOKEN OK:", token[:20]+"...")
        print("SCOPE:", data.get("scope",""))
    else:
        print("TOKEN ERROR:", resp.text[:300])
except Exception as e:
    print("TOKEN EXCEPTION:", e)

if token:
    # Probar busqueda con token
    r = requests.get("https://api.mercadolibre.com/sites/MLA/search", 
        params={"q":"iPhone 14","limit":3},
        headers={"Authorization": f"Bearer {token}"},
        timeout=10)
    print("\nSEARCH WITH TOKEN:", r.status_code)
    if r.ok:
        data = r.json()
        print("RESULTS:", len(data.get("results",[])))
        for item in data.get("results",[])[:2]:
            print(" -", item.get("title"), "$", item.get("price"))
    else:
        print("ERROR:", r.text[:300])
