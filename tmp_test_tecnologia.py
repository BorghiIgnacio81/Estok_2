import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django; django.setup()

from inventario.models import Objeto, Tecnologia
from django.db import connection

with connection.cursor() as cursor:
    cursor.execute("""
        SELECT o.id, o.nombre FROM inventario_objeto o
        INNER JOIN inventario_tecnologia t ON t.objeto_ptr_id = o.id
        LIMIT 1
    """)
    row = cursor.fetchone()
    if row:
        print(f"Objeto tecnologia encontrado: id={row[0]}, nombre={row[1]}")
        
        # Test: UPDATE SQL directo
        cursor.execute("""
            UPDATE inventario_tecnologia 
            SET marca = %s WHERE objeto_ptr_id = %s
        """, ["Marca Test UPDATE", row[0]])
        print("UPDATE SQL directo OK")
        
        # Test: Tecnologia.objects.create (simula create del serializer)
        try:
            t = Tecnologia.objects.create(
                objeto_ptr_id=row[0],
                marca="Test",
                modelo="Test",
                numero_serie="",
                peso=None,
                especificaciones={}
            )
            print("Tecnologia.objects.create FUNCIONO (inesperado)")
            t.delete()
        except Exception as e:
            print(f"Tecnologia.objects.create FALLO: {e}")
    else:
        print("No hay objetos de tipo tecnologia en la DB")
