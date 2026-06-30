import os, django, sys
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
sys.path.insert(0, "/app")
django.setup()

from inventario.models import Objeto
from django.db import connection

# Buscar el objeto que el usuario está editando
obj_id = "9ae97961-3df5-437e-b034-908210afbf76"
obj = Objeto.objects.filter(id=obj_id).first()
if obj:
    print(f"Objeto encontrado: id={obj.id}, nombre={obj.nombre}")
    
    # Ver qué subtipo tiene
    with connection.cursor() as cursor:
        for tabla, tipo in [
            ("inventario_librorevista", "libro"),
            ("inventario_tecnologia", "tecnologia"),
            ("inventario_mueblearte", "mueble"),
            ("inventario_ropa", "ropa"),
        ]:
            cursor.execute(f"SELECT COUNT(*) FROM {tabla} WHERE objeto_ptr_id = %s", [obj_id])
            if cursor.fetchone()[0] > 0:
                print(f"Subtipo actual: {tipo} (tabla {tabla})")
                break
        else:
            print("NO tiene subtipo!")
    
    # Probar PUT con el serializer
    from inventario.api.serializers import ObjetoCreateSerializer
    from django.test import RequestFactory
    
    data = {
        "nombre": "Test PUT desde diagnostico2",
        "tipo": "tecnologia",
        "marca": "Marca Test",
        "modelo": "Modelo Test",
    }
    
    factory = RequestFactory()
    request = factory.put(f"/api/objetos/{obj_id}/", data, format="json")
    
    serializer = ObjetoCreateSerializer(instance=obj, data=data, context={"request": request})
    if serializer.is_valid():
        try:
            updated = serializer.save()
            print(f"UPDATE EXITOSO! id={updated.id}, nombre={updated.nombre}")
        except Exception as e:
            print(f"ERROR al hacer save(): {e}")
            import traceback
            traceback.print_exc()
    else:
        print(f"ERROR de validacion: {serializer.errors}")
else:
    print(f"Objeto {obj_id} no encontrado")
