import urllib.request, urllib.parse, json, ssl

url = 'https://api.mercadolibre.com/sites/MLA/search?q=' + urllib.parse.quote('iPhone 14 Pro Max') + '&limit=10'
req = urllib.request.Request(url, headers={
    'User-Agent': 'Estok/1.0 (inventario personal)',
    'Accept': 'application/json',
})
ctx = ssl.create_default_context()
with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
    data = json.loads(resp.read().decode('utf-8'))

results = data.get('results', [])
print(f'Total resultados: {len(results)}')
if results:
    for r in results[:3]:
        title = r.get('title', '?')
        price = r.get('price', 0)
        currency = r.get('currency_id', '')
        print(f'  - {title[:80]} | ${price} {currency}')
else:
    print('Sin resultados')
