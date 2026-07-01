import urllib.request
req = urllib.request.Request(
    'https://api.mercadolibre.com/sites/MLA/search?q=iPhone&limit=1',
    headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
    }
)
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        print('OK:', r.status)
        data = r.read().decode('utf-8')[:300]
        print('Data:', data)
except Exception as e:
    print('ERROR:', e)
