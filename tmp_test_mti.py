"""
Test local de multi-table inheritance para confirmar el bug.
"""
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
os.chdir('c:\\Users\\USER\\Desktop\\Estok_2')
import django
django.setup()

from inventario.models import Objeto, Tecnologia, Estok

# Obtener un estok real
estok = Estok.objects.first()
print(f"Usando Estok: {estok.nombre} (id={estok.id})")

# Test 1: Crear Objeto base primero, luego Tecnologia con objeto_ptr
print("\n--- Test 1: Objeto.objects.create() + Tecnologia.objects.create(objeto_ptr=objeto) ---")
try:
    obj = Objeto.objects.create(
        nombre="Test MTI 1",
        estok=estok
    )
    print(f"Objeto creado: {obj.id}")
    tec = Tecnologia.objects.create(
        objeto_ptr=obj,
        marca="Test"
    )
    print(f"Tecnologia creada: {tec.id}")
except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")

# Test 2: Crear Tecnologia directamente (deja que Django cree el Objeto base)
print("\n--- Test 2: Tecnologia.objects.create() directamente ---")
try:
    tec2 = Tecnologia.objects.create(
        nombre="Test MTI 2",
        estok=estok,
        marca="Test2"
    )
    print(f"Tecnologia creada: {tec2.id}, objeto_ptr_id={tec2.objeto_ptr_id}")
except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")

# Test 3: Crear Objeto base, luego Tecnologia con save()
print("\n--- Test 3: Objeto + Tecnologia(objeto_ptr_id=...).save() ---")
try:
    obj3 = Objeto.objects.create(
        nombre="Test MTI 3",
        estok=estok
    )
    print(f"Objeto creado: {obj3.id}")
    tec3 = Tecnologia(objeto_ptr_id=obj3.id, marca="Test3")
    tec3.save()
    print(f"Tecnologia creada: {tec3.id}")
except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")

# Limpiar
print("\n--- Limpiando objetos de prueba ---")
for o in Objeto.objects.filter(nombre__startswith="Test MTI"):
    print(f"Eliminando: {o.nombre} ({o.id})")
    o.hard_delete()
