import requests, json, sys

url = 'https://eeestok.duckdns.org/api/objetos/d80cb02d-10e3-43cf-a34f-ffeba9e86125/'
token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzgyODQ5OTMyLCJpYXQiOjE3ODI4NDYzMzIsImp0aSI6IjIzZDhlMjk2YzNkNzRlNmNhMTE0ZjRmMWQyNGM2NGM5IiwidXNlcl9pZCI6ImFlNjFjMzA2LTYzOWQtNDYzNS1iMzRlLWMxN2NiNWIzYzZlNyJ9.OW_89hS_3YSR15rVXDRx_eNG2ZeDQDoIGduvIlbNNXk'

headers = {
    'Content-Type': 'application/json',
    'X-Estok-Id': '5527d82d-0270-4333-9175-c91a6449e35a',
    'Authorization': f'Bearer {token}'
}

payload = {
    "nombre": "Manual Electronica",
    "descripcion": "Aprende solo: Electrónica W.P. Jolly . Editorial Rei",
    "color": "Rojo negro",
    "contenedor": "f4cf9247-cfe5-40a4-a1b8-d690ff4b2a86",
    "estado_conservacion": "bueno",
    "tipo": "libro",
    "ubicacion": "67edf756-bb28-4f44-a49f-3dc7d0d6b200",
    "valor_estimado": "2.00"
}

print('=== REPRODUCIENDO PUT ===')
print(f'URL: {url}')
print(f'Payload: {json.dumps(payload, indent=2)}')
print()

r = requests.put(url, json=payload, headers=headers, timeout=30)
print(f'Status: {r.status_code}')
print(f'Response headers: {dict(r.headers)}')
print()
print('=== RESPUESTA ===')
try:
    print(r.text[:2000])
except:
    print(r.content[:2000])
