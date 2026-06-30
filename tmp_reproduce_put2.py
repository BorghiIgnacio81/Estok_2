import sys
sys.path.insert(0, '/app')
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

from inventario.models import Objeto, CustomUser, Estok, LibroRevista
from inventario.api.serializers import ObjetoCreateSerializer
from rest_framework.test import APIRequestFactory
from django.test import override_settings

# Buscar el objeto
obj = Objeto.objects.get(id='d80cb02d-10e3-43cf-a34f-ffeba9e86125')
print(f"Objeto: {obj.nombre}, tipo actual: no tiene campo tipo")
print(f"Tiene librorevista: {hasattr(obj, 'librorevista')}")
print(f"Tiene tecnologia: {hasattr(obj, 'tecnologia')}")
print(f"Tiene mueblearte: {hasattr(obj, 'mueblearte')}")
print(f"Tiene ropa: {hasattr(obj, 'ropa')}")

# Ver si existe algún hijo
try:
    lr = obj.librorevista
    print(f"LibroRevista existe: {lr}")
except Exception as e:
    print(f"LibroRevista NO existe: {e}")

try:
    tec = obj.tecnologia
    print(f"Tecnologia existe: {tec}")
except Exception as e:
    print(f"Tecnologia NO existe: {e}")

try:
    ma = obj.mueblearte
    print(f"MuebleArte existe: {ma}")
except Exception as e:
    print(f"MuebleArte NO existe: {e}")

try:
    rp = obj.ropa
    print(f"Ropa existe: {rp}")
except Exception as e:
    print(f"Ropa NO existe: {e}")

# Ahora simular el PUT
user = CustomUser.objects.get(id='ae61c306-639d-4635-b34e-c17cb5b3c6e7')
estok = Estok.objects.get(id='5527d82d-0270-4333-9175-c91a6449e35a')

factory = APIRequestFactory()
request = factory.put(
    '/api/objetos/d80cb02d-10e3-43cf-a34f-ffeba9e86125/',
    {
        "nombre": "Manual Electronica",
        "descripcion": "Aprende solo: Electrónica W.P. Jolly . Editorial Rei",
        "color": "Rojo negro",
        "contenedor": "f4cf9247-cfe5-40a4-a1b8-d690ff4b2a86",
        "estado_conservacion": "bueno",
        "tipo": "libro",
        "ubicacion": "67edf756-bb28-4f44-a49f-3dc7d0d6b200",
        "valor_estimado": "2.00"
    },
    format='json'
)
request.user = user
request.META['HTTP_X_ESTOK_ID'] = '5527d82d-0270-4333-9175-c91a6449e35a'

serializer = ObjetoCreateSerializer(data=request.data, instance=obj, context={'request': request})
print(f"\nSerializer valid? {serializer.is_valid()}")
if not serializer.is_valid():
    print(f"Errors: {serializer.errors}")
else:
    try:
        updated = serializer.save()
        print(f"Updated OK: {updated.nombre}")
    except Exception as e:
        import traceback
        traceback.print_exc()
