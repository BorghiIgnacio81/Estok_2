"""
Normaliza la exclusividad de la foto principal en FotoObjeto.

Motivo: `PATCH /api/fotos/<id>/` escribía `es_principal=True` sin degradar a la
anterior, así que pulsar «Hacer principal» sobre una foto secundaria dejaba DOS
portadas por objeto (dos badges «★ PRINCIPAL» en la galería y la portada de los
listados sin actualizarse). El modelo ya garantiza la exclusividad en
`FotoObjeto.save()`; esta migración repara los datos que quedaron corruptos:
por cada objeto con más de una principal se conserva la marca MÁS RECIENTE
(la última foto subida entre las principales) y se degradan las demás.

Idempotente: si no hay duplicados no toca nada.
"""

from django.db import migrations
from django.db.models import Count


def normalizar_principales(apps, schema_editor):
    FotoObjeto = apps.get_model('inventario', 'FotoObjeto')
    duplicados = list(
        FotoObjeto.objects.filter(es_principal=True)
        .values('objeto_id')
        .annotate(total=Count('pk'))
        .filter(total__gt=1)
    )
    for grupo in duplicados:
        principales = FotoObjeto.objects.filter(
            objeto_id=grupo['objeto_id'], es_principal=True,
        ).order_by('-fecha_subida', '-pk')
        conservar = principales.values_list('pk', flat=True).first()
        FotoObjeto.objects.filter(
            objeto_id=grupo['objeto_id'], es_principal=True,
        ).exclude(pk=conservar).update(es_principal=False)


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0030_categoria_subtipo'),
    ]

    operations = [
        migrations.RunPython(normalizar_principales, migrations.RunPython.noop),
    ]
