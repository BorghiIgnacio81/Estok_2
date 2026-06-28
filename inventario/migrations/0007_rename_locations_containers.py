"""
Migration: Renombrar ubicaciones y contenedores
- Deposito Central -> Habitacion Santiago
- Oficina Principal -> Habitacion Agustina
- Estante A1 -> Ropero Grande Espejo
- Crear Pasillo Arriba
"""
from django.db import migrations

def rename_locations_and_containers(apps, schema_editor):
    Ubicacion = apps.get_model('inventario', 'Ubicacion')
    Contenedor = apps.get_model('inventario', 'Contenedor')

    # Renombrar ubicaciones
    try:
        dc = Ubicacion.objects.get(nombre='Deposito Central')
        dc.nombre = 'Habitacion Santiago'
        dc.save()
        print('  Renamed: Deposito Central -> Habitacion Santiago')
    except Ubicacion.DoesNotExist:
        print('  Note: Deposito Central not found')

    try:
        op = Ubicacion.objects.get(nombre='Oficina Principal')
        op.nombre = 'Habitacion Agustina'
        op.save()
        print('  Renamed: Oficina Principal -> Habitacion Agustina')
    except Ubicacion.DoesNotExist:
        print('  Note: Oficina Principal not found')

    # Crear Pasillo Arriba (hereda estok de alguna ubicacion existente si es necesario)
    try:
        Ubicacion.objects.get(nombre='Pasillo Arriba')
        print('  Note: Pasillo Arriba already exists')
    except Ubicacion.DoesNotExist:
        # Tomar el estok de la primera ubicacion disponible
        existing = Ubicacion.objects.first()
        if existing:
            Ubicacion.objects.create(
                nombre='Pasillo Arriba',
                descripcion='Pasillo del piso superior',
                estok=existing.estok,
            )
            print('  Created: Pasillo Arriba')
        else:
            print('  Note: No existing locations to inherit estok from, skipping Pasillo Arriba')

    # Renombrar contenedor
    try:
        ea = Contenedor.objects.get(nombre='Estante A1')
        ea.nombre = 'Ropero Grande Espejo'
        ea.save()
        print('  Renamed: Estante A1 -> Ropero Grande Espejo')
    except Contenedor.DoesNotExist:
        print('  Note: Estante A1 not found')


class Migration(migrations.Migration):
    dependencies = [
        ('inventario', '0006_contenedor_material_tipo_madera'),
    ]

    operations = [
        migrations.RunPython(rename_locations_and_containers),
    ]
