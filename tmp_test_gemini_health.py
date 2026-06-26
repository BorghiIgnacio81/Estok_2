"""Test directo de GeminiClient._check_health() dentro del contenedor"""
import sys
import os

# Agregar el proyecto al path
sys.path.insert(0, '/app')

# Configurar Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()

from inventario.services.ai_vision_service import GeminiClient

client = GeminiClient()
print("API Key loaded:", bool(client.api_key))
print("API Key prefix:", repr(client.api_key[:15]) if client.api_key else "NONE")

result = client._check_health()
print("Health check result:", result)
