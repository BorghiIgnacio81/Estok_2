"""
Reproducir el error 500 al crear objeto con tipo específico.
URL BASE: https://eeestok.duckdns.org (SOLO PRODUCCIÓN)
"""
import requests, json, sys

BASE_URL = "https://eeestok.duckdns.org"
ESTOK_ID = "5527d82d-0270-4333-9175-c91a6449e35a"

session = requests.Session()
session.verify = True

def p(msg):
    print(msg, flush=True)

# Login
r = session.post(f"{BASE_URL}/api/token/", json={
    "username": "ygumy44", "password": "C05m05"
}, headers={"Content-Type": "application/json"})
token = r.json().get("access")
p(f"Login: {r.status_code}")

auth_headers = {
    "Authorization": f"Bearer {token}",
    "X-Estok-Id": ESTOK_ID,
    "Content-Type": "application/json"
}

# Test 1: Crear objeto simple (sin tipo específico)
p("\n" + "=" * 70)
p("TEST 1: Crear objeto simple (tipo='objeto')")
p("=" * 70)
payload1 = {
    "nombre": "Test objeto simple",
    "tipo": "objeto",
    "descripcion": "Test de creacion simple"
}
r1 = session.post(f"{BASE_URL}/api/objetos/", json=payload1, headers=auth_headers)
p(f"Status: {r1.status_code}")
p(f"Response: {r1.text[:500]}")

# Test 2: Crear objeto con tipo 'tecnologia'
p("\n" + "=" * 70)
p("TEST 2: Crear objeto con tipo='tecnologia'")
p("=" * 70)
payload2 = {
    "nombre": "Test Notebook HP exacto",
    "tipo": "tecnologia",
    "descripcion": "Notebook HP con especificaciones",
    "marca": "HP",
    "modelo": "Pavilion",
    "numero_serie": "SN123456",
    "valor_estimado": 500.00
}
r2 = session.post(f"{BASE_URL}/api/objetos/", json=payload2, headers=auth_headers)
p(f"Status: {r2.status_code}")
p(f"Response: {r2.text[:1000]}")

# Test 3: Crear objeto con tipo 'libro'
p("\n" + "=" * 70)
p("TEST 3: Crear objeto con tipo='libro'")
p("=" * 70)
payload3 = {
    "nombre": "Test libro",
    "tipo": "libro",
    "autor": "Test Autor",
    "anio": 2020
}
r3 = session.post(f"{BASE_URL}/api/objetos/", json=payload3, headers=auth_headers)
p(f"Status: {r3.status_code}")
p(f"Response: {r3.text[:500]}")

# Test 4: Crear objeto con tipo 'mueble'
p("\n" + "=" * 70)
p("TEST 4: Crear objeto con tipo='mueble'")
p("=" * 70)
payload4 = {
    "nombre": "Test mueble",
    "tipo": "mueble",
    "material": "Madera"
}
r4 = session.post(f"{BASE_URL}/api/objetos/", json=payload4, headers=auth_headers)
p(f"Status: {r4.status_code}")
p(f"Response: {r4.text[:500]}")

# Test 5: Crear objeto con tipo 'ropa'
p("\n" + "=" * 70)
p("TEST 5: Crear objeto con tipo='ropa'")
p("=" * 70)
payload5 = {
    "nombre": "Test ropa",
    "tipo": "ropa",
    "tamano": "M"
}
r5 = session.post(f"{BASE_URL}/api/objetos/", json=payload5, headers=auth_headers)
p(f"Status: {r5.status_code}")
p(f"Response: {r5.text[:500]}")

p("\n" + "=" * 70)
p("TESTS COMPLETADOS")
p("=" * 70)
