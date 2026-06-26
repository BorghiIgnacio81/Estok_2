"""Verificar si import os existe en ai_vision_service.py dentro del contenedor"""
import subprocess
import sys

cmd = [
    "ssh", "-i", "C:\\Users\\USER\\Desktop\\Estok_2\\Hetzner\\llavehezner",
    "-o", "StrictHostKeyChecking=no",
    "root@178.156.224.212",
    "docker exec 0c686863208d grep -n '^import os' /app/inventario/services/ai_vision_service.py"
]

result = subprocess.run(cmd, capture_output=True, text=True)
print("STDOUT:", result.stdout)
print("STDERR:", result.stderr)
print("RC:", result.returncode)
