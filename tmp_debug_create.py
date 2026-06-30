import sys
sys.path.insert(0, '/app')
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

from inventario.models import Objeto, LibroRevista
from django.db import connection

obj = Objeto.objects.get(id='d80cb02d-10e3-43cf-a34f-ffeba9e86125')
print(f"Objeto: {obj.nombre}, id={obj.id}")

# Probar get_or_create directamente
print("\n--- Test get_or_create con objeto_ptr_id ---")
try:
    hijo, created = LibroRevista.objects.get_or_create(objeto_ptr_id=obj.id)
    print(f"  created={created}, hijo.id={hijo.id if hijo else 'None'}")
    print(f"  hijo.objeto_ptr_id={hijo.objeto_ptr_id}")
except Exception as e:
    import traceback
    traceback.print_exc()

# Verificar en DB
with connection.cursor() as cursor:
    cursor.execute("SELECT COUNT(*) FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
    print(f"  Hijos en DB: {cursor.fetchone()[0]}")

# Probar create directamente
print("\n--- Test create con objeto_ptr_id ---")
try:
    hijo2 = LibroRevista.objects.create(objeto_ptr_id=obj.id, autor="Test")
    print(f"  Creado: hijo2.id={hijo2.id}")
except Exception as e:
    import traceback
    traceback.print_exc()

with connection.cursor() as cursor:
    cursor.execute("SELECT COUNT(*) FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
    print(f"  Hijos en DB: {cursor.fetchone()[0]}")
