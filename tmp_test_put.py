import requests, json

url = 'https://eeestok.duckdns.org/api/objetos/d80cb02d-10e3-43cf-a34f-ffeba9e86125/'
headers = {
    'Content-Type': 'application/json',
    'X-Estok-Id': '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzUyMjc3NjUyLCJpYXQiOjE3NTE4NDU2NTIsImp0aSI6ImI3YjY3YjA3YjA3YjQwYjE4YjA3YjA3YjA3YjA3YjA3IiwidXNlcl9pZCI6MX0.placeholder'
}

# Primero GET para ver el estado actual
print('=== GET actual ===')
r = requests.get(url, headers=headers, timeout=10)
print(f'Status: {r.status_code}')
if r.status_code == 200:
    data = r.json()
    print(f'Nombre: {data.get("nombre")}')
    print(f'Tipo actual: {data.get("tipo")}')
    print(f'Datos específicos: {json.dumps(data.get("datos_especificos", {}), indent=2)}')
else:
    print(f'Respuesta (primeros 500 chars): {r.text[:500]}')
