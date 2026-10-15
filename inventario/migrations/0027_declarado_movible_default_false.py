# LOTE 25 · RESET POR DEFECTO A FALSE (declarado_movible)
# ---------------------------------------------------------------------------
# El flag `declarado_movible` nace en False: TODA pieza es ARQUITECTURA del
# espacio hasta que el operador la declare Mueble Móvil / Objeto a mano.
#
# 1) AlterField → cambia el default del modelo de True a False.
# 2) RunPython   → RESET de las piezas existentes: cualquier fila que quedó en
#    True por el default anterior (Lote 24) vuelve a False. Así «Ropero
#    Empotrado», «Escritorio Pintura», «Baúl» y «Cama Cucheta» desaparecen de
#    la pantalla de Objetos hasta ser declaradas movibles explícitamente.

from django.db import migrations, models


def reset_declarado_movible(apps, schema_editor):
    """RESET idempotente: toda pieza existente vuelve a False (inmueble)."""
    Contenedor = apps.get_model('inventario', 'Contenedor')
    Contenedor.objects.filter(declarado_movible=True).update(declarado_movible=False)


def sin_reversion(apps, schema_editor):
    """Reversión NO-OP: el reset no guarda el valor previo de cada fila."""


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0026_contenedor_declarado_movible'),
    ]

    operations = [
        migrations.AlterField(
            model_name='contenedor',
            name='declarado_movible',
            field=models.BooleanField(default=False, help_text='Declaración EXPLÍCITA del operador: tildado = bulto movible (mueble móvil/objeto) listable en la canasta «Elementos por ubicar» y en la pestaña de Objetos; destildado (default) = ARQUITECTURA del espacio, excluida de raíz.', verbose_name='Declarado como Mueble Móvil / Objeto'),
        ),
        migrations.RunPython(reset_declarado_movible, sin_reversion),
    ]
