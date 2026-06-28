"""
Diagnóstico: Dashboard vs Lista de objetos - inconsistencia
URL BASE: https://eeestok.duckdns.org (SOLO PRODUCCIÓN)
"""
import requests
import json

BASE_URL = "https://eeestok.duckdns.org"
USERNAME = "ygumy44"
PASSWORD = "C05m05"

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
p(f"Token (access): {token[:50]}...")

# 2. Obtener Estok activo
r2 = session.get(f"{BASE_URL}/api/estoks/", headers={"Authorization": f"Bearer {token}"})
estoks = r2.json()
estok_id = None
estok_nombre = None
if isinstance(estoks, list):
    for e in estoks:
        p(f"  Estok: {e['nombre']} (id={e['id']})")
        if "Casa Borghi" in e.get("nombre", ""):
            estok_id = e["id"]
            estok_nombre = e["nombre"]
    if not estok_id and len(estoks) > 0:
        estok_id = estoks[0]["id"]
        estok_nombre = estoks[0]["nombre"]

p(f"\nUsando Estok: {estok_nombre} (id={estok_id})")

auth_headers = {
    "Authorization": f"Bearer {token}",
    "X-Estok-Id": str(estok_id),
    "Content-Type": "application/json"
}

# 3. GET /api/objetos/estadisticas/
p("\n" + "=" * 70)
p("PASO 2: GET /api/objetos/estadisticas/")
p("=" * 70)
r_est = session.get(f"{BASE_URL}/api/objetos/estadisticas/", headers=auth_headers)
p(f"Status: {r_est.status_code}")
if r_est.status_code == 200:
    pj(r_est.json())
else:
    p(f"ERROR: {r_est.text[:500]}")

# 4. GET /api/objetos/
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
            p("Primeros 3:")
            for o in data[:3]:
                p(f"  - {o.get('nombre')} (id={o.get('id')})")
        else:
            p("Lista VACÍA - no hay objetos")
    elif isinstance(data, dict):
        p(f"Respuesta paginada: count={data.get('count', 'N/A')}")
        results = data.get('results', [])
        p(f"Results: {len(results)} objetos")
        if len(results) > 0:
            for o in results[:3]:
                p(f"  - {o.get('nombre')} (id={o.get('id')})")
        else:
            p("Results VACÍO")
else:
    p(f"ERROR: {r_est.text[:500]}")

p("\n" + "=" * 70)
p("DIAGNÓSTICO COMPLETO")
p("=" * 70)
