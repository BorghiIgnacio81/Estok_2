import urllib.request
import json

# Test sin auth para ver si el endpoint existe (usa IsAuthenticatedOrReadOnly)
url = "http://localhost:8001/api/objetos/test_ia_stress/?motor=gemini"
req = urllib.request.Request(url)

try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        print("Status:", resp.status)
        print("Body:", resp.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP Error:", e.code)
    print("Body:", e.read().decode()[:500])
except Exception as e:
    print("ERROR:", type(e).__name__, str(e)[:300])
