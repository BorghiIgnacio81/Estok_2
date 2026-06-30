"""
Script para verificar que el fix del PUT funciona correctamente.
Ejecutar DENTRO del contenedor después del redeploy.
"""
import sys
sys.path.insert(0, '/app')
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

from inventario.models import Objeto, LibroRevista, Tecnologia, MuebleArte, Ropa
from inventario.api.serializers import ObjetoCreateSerializer
from django.db import connection

# ============================================================
# TEST 1: Objeto sin subtipo -> PUT con tipo='libro'
# ============================================================
print("=" * 60)
print("TEST 1: Objeto sin subtipo -> PUT con tipo='libro'")
print("=" * 60)

obj = Objeto.objects.get(id='d80cb02d-10e3-43cf-a34f-ffeba9e86125')
print(f"Objeto: {obj.nombre}")

# Verificar estado inicial
with connection.cursor() as cursor:
    cursor.execute("SELECT COUNT(*) FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
    print(f"  Hijos libro antes: {cursor.fetchone()[0]}")

data = {
    "nombre": "Manual Electronica",
    "descripcion": "Aprende solo: Electrónica W.P. Jolly . Editorial Rei",
    "color": "Rojo negro",
    "contenedor": "f4cf9247-cfe5-40a4-a1b8-d690ff4b2a86",
    "estado_conservacion": "bueno",
    "tipo": "libro",
    "ubicacion": "67edf756-bb28-4f44-a49f-3dc7d0d6b200",
    "valor_estimado": "2.00",
    "autor": "W.P. Jolly",
    "editorial": "Editorial Rei",
    "idioma": "Español"
}

from django.test.client import RequestFactory
from django.contrib.sessions.middleware import SessionMiddleware
from inventario.models import CustomUser

rf = RequestFactory()
request = rf.put('/api/objetos/d80cb02d-10e3-43cf-a34f-ffeba9e86125/', data, content_type='application/json')
request.user = CustomUser.objects.get(id='ae61c306-639d-4635-b34e-c17cb5b3c6e7')
request.META['HTTP_X_ESTOK_ID'] = '5527d82d-0270-4333-9175-c91a6449e35a'
request.method = 'PUT'
request.content_type = 'application/json'

middleware = SessionMiddleware(lambda r: None)
middleware.process_request(request)
request.session.save()

serializer = ObjetoCreateSerializer(instance=obj, data=data, context={'request': request})
print(f"  Serializer válido: {serializer.is_valid()}")
if not serializer.is_valid():
    print(f"  ERRORES: {serializer.errors}")
else:
    try:
        updated = serializer.save()
        print(f"  Update OK: {updated.nombre}")
    except Exception as e:
        import traceback
        traceback.print_exc()

# Verificar estado después
with connection.cursor() as cursor:
    cursor.execute("SELECT COUNT(*) FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
    count = cursor.fetchone()[0]
    print(f"  Hijos libro después: {count}")
    if count > 0:
        cursor.execute("SELECT autor, editorial, idioma FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
        row = cursor.fetchone()
        print(f"  Datos libro: autor={row[0]}, editorial={row[1]}, idioma={row[2]}")

# ============================================================
# TEST 2: Cambio de subtipo (libro -> tecnologia)
# ============================================================
print()
print("=" * 60)
print("TEST 2: Cambio de subtipo (libro -> tecnologia)")
print("=" * 60)

data2 = {
    "nombre": "Manual Electronica",
    "tipo": "tecnologia",
    "marca": "TestBrand",
    "modelo": "TX-1000",
}

serializer2 = ObjetoCreateSerializer(instance=obj, data=data2, context={'request': request})
print(f"  Serializer válido: {serializer2.is_valid()}")
if not serializer2.is_valid():
    print(f"  ERRORES: {serializer2.errors}")
else:
    try:
        updated2 = serializer2.save()
        print(f"  Update OK: {updated2.nombre}")
    except Exception as e:
        import traceback
        traceback.print_exc()

# Verificar estado
with connection.cursor() as cursor:
    cursor.execute("SELECT COUNT(*) FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
    print(f"  Hijos libro después del cambio: {cursor.fetchone()[0]} (debe ser 0)")
    cursor.execute("SELECT COUNT(*) FROM inventario_tecnologia WHERE objeto_ptr_id = %s", [obj.id])
    count_tecno = cursor.fetchone()[0]
    print(f"  Hijos tecnologia después del cambio: {count_tecno} (debe ser 1)")
    if count_tecno > 0:
        cursor.execute("SELECT marca, modelo FROM inventario_tecnologia WHERE objeto_ptr_id = %s", [obj.id])
        row = cursor.fetchone()
        print(f"  Datos tecnologia: marca={row[0]}, modelo={row[1]}")

# ============================================================
# TEST 3: Restaurar a libro (para no dejar el objeto roto)
# ============================================================
print()
print("=" * 60)
print("TEST 3: Restaurar a libro")
print("=" * 60)

data3 = {
    "nombre": "Manual Electronica",
    "descripcion": "Aprende solo: Electrónica W.P. Jolly . Editorial Rei",
    "color": "Rojo negro",
    "contenedor": "f4cf9247-cfe5-40a4-a1b8-d690ff4b2a86",
    "estado_conservacion": "bueno",
    "tipo": "libro",
    "ubicacion": "67edf756-bb28-4f44-a49f-3dc7d0d6b200",
    "valor_estimado": "2.00",
    "autor": "W.P. Jolly",
    "editorial": "Editorial Rei",
    "idioma": "Español"
}

serializer3 = ObjetoCreateSerializer(instance=obj, data=data3, context={'request': request})
print(f"  Serializer válido: {serializer3.is_valid()}")
if not serializer3.is_valid():
    print(f"  ERRORES: {serializer3.errors}")
else:
    try:
        updated3 = serializer3.save()
        print(f"  Update OK: {updated3.nombre}")
    except Exception as e:
        import traceback
        traceback.print_exc()

with connection.cursor() as cursor:
    cursor.execute("SELECT COUNT(*) FROM inventario_tecnologia WHERE objeto_ptr_id = %s", [obj.id])
    print(f"  Hijos tecnologia: {cursor.fetchone()[0]} (debe ser 0)")
    cursor.execute("SELECT COUNT(*) FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
    print(f"  Hijos libro: {cursor.fetchone()[0]} (debe ser 1)")

print()
print("=" * 60)
print("TODOS LOS TESTS COMPLETADOS")
print("=" * 60)
