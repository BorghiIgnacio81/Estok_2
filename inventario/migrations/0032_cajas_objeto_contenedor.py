"""
Reconoce como CAJA a los Objetos cuyo rótulo es el de una caja numerada.

MOTIVO
    El alta rápida creó las «Cajas 02…05» como `Objeto` SIN la marca
    `es_contenedor` y sin categoría, así que la API las devolvía como objetos
    sueltos y la canasta de «Elementos por ubicar» no las listaba en las
    pestañas de cajas. La coherencia ya se aplica en cada escritura
    (`services/clasificacion_contenedor_objeto` + señal post_save); esta
    migración repara los registros que nunca volvieron a guardarse.

NO DESTRUCTIVA E IDEMPOTENTE: sólo completa lo que falta.
    · `es_contenedor = True` para todo Objeto con rótulo «Caja NN» / «Cajas NN».
    · Categoría «Cajas y Contenedores» del Estok SÓLO si el objeto no tenía
      categoría (jamás pisa una elegida por el operador).
    · Los espejos de dualidad Contenedor⇄Objeto se omiten: su caja real ya
      existe como `Contenedor` y marcarlos duplicaría el bulto en la canasta.
"""

import re

from django.db import migrations

# Mismo patrón que `services/taxonomia_contenedor.PATRON_NOMBRE_CAJA`
# (duplicado a propósito: una migración no debe depender de código vivo).
PATRON_NOMBRE_CAJA = re.compile(r'^cajas?\s*0*\d+$', re.IGNORECASE)
NOMBRE_CATEGORIA = 'Cajas y Contenedores'
ICONO_CATEGORIA = '📦'
ML_CATEGORIA = 'MLA1574'


def _categoria_contenedor(Categoria, estok_id):
    """Categoría «Cajas y Contenedores» del Estok (la crea si faltara)."""
    if estok_id is None:
        return None
    fila = Categoria.objects.filter(
        estok_id=estok_id, nombre__iexact=NOMBRE_CATEGORIA,
    ).first()
    if fila is not None:
        return fila
    return Categoria.objects.create(
        estok_id=estok_id,
        nombre=NOMBRE_CATEGORIA,
        icono=ICONO_CATEGORIA,
        mercadolibre_category_id=ML_CATEGORIA,
        subtipo='',
        es_contenedor=True,
        es_sistema=False,
    )


def reconocer_cajas_objeto(apps, schema_editor):
    """Marca `es_contenedor` y completa la categoría de las cajas numeradas."""
    Objeto = apps.get_model('inventario', 'Objeto')
    Categoria = apps.get_model('inventario', 'Categoria')

    categorias = {}
    for objeto in Objeto.objects.all().only(
        'pk', 'nombre', 'es_contenedor', 'categoria_id', 'estok_id', 'especificaciones',
    ).iterator():
        if not PATRON_NOMBRE_CAJA.match(str(objeto.nombre or '').strip()):
            continue
        if (objeto.especificaciones or {}).get('es_espejo_contenedor'):
            continue

        campos = []
        if not objeto.es_contenedor:
            objeto.es_contenedor = True
            campos.append('es_contenedor')
        if objeto.categoria_id is None and objeto.estok_id is not None:
            estok_id = objeto.estok_id
            if estok_id not in categorias:
                categorias[estok_id] = _categoria_contenedor(Categoria, estok_id)
            if categorias[estok_id] is not None:
                objeto.categoria_id = categorias[estok_id].pk
                campos.append('categoria')
        if campos:
            objeto.save(update_fields=campos)


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0031_foto_principal_unica'),
    ]

    operations = [
        migrations.RunPython(reconocer_cajas_objeto, migrations.RunPython.noop),
    ]
