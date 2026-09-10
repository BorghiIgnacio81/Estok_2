"""
Backfill de compatibilidad: convierte los layouts matriciales previos
(parent_grid_row / parent_grid_col) a la nueva geometría elástica 2D
(ui_left / ui_top / ui_width / ui_height) en Ubicaciones y Contenedores.

Corre AUTOMÁTICAMENTE en el deploy (migrate), de modo que los Estoks antiguos
se actualicen de inmediato al nuevo sistema visual sin perder objetos ni romper
las relaciones multi-tenant. Es idempotente: solo toca registros que aún
conservan el alto visual histórico ('auto'), firma del layout matricial viejo.

La lógica pura vive en inventario/services/layouts_elasticos.py para poder
reutilizarla también desde el comando `migrar_layouts_elasticos`.
"""

from django.db import migrations


def backfill_layouts_elasticos(apps, schema_editor):
    # Import diferido: el servicio es estable y evita duplicar la conversión.
    from inventario.services.layouts_elasticos import migrar_layouts

    migrar_layouts(estok_id=None, dry_run=False)


def revertir(apps, schema_editor):
    """No destructivo: la geometría elástica derivada no se revierte a la grilla."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0018_contenedor_fusion_grupo_contenedor_ui_left_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill_layouts_elasticos, revertir),
    ]
