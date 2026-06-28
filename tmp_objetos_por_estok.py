"""
Obtener todos los objetos de la BD (sin filtro de estok) para ver su distribución.
URL BASE: https://eeestok.duckdns.org (SOLO PRODUCCIÓN)
"""
import requests, json

BASE_URL = "https://eeestok.duckdns.org"
session = requests.Session()
session.verify = True

# Login
r = session.post(f"{BASE_URL}/api/token/", json={
    "username": "ygumy44", "password": "C05m05"
}, headers={"Content-Type": "application/json"})
token = r.json().get("access")
print(f"Login: {r.status_code}")

# Obtener todos los estoks disponibles
r_me = session.get(f"{BASE_URL}/api/usuarios/me/", headers={"Authorization": f"Bearer {token}"})
me = r_me.json()
print(f"\nEstoks del usuario:")
for e in me.get("estoks", []):
    print(f"  {e['nombre']} (id={e['id']}, role={e['role']})")

# Para cada estok, obtener objetos
print("\n" + "=" * 70)
print("OBJETOS POR ESTOK (usando API con X-Estok-Id)")
print("=" * 70)
for e in me.get("estoks", []):
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Estok-Id": e["id"],
        "Content-Type": "application/json"
    }
    r_obj = session.get(f"{BASE_URL}/api/objetos/", headers=headers)
    data = r_obj.json()
    count = data.get("count", 0) if isinstance(data, dict) else len(data)
    print(f"\nEstok '{e['nombre']}': {count} objetos")
    if count > 0:
        results = data.get("results", data) if isinstance(data, dict) else data
        for o in results:
            print(f"  - {o.get('nombre')} (id={o.get('id')})")

# También obtener TODOS los objetos sin filtro de estok (el bug actual)
print("\n" + "=" * 70)
print("TODOS los objetos (sin filtro de estok - como hace estadisticas actualmente)")
print("=" * 70)
# Esto requiere un token de admin o similar, pero podemos verlo desde el endpoint
# que no filtra: el mismo estadisticas
r_est = session.get(f"{BASE_URL}/api/objetos/estadisticas/", headers={
    "Authorization": f"Bearer {token}",
    "X-Estok-Id": me["estoks"][0]["id"],
})
est = r_est.json()
print(f"Estadisticas total_objetos: {est.get('total_objetos', 'N/A')}")
print(f"Ultimos objetos:")
for o in est.get("ultimos_objetos", []):
    print(f"  - {o.get('nombre')} (id={o.get('id')})")
