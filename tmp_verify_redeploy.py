"""Verificar que el redeploy tenga google-genai y el import os"""
import subprocess

CONTAINER = "320734cc7d97"
SSH_KEY = "C:\\Users\\USER\\Desktop\\Estok_2\\Hetzner\\llavehezner"
HOST = "root@178.156.224.212"

def run(cmd):
    full_cmd = [
        "ssh", "-i", SSH_KEY,
        "-o", "StrictHostKeyChecking=no",
        HOST,
        f"docker exec {CONTAINER} sh -c '{cmd}'"
    ]
    result = subprocess.run(full_cmd, capture_output=True, text=True)
    return result.stdout.strip(), result.stderr.strip(), result.returncode

# 1. Verificar google-genai instalado
print("=== 1. google-genai version ===")
out, err, rc = run("python -c 'import google.genai; print(google.genai.__version__)'")
print(f"  stdout: {out}")
print(f"  stderr: {err}")
print(f"  rc: {rc}")

# 2. Verificar que google-generativeai NO esté instalado
print("\n=== 2. google-generativeai (should NOT exist) ===")
out, err, rc = run("pip show google-generativeai 2>&1 || true")
print(f"  {out[:200]}")

# 3. Verificar import os en ai_vision_service.py
print("\n=== 3. import os in ai_vision_service.py ===")
out, err, rc = run("grep -n '^import os' /app/inventario/services/ai_vision_service.py")
print(f"  stdout: {out}")
print(f"  rc: {rc}")

# 4. Verificar GeminiClient usa google.genai
print("\n=== 4. GeminiClient uses google.genai ===")
out, err, rc = run("grep -n 'google.genai' /app/inventario/services/ai_vision_service.py")
print(f"  {out}")

# 5. Verificar que NO haya google.generativeai
print("\n=== 5. No google.generativeai references ===")
out, err, rc = run("grep -n 'google.generativeai' /app/inventario/services/ai_vision_service.py || echo 'CLEAN'")
print(f"  {out}")

# 6. Test health endpoint
print("\n=== 6. Test /api/objetos/test_ia_stress/?motor=gemini ===")
out, err, rc = run("curl -s -o /dev/null -w '%{http_code}' http://localhost:8001/api/objetos/test_ia_stress/?motor=gemini 2>&1 || true")
print(f"  HTTP status: {out}")

# 7. Test health endpoint local
print("\n=== 7. Test /api/objetos/test_ia_stress/?motor=local ===")
out, err, rc = run("curl -s -o /dev/null -w '%{http_code}' http://localhost:8001/api/objetos/test_ia_stress/?motor=local 2>&1 || true")
print(f"  HTTP status: {out}")
