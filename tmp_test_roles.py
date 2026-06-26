import requests
import json

# Config
BASE_URL = "http://localhost:8000"
ESTOC_ID = "5527d82d-0270-4333-9175-c91a6449e35a"

# 1. Obtener token de admin
print("=== 1. OBTENER TOKEN ===")
r = requests.post(f"{BASE_URL}/api/token/", json={
    "username": "ignacio_borghi",
    "password": "admin123"
})
print(f"Status: {r.status_code}")
if r.status_code == 200:
    token = r.json()["access"]
    print(f"Token obtenido: {token[:50]}...")
else:
    print(f"Error: {r.text}")
    exit(1)

# 2. Probar GET /api/roles/ SIN X-Estok-Id (debería dar 403)
print("\n=== 2. GET /api/roles/ SIN X-Estok-Id ===")
r = requests.get(f"{BASE_URL}/api/roles/", headers={
    "Authorization": f"Bearer {token}"
})
print(f"Status: {r.status_code}")
print(f"Body: {r.text[:200]}")

# 3. Probar GET /api/roles/ CON X-Estok-Id (debería dar 200 con roles)
print("\n=== 3. GET /api/roles/ CON X-Estok-Id ===")
r = requests.get(f"{BASE_URL}/api/roles/", headers={
    "Authorization": f"Bearer {token}",
    "X-Estok-Id": ESTOC_ID
})
print(f"Status: {r.status_code}")
if r.status_code == 200:
    roles = r.json()
    print(f"Cantidad de roles: {len(roles)}")
    for rol in roles:
        print(f"  ID: {rol['id']} | Name: {rol['name']} | can_read: {rol.get('can_read')} | can_write: {rol.get('can_write')} | can_edit: {rol.get('can_edit')} | can_delete: {rol.get('can_delete')}")
else:
    print(f"Body: {r.text[:500]}")
