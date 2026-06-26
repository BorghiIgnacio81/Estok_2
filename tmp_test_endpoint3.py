import urllib.request
import json

# 1. Obtener token
login_url = "http://localhost:8001/api/usuarios/login/"
login_data = json.dumps({"username": "ignacio", "password": "ignacio123"}).encode()
login_req = urllib.request.Request(login_url, data=login_data, method="POST")
login_req.add_header("Content-Type", "application/json")

try:
    with urllib.request.urlopen(login_req, timeout=10) as resp:
        login_body = json.loads(resp.read().decode())
        token = login_body.get("access", "")
        print("Token obtained:", token[:30] + "...")
except Exception as e:
    print("Login ERROR:", type(e).__name__, str(e)[:300])
    token = ""

if token:
    # 2. Test gemini heartbeat
    url = "http://localhost:8001/api/objetos/test_ia_stress/?motor=gemini"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("X-Estok-Id", "test")

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print("Status:", resp.status)
            body = json.loads(resp.read().decode())
            print("Body:", json.dumps(body, indent=2))
    except urllib.error.HTTPError as e:
        print("HTTP Error:", e.code)
        print("Body:", e.read().decode()[:500])
    except Exception as e:
        print("ERROR:", type(e).__name__, str(e)[:300])
