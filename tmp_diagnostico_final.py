"""
DIAGNÓSTICO REAL: Dashboard vs Lista de objetos
URL BASE: https://eeestok.duckdns.org (SOLO PRODUCCIÓN)
"""
import requests
import json

BASE_URL = "https://eeestok.duckdns.org"
USERNAME = "ygumy44"
PASSWORD = "C05m05"
ESTOK_ID = "5527d82d-0270-4333-9175-c91a6449e35a"  # Casa Borghi Federacion

session = requests.Session()
session.verify = True

def p(msg):
    print(msg, flush=True)

def pj(data):
    print(json.dumps(data, indent=2, ensure_ascii=False), flush=True)

# 1. LOGIN
p("=" * 70)
p("PASO 1: LOGIN")
p("=" * 70)
r = session.post(f"{BASE_URL}/api/token/", json={
    "username": USERNAME, "password": PASSWORD
}, headers={"Content-Type": "application/json"})
p(f"Status: {r.status_code}")
if r.status_code != 200:
    p(f"ERROR: {r.text[:500]}")
    exit(1)

token = r.json().get("access")
p(f"Token OK: {token[:50]}...")

auth_headers = {
    "Authorization": f"Bearer {token}",
    "X-Estok-Id": ESTOK_ID,
    "Content-Type": "application/json"
}

# 2. GET /api/objetos/estadisticas/
p("\n" + "=" * 70)
p("PASO 2: GET /api/objetos/estadisticas/")
p("=" * 70)
r_est = session.get(f"{BASE_URL}/api/objetos/estadisticas/", headers=auth_headers)
p(f"Status: {r_est.status_code}")
if r_est.status_code == 200:
    pj(r_est.json())
else:
    p(f"ERROR: {r_est.text[:500]}")

# 3. GET /api/objetos/
p("\n" + "=" * 70)
p("PASO 3: GET /api/objetos/")
p("=" * 70)
r_obj = session.get(f"{BASE_URL}/api/objetos/", headers=auth_headers)
p(f"Status: {r_obj.status_code}")
if r_obj.status_code == 200:
    data = r_obj.json()
    if isinstance(data, list):
        p(f"Cantidad de objetos: {len(data)}")
        if len(data) > 0:
            for o in data:
                p(f"  - {o.get('nombre')} (id={o.get('id')})")
        else:
            p("Lista VACÍA - no hay objetos")
    elif isinstance(data, dict):
        p(f"Respuesta paginada: count={data.get('count', 'N/A')}")
        results = data.get('results', [])
        p(f"Results: {len(results)} objetos")
        if len(results) > 0:
            for o in results:
                p(f"  - {o.get('nombre')} (id={o.get('id')})")
        else:
            p("Results VACÍO")
else:
    p(f"ERROR: {r_obj.text[:500]}")

p("\n" + "=" * 70)
p("DIAGNÓSTICO COMPLETO")
p("=" * 70)
