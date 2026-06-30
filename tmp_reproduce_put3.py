import sys
sys.path.insert(0, '/app')
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

from inventario.models import Objeto, CustomUser, Estok, LibroRevista
from inventario.api.serializers import ObjetoCreateSerializer

# Buscar el objeto
obj = Objeto.objects.get(id='d80cb02d-10e3-43cf-a34f-ffeba9e86125')
print(f"Objeto: {obj.nombre}")
print(f"ID: {obj.id}")
print(f"Estok: {obj.estok_id}")

# Verificar si existe algún hijo en DB directamente
from django.db import connection
with connection.cursor() as cursor:
    cursor.execute("SELECT COUNT(*) FROM inventario_librorevista WHERE objeto_ptr_id = %s", [obj.id])
    count = cursor.fetchone()[0]
    print(f"LibroRevista en DB: {count}")
    cursor.execute("SELECT COUNT(*) FROM inventario_tecnologia WHERE objeto_ptr_id = %s", [obj.id])
    count = cursor.fetchone()[0]
    print(f"Tecnologia en DB: {count}")
    cursor.execute("SELECT COUNT(*) FROM inventario_mueblearte WHERE objeto_ptr_id = %s", [obj.id])
    count = cursor.fetchone()[0]
    print(f"MuebleArte en DB: {count}")
    cursor.execute("SELECT COUNT(*) FROM inventario_ropa WHERE objeto_ptr_id = %s", [obj.id])
    count = cursor.fetchone()[0]
    print(f"Ropa en DB: {count}")

# Simular el update directamente
data = {
    "nombre": "Manual Electronica",
    "descripcion": "Aprende solo: Electrónica W.P. Jolly . Editorial Rei",
    "color": "Rojo negro",
    "contenedor": "f4cf9247-cfe5-40a4-a1b8-d690ff4b2a86",
    "estado_conservacion": "bueno",
    "tipo": "libro",
    "ubicacion": "67edf756-bb28-4f44-a49f-3dc7d0d6b200",
    "valor_estimado": "2.00"
}

# Crear un request mock
from django.test.client import RequestFactory
from django.contrib.sessions.middleware import SessionMiddleware
from django.middleware.csrf import CsrfViewMiddleware

rf = RequestFactory()
request = rf.put('/api/objetos/d80cb02d-10e3-43cf-a34f-ffeba9e86125/', data, content_type='application/json')
request.user = CustomUser.objects.get(id='ae61c306-639d-4635-b34e-c17cb5b3c6e7')
request.META['HTTP_X_ESTOK_ID'] = '5527d82d-0270-4333-9175-c91a6449e35a'
request.method = 'PUT'
request.content_type = 'application/json'

# Agregar middleware de sesión
middleware = SessionMiddleware(lambda r: None)
middleware.process_request(request)
request.session.save()

print(f"\nRequest data: {request.POST}")
print(f"Request body: {request.body}")

serializer = ObjetoCreateSerializer(instance=obj, data=data, context={'request': request})
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
