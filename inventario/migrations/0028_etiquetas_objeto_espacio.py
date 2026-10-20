# ETIQUETAS DE COHERENCIA: «Mueble / Objeto» y «Valor estimado»
# ---------------------------------------------------------------------------
# Cambios EXCLUSIVAMENTE de verbose_name / help_text (la columna y su tipo no
# cambian; la migración es segura e instantánea):
#
# 1) Contenedor.declarado_movible → «Declarado como Mueble / Objeto»
#    (el frontend muestra el mismo rótulo en el disyuntor del espacio).
# 2) Objeto.valor_estimado → «Valor estimado»
#    Se quita la referencia a USD: los valores del inventario se manejan en
#    pesos argentinos (ARS) y la moneda no debe estar hardcodeada en la UI.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0027_declarado_movible_default_false'),
    ]

    operations = [
        migrations.AlterField(
            model_name='contenedor',
            name='declarado_movible',
            field=models.BooleanField(default=False, help_text='Declaración EXPLÍCITA del operador: tildado = bulto movible (mueble/objeto) listable en la canasta «Elementos por ubicar» y en la pestaña de Objetos; destildado (default) = ARQUITECTURA del espacio, excluida de raíz.', verbose_name='Declarado como Mueble / Objeto'),
        ),
        migrations.AlterField(
            model_name='objeto',
            name='valor_estimado',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True, verbose_name='Valor estimado'),
        ),
    ]
