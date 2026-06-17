"""
Script de prueba para verificar la conexión con LM Studio.
Ejecutar: python test_ia_connection.py

Este script prueba:
1. Si LM Studio está corriendo en http://localhost:1234
2. Si el modelo responde correctamente
3. Muestra la respuesta cruda del modelo
"""

import os
import sys
import json
import base64
import time
from pathlib import Path

# Configurar Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
sys.path.insert(0, str(Path(__file__).resolve().parent))

import django
django.setup()

from django.conf import settings
from inventario.services.ai_vision_service import LMStudioClient, AIVisionService

print("=" * 70)
print("🔍 DIAGNÓSTICO DE CONEXIÓN CON LM STUDIO")
print("=" * 70)

# 1. Verificar configuración
print(f"\n📋 Configuración:")
print(f"   URL: {settings.AI_API_ENDPOINT}")
print(f"   Timeout: {settings.AI_API_TIMEOUT}s")
print(f"   Timeout alta res: {settings.AI_HIGH_RES_TIMEOUT}s")

# 2. Probar conexión básica
print(f"\n🔌 Probando conexión con LM Studio...")
client = LMStudioClient()
start = time.time()
try:
    models = client.client.models.list()
    elapsed = time.time() - start
    print(f"   ✅ Conexión exitosa en {elapsed:.1f}s")
    print(f"   Modelos disponibles:")
    for model in models:
        print(f"      - {model.id}")
except Exception as e:
    elapsed = time.time() - start
    print(f"   ❌ Error de conexión en {elapsed:.1f}s: {e}")
    print(f"\n💡 SOLUCIÓN:")
    print(f"   1. Abrí LM Studio en tu PC")
    print(f"   2. Cargá un modelo (ej: Qwen2-VL-7B-Instruct)")
    print(f"   3. Iniciá el servidor local (botón 'Start Server')")
    print(f"   4. Verificá que el puerto sea 1234")
    print(f"   5. Ejecutá este script de nuevo")
    sys.exit(1)

# 3. Probar con una imagen de prueba (si existe)
print(f"\n📸 Buscando imágenes de prueba...")
test_images = [
    "test_book.jpg",
    "test_image.jpg",
    "test.png",
    "test_book.png",
    "archivador.png",
]

test_image = None
for img in test_images:
    path = Path(img)
    if path.exists():
        test_image = str(path.absolute())
        print(f"   ✅ Imagen encontrada: {test_image}")
        break

if not test_image:
    print(f"   ⚠️ No se encontró imagen de prueba")
    print(f"   Puedes probar con: python -c \"from inventario.services.ai_vision_service import AIVisionService; s=AIVisionService(); print(s.client._check_health())\"")
else:
    print(f"\n🧠 Enviando imagen al modelo para análisis...")
    print(f"   (Esto puede tomar hasta {settings.AI_API_TIMEOUT}s)")
    
    service = AIVisionService()
    start = time.time()
    
    try:
        # Codificar imagen
        with open(test_image, "rb") as f:
            image_b64 = base64.b64encode(f.read()).decode("utf-8")
        
        # Comprimir
        image_b64 = service._comprimir_imagen_base64(image_b64)
        
        # Analizar
        resultado = service.procesar_imagen_desde_base64(image_b64)
        elapsed = time.time() - start
        
        print(f"\n   ⏱️ Tiempo de respuesta: {elapsed:.1f}s")
        print(f"\n   📊 RESULTADO DEL ANÁLISIS:")
        print(f"   {'='*50}")
        
        if resultado.nombre:
            print(f"   📝 Nombre: {resultado.nombre}")
        if resultado.autor:
            print(f"   ✍️ Autor: {resultado.autor}")
        if resultado.marca:
            print(f"   🏷️ Marca: {resultado.marca}")
        if resultado.editorial:
            print(f"   📚 Editorial: {resultado.editorial}")
        if resultado.isbn_issn:
            print(f"   🔢 ISBN/ISSN: {resultado.isbn_issn}")
        if resultado.edicion:
            print(f"   📖 Edición: {resultado.edicion}")
        if resultado.anio:
            print(f"   📅 Año: {resultado.anio}")
        if resultado.categoria:
            print(f"   🏷️ Categoría: {resultado.categoria}")
        if resultado.estado_conservacion:
            print(f"   ✅ Estado: {resultado.estado_conservacion}")
        if resultado.color:
            print(f"   🎨 Color: {resultado.color}")
        if resultado.precio_estimado_mercado:
            print(f"   💰 Precio: ${resultado.precio_estimado_mercado}")
        if resultado.descripcion:
            print(f"   📄 Descripción: {resultado.descripcion[:200]}...")
        if resultado.nombre_serie:
            print(f"   📚 Serie: {resultado.nombre_serie}")
        if resultado.titulo_tomo:
            print(f"   📖 Tomo: {resultado.titulo_tomo}")
        if resultado.numero_tomo:
            print(f"   🔢 N° Tomo: {resultado.numero_tomo}")
        if resultado.idioma:
            print(f"   🌐 Idioma: {resultado.idioma}")
        
        print(f"\n   📊 Confianza: {resultado.confianza_general:.2f}")
        print(f"   ⚠️ Campos pendientes: {resultado.campos_pendientes}")
        
        # Mostrar respuesta cruda
        print(f"\n   📜 RESPUESTA CRUDA DEL MODELO:")
        print(f"   {'='*50}")
        try:
            raw = json.loads(resultado.raw_response)
            print(f"   {json.dumps(raw, indent=2, ensure_ascii=False)}")
        except:
            print(f"   {resultado.raw_response[:500]}")
        
        if resultado.campos_pendientes:
            print(f"\n   ⚠️ La IA no pudo determinar: {', '.join(resultado.campos_pendientes)}")
            print(f"   💡 Sugerencia: Mejorá la foto (mejor iluminación, más cerca, texto legible)")
        
    except Exception as e:
        elapsed = time.time() - start
        print(f"\n   ❌ Error en {elapsed:.1f}s: {e}")
        import traceback
        traceback.print_exc()

print(f"\n{'='*70}")
print("✅ Diagnóstico completado")
print(f"{'='*70}")
