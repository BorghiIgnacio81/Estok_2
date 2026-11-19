"""Caja llena / lote en foto también para los OBJETOS declarados como caja.

`Contenedor` ya tiene `esta_llena` y `cantidad_objetos_lote` (migración 0042).
El alta y la edición de objetos (/objetos/nuevo y /objetos/<id>/editar)
declaran una caja como `Objeto.es_contenedor=True`; para que esa misma caja
pueda quedar marcada como LLENA (contenido fotografiado como lote) los campos
se replican en `Objeto` con idéntico contrato:

  · `esta_llena`             → bandera manual del operador (default False).
  · `cantidad_objetos_lote`  → cantidad estimada del lote (opcional, null).

No se migran datos: los Objetos existentes nacen con la caja con espacio
disponible (`esta_llena=False`, cantidad null), que es el comportamiento
histórico del listado.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0042_caja_llena_lote_objetos'),
    ]

    operations = [
        migrations.AddField(
            model_name='objeto',
            name='esta_llena',
            field=models.BooleanField(
                default=False,
                help_text='Marca el objeto declarado como caja/contenedor como LLENO: su contenido está fotografiado como lote y no admite más objetos. El listado lo etiqueta como «Caja llena» / «Lote foto» en vez de «Contenedor vacío».',
                verbose_name='Caja llena (lote en foto)',
            ),
        ),
        migrations.AddField(
            model_name='objeto',
            name='cantidad_objetos_lote',
            field=models.PositiveIntegerField(
                blank=True,
                help_text='Cantidad aproximada de piezas que contiene el lote fotografiado (ej. 40 para una colección de 40 revistas). Opcional: sólo se muestra cuando la caja está marcada como llena.',
                null=True,
                verbose_name='Cantidad estimada de objetos en el lote',
            ),
        ),
    ]
