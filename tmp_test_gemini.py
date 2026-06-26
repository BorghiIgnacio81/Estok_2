import google.generativeai as genai
import os

key = os.environ.get("GEMINI_API_KEY", "")
print("Key len:", len(key))
print("Key prefix:", repr(key[:15]))
print("Key suffix:", repr(key[-5:]))

try:
    genai.configure(api_key=key)
    models = list(genai.list_models())
    print("Models found:", len(models))
    for m in models[:3]:
        print(" -", m.name)
except Exception as e:
    print("ERROR type:", type(e).__name__)
    print("ERROR msg:", str(e)[:300])
