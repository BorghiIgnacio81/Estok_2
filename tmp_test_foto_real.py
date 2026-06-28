"""
Prueba REAL paso a paso del flujo de creación de objeto + subida de foto.
URL BASE: https://eeestok.duckdns.org (SOLO PRODUCCIÓN)
"""
import requests, json, sys, os, base64

BASE_URL = "https://eeestok.duckdns.org"
ESTOK_ID = "5527d82d-0270-4333-9175-c91a6449e35a"

session = requests.Session()
session.verify = True

def p(msg):
    print(msg, flush=True)

def p_json(data):
    print(json.dumps(data, indent=2, ensure_ascii=False)[:1000], flush=True)

# ============================================================
# PASO 0: LOGIN (JWT - exactamente como el frontend)
# ============================================================
p("=" * 70)
p("PASO 0: LOGIN con JWT (POST /api/token/)")
p("=" * 70)

r = session.post(f"{BASE_URL}/api/token/", json={
    "username": "ygumy44", "password": "C05m05"
}, headers={"Content-Type": "application/json"})
p(f"Status: {r.status_code}")
token_data = r.json()
access_token = token_data.get("access")
refresh_token = token_data.get("refresh")
p(f"Access token obtenido: {access_token[:50] if access_token else 'NO'}...")
p(f"Refresh token obtenido: {refresh_token[:50] if refresh_token else 'NO'}...")

if not access_token:
    p("ERROR: No se pudo obtener token JWT. Abortando.")
    sys.exit(1)

# Headers para requests JSON (con X-Estok-Id)
auth_headers_json = {
    "Authorization": f"Bearer {access_token}",
    "X-Estok-Id": ESTOK_ID,
    "Content-Type": "application/json"
}

# Headers para subida de foto (SIN X-Estok-Id - como el frontend actual)
auth_headers_foto_sin_estok = {
    "Authorization": f"Bearer {access_token}",
    # NOTA: NO incluye X-Estok-Id - así está en el frontend actual
}

# Headers para subida de foto (CON X-Estok-Id - como debería ser)
auth_headers_foto_con_estok = {
    "Authorization": f"Bearer {access_token}",
    "X-Estok-Id": ESTOK_ID,
}

# ============================================================
# PASO 1: Crear objeto
# ============================================================
p("\n" + "=" * 70)
p("PASO 1: POST /api/objetos/ (crear objeto)")
p("=" * 70)

payload = {
    "nombre": "Test Foto Real " + str(hash("testfoto") % 10000),
    "descripcion": "Objeto creado para probar subida de foto",
    "tipo": "objeto",
    "estado_conservacion": "bueno"
}

r1 = session.post(f"{BASE_URL}/api/objetos/", json=payload, headers=auth_headers_json)
p(f"Status: {r1.status_code}")
p(f"Response: {r1.text[:500]}")

if r1.status_code not in (200, 201):
    p("ERROR: No se pudo crear el objeto. Abortando.")
    sys.exit(1)

objeto = r1.json()
objeto_id = objeto.get("id")
p(f"Objeto creado con id={objeto_id}")

# ============================================================
# PASO 2: Subir foto SIN X-Estok-Id (como el frontend actual)
# ============================================================
p("\n" + "=" * 70)
p("PASO 2: POST /api/objetos/{id}/subir_foto/ (SIN X-Estok-Id - como el frontend)")
p("=" * 70)

# Crear una imagen de prueba (PNG 1x1 pixel rojo)
img_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
img_bytes = base64.b64decode(img_base64)

tmp_img_path = "c:\\Users\\USER\\Desktop\\Estok_2\\tmp_test_foto.png"
with open(tmp_img_path, "wb") as f:
    f.write(img_bytes)
p(f"Imagen de prueba creada: {len(img_bytes)} bytes")

# Subir como FormData SIN X-Estok-Id
with open(tmp_img_path, "rb") as f:
    form_data = {
        "imagen": ("foto.jpg", f, "image/jpeg"),
        "es_principal": "true",
        "descripcion": "Foto principal de prueba"
    }
    r2 = session.post(
        f"{BASE_URL}/api/objetos/{objeto_id}/subir_foto/",
        files=form_data,
        headers=auth_headers_foto_sin_estok  # SIN X-Estok-Id
    )

p(f"Status: {r2.status_code}")
p(f"Response: {r2.text[:1000]}")

# ============================================================
# PASO 2b: Subir foto CON X-Estok-Id (como debería ser)
# ============================================================
p("\n" + "=" * 70)
p("PASO 2b: POST /api/objetos/{id}/subir_foto/ (CON X-Estok-Id)")
p("=" * 70)

with open(tmp_img_path, "rb") as f:
    form_data = {
        "imagen": ("foto.jpg", f, "image/jpeg"),
        "es_principal": "true",
        "descripcion": "Foto principal de prueba"
    }
    r2b = session.post(
        f"{BASE_URL}/api/objetos/{objeto_id}/subir_foto/",
        files=form_data,
        headers=auth_headers_foto_con_estok  # CON X-Estok-Id
    )

p(f"Status: {r2b.status_code}")
p(f"Response: {r2b.text[:1000]}")

# ============================================================
# PASO 3: Verificar que la foto se guardó
# ============================================================
p("\n" + "=" * 70)
p("PASO 3: GET /api/objetos/{id}/ (verificar foto)")
p("=" * 70)

r3 = session.get(
    f"{BASE_URL}/api/objetos/{objeto_id}/",
    headers=auth_headers_json
)
p(f"Status: {r3.status_code}")
if r3.status_code == 200:
    data = r3.json()
    fotos = data.get("fotos", [])
    p(f"Cantidad de fotos: {len(fotos)}")
    if fotos:
        p(f"Foto URL: {fotos[0].get('imagen', 'NO URL')}")
    else:
        p("NO HAY FOTOS - el objeto se creó pero la foto no se vinculó")
else:
    p(f"Response: {r3.text[:500]}")

# ============================================================
# LIMPIEZA
# ============================================================
p("\n" + "=" * 70)
p("LIMPIEZA: Eliminar objeto de prueba")
p("=" * 70)

r_del = session.delete(
    f"{BASE_URL}/api/objetos/{objeto_id}/",
    headers=auth_headers_json
)
p(f"DELETE Status: {r_del.status_code}")
p(f"DELETE Response: {r_del.text[:300]}")

try:
    os.remove(tmp_img_path)
except:
    pass

p("\n" + "=" * 70)
p("PRUEBA COMPLETADA")
p("=" * 70)
