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

# Probar: crear hijo con objeto_ptr manual
print("\n--- Test: crear hijo con objeto_ptr manual ---")
try:
    hijo = LibroRevista(objeto_ptr=obj, autor="Test Manual")
    hijo.save()
    print(f"  Creado: hijo.id={hijo.id}, hijo.objeto_ptr_id={hijo.objeto_ptr_id}")
except Exception as e:
    import traceback
    traceback.print_exc()

with connection.cursor() as cursor:
    cursor.execute("SELECT COUNT(*) FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
    print(f"  Hijos en DB: {cursor.fetchone()[0]}")
    if cursor.fetchone()[0] > 0:
        cursor.execute("SELECT id, objeto_ptr_id, autor FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
        for row in cursor.fetchall():
            print(f"    Row: id={row[0]}, objeto_ptr_id={row[1]}, autor={row[2]}")

# Limpiar
hijo.delete()
print("  (limpiado)")
