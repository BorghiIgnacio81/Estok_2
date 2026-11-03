"""
FIX RETROACTIVO · Toda CAJA existente queda con `es_contenedor = True`.

MOTIVO
    La clasificación de las cajas dependía de una casilla manual
    (`Objeto.es_contenedor`). Los registros creados sin marcarla —aunque su
    categoría fuera «Cajas y Contenedores» o su nombre empezara por «Caja»—
    se devolvían como OBJETOS SUELTOS y desaparecían de las pestañas de cajas
    de la canasta y de la sección «📦 Cajas e Inventario Interno».

REGLA (idempotente y NO destructiva: sólo completa lo que falta)
    `es_contenedor = True` para todo Objeto que cumpla AL MENOS una condición:
      · Su RÓTULO empieza por «Caja»/«Cajas» («Caja 02», «Cajas 03», «Caja de
        herramientas»…).
      · Su CATEGORÍA es «Cajas y Contenedores» (variantes «Cajas /
        Contenedores», «Cajas/Contenedor» incluidas).
      · El ALTA RÁPIDA lo declaró caja (`especificaciones.alta_rapida='caja'`).

    NO se toca ninguna otra columna (ni la categoría, ni la ubicación, ni la
    jerarquía espacial) y se OMITEN los espejos de dualidad Contenedor⇄Objeto
    (`especificaciones.es_espejo_contenedor`): su caja real ya existe como
    `Contenedor` y marcarlos duplicaría el bulto en las pestañas.

    Los registros ya marcados no se reescriben (filtro `es_contenedor=False`),
    así que la migración se puede aplicar sobre bases parcialmente corregidas.
"""

import re

from django.db import migrations

# Duplicados a propósito: una migración no debe depender de código vivo
# (espejo de `services/taxonomia_contenedor.py`).
PATRON_PREFIJO_CAJA = re.compile(r'^\s*cajas?', re.IGNORECASE)
PATRON_CATEGORIA_CAJA = re.compile(
    r'^cajas?\s*(?:y|/)\s*contenedores?$', re.IGNORECASE,
)

# Valor de `especificaciones.alta_rapida` que declara el objeto como CAJA.
ALTA_RAPIDA_CAJA = 'caja'

# Tamaño del lote de UPDATE (evita un `pk__in` gigante en el motor de base).
TAMANO_LOTE = 500


def _declara_contenedor(nombre, categoria_nombre, especificaciones):
    """Regla única de la migración (espejo de `declara_contenedor` del servicio)."""
    especificaciones = especificaciones or {}
    if especificaciones.get('es_espejo_contenedor'):
        return False
    if especificaciones.get('alta_rapida') == ALTA_RAPIDA_CAJA:
        return True
    if PATRON_PREFIJO_CAJA.match(str(nombre or '').strip()):
        return True
    return bool(PATRON_CATEGORIA_CAJA.match(str(categoria_nombre or '').strip()))


def marcar_cajas_como_contenedor(apps, schema_editor):
    """Marca `es_contenedor=True` en todas las cajas ya existentes."""
    Objeto = apps.get_model('inventario', 'Objeto')

    pendientes = []
    filas = (
        Objeto.objects
        .filter(es_contenedor=False)
        .values_list('pk', 'nombre', 'categoria__nombre', 'especificaciones')
        .iterator(chunk_size=1000)
    )
    for pk, nombre, categoria_nombre, especificaciones in filas:
        if not _declara_contenedor(nombre, categoria_nombre, especificaciones):
            continue
        pendientes.append(pk)
        if len(pendientes) >= TAMANO_LOTE:
            Objeto.objects.filter(pk__in=pendientes).update(es_contenedor=True)
            pendientes = []

    if pendientes:
        Objeto.objects.filter(pk__in=pendientes).update(es_contenedor=True)


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0032_cajas_objeto_contenedor'),
    ]

    operations = [
        migrations.RunPython(marcar_cajas_como_contenedor, migrations.RunPython.noop),
    ]
