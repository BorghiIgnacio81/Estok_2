# Generated manually: elimina el modelo MercadoLibreToken y su tabla
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0008_mercadolibretoken'),
    ]

    operations = [
        migrations.DeleteModel(
            name='MercadoLibreToken',
        ),
    ]
