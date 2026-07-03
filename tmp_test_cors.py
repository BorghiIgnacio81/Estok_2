import requests

# Probar si la API de ML permite CORS
url = 'https://api.mercadolibre.com/sites/MLA/search?q=test&limit=1'
r = requests.options(url, headers={
    'Origin': 'https://eeestok.duckdns.org',
    'Access-Control-Request-Method': 'GET',
})
print(f'OPTIONS status: {r.status_code}')
print(f'Headers: {dict(r.headers)}')

# Probar con un User-Agent de navegador
r2 = requests.get(url, headers={
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Origin': 'https://eeestok.duckdns.org',
})
print(f'GET status: {r2.status_code}')
print(f'Response: {r2.text[:200]}')
