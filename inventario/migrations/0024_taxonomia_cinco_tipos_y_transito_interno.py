# Taxonomía estricta de 5 tipos físicos + estado «En Tránsito Interno».
#
# 1) `Contenedor.tipo` pasa de 3 valores (MUEBLE / CAJA / ESTANTE) a los 5
#    tipos físicos obligatorios:
#       CONJUNTO        → conjunto/estructura interna del mueble (ex-ESTANTE).
#       MUEBLE_INMUEBLE → mueble fijo del cuarto (ex-MUEBLE con es_inmueble).
#       MUEBLE_MOVIL    → mueble mudable (ex-MUEBLE sin es_inmueble).
#       CAJA            → contenedor móvil de inventario (sin cambios).
#       OBJETO          → ítem fino suelto.
# 2) Backfill DETERMINISTA (renombre 1:1, SIN heurísticas): la clasificación
#    histórica ya fue resuelta por la migración 0020, así que este paso NO
#    vuelve a inferir nada: sólo traduce el vocabulario viejo al nuevo.
# 3) `en_transito_interno` en Contenedor y Objeto: flag del evento onDrop
#    dentro de un mueble anfitrión con sub-divisiones internas, sin estante
#    definitivo (ver inventario/services/transito_interno.py).

from django.db import migrations, models

# Mapa de traducción del vocabulario histórico al de 5 tipos.
# `MUEBLE` se resuelve en función de `es_inmueble` (ver `_nuevo_tipo`).
MAPA_TIPO_NUEVO = {
    'MUEBLE_INMUEBLE': 'MUEBLE_INMUEBLE',
    'MUEBLE_MOVIL': 'MUEBLE_MOVIL',
    'CONJUNTO': 'CONJUNTO',
    'CAJA': 'CAJA',
    'OBJETO': 'OBJETO',
    'ESTANTE': 'CONJUNTO',
}

# Mapa inverso (para el reverse de la migración).
MAPA_TIPO_LEGACY = {
    'CONJUNTO': 'ESTANTE',
    'MUEBLE_INMUEBLE': 'MUEBLE',
    'MUEBLE_MOVIL': 'MUEBLE',
    'CAJA': 'CAJA',
    'OBJETO': 'CAJA',
}


def _nuevo_tipo(tipo, es_inmueble):
    """Traduce un `tipo` histórico al tipo nuevo de 5 valores."""
    if tipo == 'MUEBLE':
        return 'MUEBLE_INMUEBLE' if es_inmueble else 'MUEBLE_MOVIL'
    return MAPA_TIPO_NUEVO.get(tipo, 'CAJA')


def backfill_taxonomia_cinco_tipos(apps, schema_editor):
    """Reescribe el `tipo` de todo el inventario al vocabulario de 5 tipos."""
    Contenedor = apps.get_model('inventario', 'Contenedor')
    filas = Contenedor.objects.all().only('id', 'tipo', 'es_inmueble')
    for fila in filas.iterator():
        nuevo = _nuevo_tipo(fila.tipo, fila.es_inmueble)
        cambios = {}
        if nuevo != fila.tipo:
            cambios['tipo'] = nuevo
        # Regla de física: MUEBLE_INMUEBLE fuerza es_inmueble=True.
        if nuevo == 'MUEBLE_INMUEBLE' and not fila.es_inmueble:
            cambios['es_inmueble'] = True
        if cambios:
            Contenedor.objects.filter(pk=fila.pk).update(**cambios)


def revertir_taxonomia_cinco_tipos(apps, schema_editor):
    """Devuelve el inventario al vocabulario histórico de 3 tipos."""
    Contenedor = apps.get_model('inventario', 'Contenedor')
    filas = Contenedor.objects.all().only('id', 'tipo')
    for fila in filas.iterator():
        legacy = MAPA_TIPO_LEGACY.get(fila.tipo, 'CAJA')
        if legacy != fila.tipo:
            Contenedor.objects.filter(pk=fila.pk).update(tipo=legacy)


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0023_rename_categoria_mercadolibre_category_id'),
    ]

    operations = [
        migrations.AddField(
            model_name='contenedor',
            name='en_transito_interno',
            field=models.BooleanField(default=False, help_text='Activo cuando el elemento fue soltado dentro de un mueble con sub-divisiones internas SIN indicar un estante/casillero concreto. Se limpia al ubicarlo de forma fina.', verbose_name='En tránsito interno'),
        ),
        migrations.AddField(
            model_name='objeto',
            name='en_transito_interno',
            field=models.BooleanField(default=False, help_text='Activo cuando el objeto fue soltado dentro de un mueble con sub-divisiones internas SIN indicar un estante/casillero concreto.', verbose_name='En tránsito interno'),
        ),
        migrations.AlterField(
            model_name='contenedor',
            name='tipo',
            field=models.CharField(choices=[('CONJUNTO', 'Conjunto / estructura interna'), ('MUEBLE_INMUEBLE', 'Mueble inmueble (fijo al cuarto)'), ('MUEBLE_MOVIL', 'Mueble móvil (mudable)'), ('CAJA', 'Caja móvil de inventario'), ('OBJETO', 'Objeto suelto (ítem fino)')], db_index=True, default='CAJA', help_text='Taxonomía de 5 tipos físicos: CONJUNTO (estructura interna del mueble), MUEBLE_INMUEBLE (fijo al cuarto, fuerza es_inmueble=True), MUEBLE_MOVIL (mudable), CAJA (contenedor móvil) u OBJETO (ítem fino suelto).', max_length=16, verbose_name='Tipo de contenedor'),
        ),
        migrations.RunPython(
            backfill_taxonomia_cinco_tipos,
            revertir_taxonomia_cinco_tipos,
        ),
    ]
