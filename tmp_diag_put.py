import os, django, sys
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
sys.path.insert(0, "/app")
django.setup()

from inventario.models import Objeto
from inventario.api.serializers import ObjetoCreateSerializer
from django.test import RequestFactory

# Buscar un objeto de tipo tecnologia
try:
    obj = Objeto.objects.filter(tecnologia__isnull=False).first()
    if not obj:
        obj = Objeto.objects.filter(librorevista__isnull=False).first()
    
    if obj:
        print(f"Objeto encontrado: id={obj.id}, nombre={obj.nombre}, tipo actual en DB={obj.tipo}")
        
        # Simular PUT - cambiar nombre y marca
        data = {
            "nombre": "Test PUT desde diagnostico",
            "tipo": obj.tipo,
        }
        if obj.tipo == "tecnologia":
            data["marca"] = "Marca Test"
            data["modelo"] = "Modelo Test"
        elif obj.tipo == "libro":
            data["autor"] = "Autor Test"
        
        factory = RequestFactory()
        request = factory.put(f"/api/objetos/{obj.id}/", data, format="json")
        
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
        print("No hay objetos en la DB")
except Exception as e:
    print(f"ERROR GENERAL: {e}")
    import traceback
    traceback.print_exc()
