import urllib.request
import json

url = "http://localhost:8001/api/objetos/test_ia_stress/?motor=gemini"
req = urllib.request.Request(url)
req.add_header("Authorization", "Bearer test")
req.add_header("X-Estok-Id", "test")

try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        print("Status:", resp.status)
        print("Body:", resp.read().decode())
except Exception as e:
    print("ERROR:", type(e).__name__, str(e)[:300])
