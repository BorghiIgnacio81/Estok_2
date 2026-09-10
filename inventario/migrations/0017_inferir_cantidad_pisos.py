# Backfill de la pregunta inicial "¿Cuántas plantas (pisos) tiene su inmueble?"
#
# La columna cantidad_pisos se agrega con default=1, lo que convertiría a TODOS
# los Estoks preexistentes en "Modo Planta Única" y rompería las casas
# multi-planta ya modeladas. Para no alterar datos históricos, se infiere la
# cantidad desde la ESTRUCTURA real ya persistida:
#   - Si el Estok tiene divisiones en más de una fila (parent_grid_row) → Modo Casa.
#   - Si tiene una sola fila (o ninguna) → Modo Planta Única.

from django.db import migrations


def inferir_pisos(apps, schema_editor):
    Estok = apps.get_model('inventario', 'Estok')
    Ubicacion = apps.get_model('inventario', 'Ubicacion')
    for estok in Estok.objects.all():
        filas = list(
            Ubicacion.objects.filter(
                estok_id=estok.pk,
                parent_ubicacion__isnull=True,
                parent_grid_row__isnull=False,
            ).values_list('parent_grid_row', flat=True)
        )
        cantidad = max(1, int(max(filas)) if filas else 1)
        Estok.objects.filter(pk=estok.pk).update(
            cantidad_pisos=cantidad,
            tipo_layout='CASA_2_PISOS' if cantidad > 1 else 'VISTA_PLANTA_UNICA',
        )


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0016_estok_cantidad_pisos_ubicacion_fusion_grupo_and_more'),
    ]

    operations = [
        migrations.RunPython(inferir_pisos, migrations.RunPython.noop),
    ]
