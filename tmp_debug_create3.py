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

# Probar: INSERT directo en la tabla hija
print("\n--- Test: INSERT directo en inventario_librorevista ---")
try:
    with connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO inventario_librorevista (objeto_ptr_id, autor, editorial, idioma) VALUES (%s, %s, %s, %s)",
            [obj.id, "Test Autor", "Test Editorial", "Español"]
        )
    print("  INSERT OK")
except Exception as e:
    import traceback
    traceback.print_exc()

with connection.cursor() as cursor:
    cursor.execute("SELECT COUNT(*) FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
    count = cursor.fetchone()[0]
    print(f"  Hijos en DB: {count}")
    if count > 0:
        cursor.execute("SELECT autor, editorial, idioma FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
        row = cursor.fetchone()
        print(f"  Datos: autor={row[0]}, editorial={row[1]}, idioma={row[2]}")

# Probar: UPDATE directo
print("\n--- Test: UPDATE directo en inventario_librorevista ---")
try:
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE inventario_librorevista SET autor = %s WHERE objeto_ptr_id = %s",
            ["Autor Actualizado", obj.id]
        )
    print("  UPDATE OK")
except Exception as e:
    import traceback
    traceback.print_exc()

with connection.cursor() as cursor:
    cursor.execute("SELECT autor FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
    row = cursor.fetchone()
    print(f"  Autor después de UPDATE: {row[0]}")

# Probar: DELETE directo
print("\n--- Test: DELETE directo ---")
try:
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
    print("  DELETE OK")
except Exception as e:
    import traceback
    traceback.print_exc()

with connection.cursor() as cursor:
    cursor.execute("SELECT COUNT(*) FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
    print(f"  Hijos en DB después de DELETE: {cursor.fetchone()[0]}")
