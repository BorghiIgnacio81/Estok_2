import google.genai as genai
import os
key = os.environ.get('GEMINI_API_KEY', '')
print('Key exists:', bool(key))
print('Key prefix:', key[:10] if key else 'N/A')
client = genai.Client(api_key=key)
models = client.models.list()
count = 0
for m in models:
    count += 1
    if count <= 3:
        print(' -', m.name)
print('... total:', count)
