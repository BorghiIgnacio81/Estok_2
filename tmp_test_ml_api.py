import urllib.request
req = urllib.request.Request(
    'https://api.mercadolibre.com/sites/MLA/search?q=iphone&limit=1',
    headers={'User-Agent': 'Estok/1.0'}
)
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        print('OK:', r.status)
except Exception as e:
    print('ERROR:', type(e).__name__, str(e))
