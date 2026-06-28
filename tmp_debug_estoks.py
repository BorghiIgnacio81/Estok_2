"""
Debug: Ver qué devuelve GET /api/estoks/ con auth Bearer
"""
import requests, json

BASE_URL = "https://eeestok.duckdns.org"
session = requests.Session()
session.verify = True

# Login
r = session.post(f"{BASE_URL}/api/token/", json={
    "username": "ygumy44", "password": "C05m05"
}, headers={"Content-Type": "application/json"})
print(f"Login: {r.status_code}")
token = r.json().get("access")
print(f"Token: {token[:50]}...")

# GET /api/estoks/
r2 = session.get(f"{BASE_URL}/api/estoks/", headers={"Authorization": f"Bearer {token}"})
print(f"\nGET /api/estoks/ -> Status: {r2.status_code}")
print(f"Headers: {dict(r2.headers)}")
print(f"Body: {r2.text[:2000]}")

# GET /api/usuarios/me/
r3 = session.get(f"{BASE_URL}/api/usuarios/me/", headers={"Authorization": f"Bearer {token}"})
print(f"\nGET /api/usuarios/me/ -> Status: {r3.status_code}")
print(f"Body: {r3.text[:2000]}")
