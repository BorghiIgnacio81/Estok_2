# Taxonomía estricta de Contenedores (MUEBLE / CAJA / ESTANTE).
#
# 1) Agrega el campo `tipo` con default 'CAJA' (los registros históricos nacen
#    como caja hasta que el backfill los reclasifica).
# 2) Backfill: reclasifica TODO el inventario existente con las MISMAS reglas
#    del servicio `inventario.services.taxonomia_contenedor`, de modo que el
#    listado de Objetos quede con el filtro taxonómico estricto sin pérdida de
#    datos ni tarjetas fantasma.
#
# El backfill usa el modelo HISTÓRICO (`apps.get_model`) y una copia ligera de
# cada fila (`SimpleNamespace`), por lo que no acopla la migración al modelo
# vivo ni dispara señales/save().

from types import SimpleNamespace

from django.db import migrations, models

from inventario.services.taxonomia_contenedor import inferir_tipo_contenedor


def backfill_tipos(apps, schema_editor):
    Contenedor = apps.get_model('inventario', 'Contenedor')
    filas = list(
        Contenedor.objects.values(
            'id', 'nombre', 'es_inmueble',
            'parent_contenedor', 'parent_grid_row', 'parent_grid_col',
        )
    )

    # Jerarquía completa: id → ¿tiene padre? (para saber si el ancestro directo
    # es un mueble RAÍZ o una sub-división interna).
    con_padre = {f['id'] for f in filas if f['parent_contenedor'] is not None}
    hijos_por_padre = {}
    for f in filas:
        pid = f['parent_contenedor']
        if pid is not None:
            hijos_por_padre[pid] = hijos_por_padre.get(pid, 0) + 1

    for f in filas:
        pid = f['parent_contenedor']
        tipo = inferir_tipo_contenedor(
            SimpleNamespace(
                nombre=f['nombre'],
                es_inmueble=f['es_inmueble'],
                parent_contenedor_id=pid,
                parent_grid_row=f['parent_grid_row'],
                parent_grid_col=f['parent_grid_col'],
                tipo='CAJA',
            ),
            tiene_hijos=hijos_por_padre.get(f['id'], 0) > 0,
            parent_es_raiz=(pid is None or pid not in con_padre),
        )
        Contenedor.objects.filter(pk=f['id']).update(tipo=tipo)


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0019_backfill_layouts_elasticos'),
    ]

    operations = [
        migrations.AddField(
            model_name='contenedor',
            name='tipo',
            field=models.CharField(
                choices=[
                    ('MUEBLE', 'Mueble Grande'),
                    ('CAJA', 'Caja Móvil Menor'),
                    ('ESTANTE', 'Estante/Cajón Interno'),
                ],
                db_index=True,
                default='CAJA',
                help_text='Taxonomía estricta del inventario: MUEBLE (armario/cucheta/ropero), CAJA (contenedor pequeño móvil de objetos) o ESTANTE (sub-división interna de un mueble, excluida de los listados).',
                max_length=10,
                verbose_name='Tipo de contenedor',
            ),
        ),
        migrations.RunPython(backfill_tipos, migrations.RunPython.noop),
    ]
