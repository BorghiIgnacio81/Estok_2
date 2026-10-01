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

import re

from django.db import migrations, models


# ---------------------------------------------------------------------------
# TAXONOMÍA HISTÓRICA CONGELADA (MUEBLE / CAJA / ESTANTE).
#
# Esta migración NO importa el servicio vivo `services.taxonomia_contenedor`:
# ese servicio evolucionó a los 5 tipos estrictos (migración 0024) y una
# migración ya aplicada debe quedar AUTOCONTENIDA y reproducible en cualquier
# base nueva (si importara el servicio vivo, una instalación desde cero
# rompería al invocar la función con la firma antigua).
# ---------------------------------------------------------------------------
TIPO_MUEBLE_LEGACY = 'MUEBLE'
TIPO_CAJA_LEGACY = 'CAJA'
TIPO_ESTANTE_LEGACY = 'ESTANTE'

_RE_NOMBRE_MUEBLE = re.compile(r'^mueble(\s|$)', re.IGNORECASE)
_RE_NOMBRE_ESTANTE = re.compile(
    r'^(estante|estanter[ií]a|cajonera|caj[oó]n)(\s|$)', re.IGNORECASE,
)


def _inferir_tipo_legacy(
    nombre, es_inmueble, parent_id, parent_grid_row, parent_grid_col,
    tiene_hijos, parent_es_raiz,
):
    """Réplica congelada de la regla de clasificación vigente en 0020."""
    if es_inmueble:
        return TIPO_MUEBLE_LEGACY

    if tiene_hijos:
        return TIPO_MUEBLE_LEGACY if not parent_id else TIPO_ESTANTE_LEGACY

    texto = str(nombre or '').strip()
    if _RE_NOMBRE_MUEBLE.match(texto):
        return TIPO_MUEBLE_LEGACY
    if _RE_NOMBRE_ESTANTE.match(texto):
        return TIPO_ESTANTE_LEGACY

    if parent_id:
        return TIPO_CAJA_LEGACY if parent_es_raiz is True else TIPO_ESTANTE_LEGACY

    if parent_grid_row is not None or parent_grid_col is not None:
        return TIPO_MUEBLE_LEGACY

    return TIPO_CAJA_LEGACY


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
        tipo = _inferir_tipo_legacy(
            f['nombre'], f['es_inmueble'], pid,
            f['parent_grid_row'], f['parent_grid_col'],
            hijos_por_padre.get(f['id'], 0) > 0,
            (pid is None or pid not in con_padre),
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
