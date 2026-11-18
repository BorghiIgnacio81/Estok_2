"""
FIX · Las CAJAS dejan de ser formas 2D del plano de la habitación.

MOTIVO
    El lienzo 2D del cuarto dibujaba como bloque/forma arquitectónica TODO
    contenedor raíz, incluidas las CAJAS. Si una caja se creaba sin `tipo`
    explícito y con coordenadas de grilla (`parent_grid_row/col`),
    `services/taxonomia_contenedor.inferir_tipo_contenedor` la clasificaba como
    MUEBLE_MOVIL (regla de las coordenadas de grilla) y quedaba guardada como
    NODO DE DIVISIÓN ESPACIAL: el operador la veía como un bloque del suelo
    («Caja 06» dentro de la «Habitación de atrás») en lugar de como caja del
    inventario.

REGLA (idempotente y NO destructiva)
    Todo Contenedor RAÍZ (`parent_contenedor IS NULL`) cuyo rótulo EMPIEZA por
    «Caja»/«Cajas» —patrón canónico `PATRON_NOMBRE_CAJA` del backend— y que
    todavía NO sea una CAJA pura (`tipo != 'CAJA'` o `es_inmueble = True`) se
    normaliza a su naturaleza real de bulto de inventario:

      · tipo          = 'CAJA'
      · es_inmueble   = False
      · parent_grid_row / parent_grid_col = NULL  (libera el casillero del cuarto)
      · fusion_grupo  = NULL                      (no es una fusión en «L»)
      · ui_left/ui_top  = '0%'    · ui_width = '100%'   · ui_height = 'auto'
        (default del modelo: sin coordenada de dibujo 2D en la habitación)

    La UBICACIÓN FÍSICA (`ubicacion_id` = habitación) y el CONTENIDO (objetos y
    sub-contenedores) NO se tocan: la caja sigue colgando del mismo cuarto y sus
    objetos conservan su FK. Los registros ya correctos se omiten, así que la
    migración puede correrse sobre bases parcialmente reparadas.

    El reverse es `noop`: es una reparación de integridad, no un cambio
    reversible de esquema.
"""

import re

from django.db import migrations

# Duplicado a propósito: una migración no debe depender de código vivo (espejo
# de `inventario/services/taxonomia_contenedor.PATRON_NOMBRE_CAJA`).
PATRON_NOMBRE_CAJA = re.compile(r'^\s*cajas?', re.IGNORECASE)

TIPO_CAJA = 'CAJA'

# Valores por defecto del modelo `Contenedor` para la geometría elástica.
GEOMETRIA_SIN_PLANO = {
    'ui_left': '0%',
    'ui_top': '0%',
    'ui_width': '100%',
    'ui_height': 'auto',
}

# Tamaño del lote de UPDATE (evita un `pk__in` gigante en el motor de base).
TAMANO_LOTE = 500


def _necesita_reparacion(nombre, tipo, es_inmueble):
    """¿Es una caja raíz guardada como nodo de división espacial?"""
    if not PATRON_NOMBRE_CAJA.match(str(nombre or '').strip()):
        return False
    return tipo != TIPO_CAJA or bool(es_inmueble)


def normalizar_cajas_raiz(apps, schema_editor):
    """Convierte las cajas descalzadas en CAJAS puras, sin geometría de plano."""
    Contenedor = apps.get_model('inventario', 'Contenedor')

    pendientes = []
    filas = (
        Contenedor.objects
        .filter(parent_contenedor__isnull=True)
        .values_list('pk', 'nombre', 'tipo', 'es_inmueble')
        .iterator(chunk_size=1000)
    )
    for pk, nombre, tipo, es_inmueble in filas:
        if not _necesita_reparacion(nombre, tipo, es_inmueble):
            continue
        pendientes.append(pk)
        if len(pendientes) >= TAMANO_LOTE:
            Contenedor.objects.filter(pk__in=pendientes).update(
                tipo=TIPO_CAJA,
                es_inmueble=False,
                parent_grid_row=None,
                parent_grid_col=None,
                fusion_grupo=None,
                **GEOMETRIA_SIN_PLANO,
            )
            pendientes = []

    if pendientes:
        Contenedor.objects.filter(pk__in=pendientes).update(
            tipo=TIPO_CAJA,
            es_inmueble=False,
            parent_grid_row=None,
            parent_grid_col=None,
            fusion_grupo=None,
            **GEOMETRIA_SIN_PLANO,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0040_ventaobjeto'),
    ]

    operations = [
        migrations.RunPython(normalizar_cajas_raiz, migrations.RunPython.noop),
    ]
