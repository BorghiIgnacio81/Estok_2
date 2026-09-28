# Renombrado del mapeo de categoría de Mercado Libre:
#   Categoria.meli_category_id  →  Categoria.mercadolibre_category_id
#
# IMPORTANTE: el autodetector de Django proponía RemoveField + AddField
# (0023_remove_categoria_meli_category_id_and_more), lo que habría BORRADO la
# columna en producción y con ella TODOS los mapeos de categoría ya guardados.
# Se reemplaza por RenameField (ALTER TABLE ... RENAME COLUMN): la columna se
# renombra y los datos existentes quedan intactos.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0022_descarte_gracia_admin_fisico'),
    ]

    operations = [
        migrations.RenameField(
            model_name='categoria',
            old_name='meli_category_id',
            new_name='mercadolibre_category_id',
        ),
        migrations.AlterField(
            model_name='categoria',
            name='mercadolibre_category_id',
            field=models.CharField(blank=True, help_text='ID de categoría de Mercado Libre en formato MLAxxxxx (ej: MLA412445).', max_length=50, null=True, verbose_name='ID Categoría Mercado Libre'),
        ),
    ]
