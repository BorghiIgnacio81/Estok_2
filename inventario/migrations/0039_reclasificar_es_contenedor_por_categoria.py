"""
RECLASIFICACIÓN RETROACTIVA · `es_contenedor = False` en objetos que NO son cajas.

MOTIVO
    Objetos comunes quedaron con `Objeto.es_contenedor = True` por lecturas
    históricas de la categoría y se listaban como tarjetas de la sección
    «📦 Cajas e Inventario Interno» de /objetos. Casos reales en producción:

        · «Mesa de madera para exterior»  (categoría Muebles)    → figuraba como caja.
        · «Mesa redonda de jardín»        (categoría Muebles)    → figuraba como caja.
        · «Escalera plegable de aluminio» (categoría Materiales) → figuraba como caja.
        · Bicicletas, sillones, GPS, cargadores, parrilla… (Jardín / Electrónica /
          Coleccionables) → figuraban como cajas.

REGLA (idempotente y NO destructiva)
    Recorre los Objetos con `es_contenedor=True` y APAGA el flag cuando el
    registro NO declara ser un bulto contenedor. Se CONSERVA encendido si:

      1. Su categoría es EXPLÍCITAMENTE contenedora («Cajas y Contenedores»,
         «Cajas / Contenedores», «Cajas», «Baúles», «Organizadores», «Maletas»,
         «Valijas», «Canastos»).
      2. Su rótulo EMPIEZA por «Caja»/«Cajas» («Caja 02», «Caja de herramientas»):
         el nombre es una declaración explícita del operador.
      3. El alta rápida lo declaró caja (`especificaciones.alta_rapida='caja'`).

    Es la MISMA regla de `services/clasificacion_contenedor_objeto.
    declara_contenedor` (duplicada a propósito: una migración no debe depender
    del código vivo). Los espejos de dualidad Contenedor⇄Objeto
    (`especificaciones.es_espejo_contenedor`) NUNCA son cajas: se apagan.

    SÓLO se modifica la columna `es_contenedor`. No se toca la categoría, la
    ubicación, la jerarquía espacial (`contenedor` / `objeto_padre`), las fotos
    ni las especificaciones. La escritura usa `QuerySet.update()`, que NO dispara
    `post_save`: la señal de coherencia no puede re-encender el flag apagado.

RESULTADO ESPERADO
    «Caja 01» conserva su marca. Todo el resto del inventario real (muebles,
    materiales, herramientas, electrónica, jardín, coleccionables) pasa a
    `es_contenedor=False` y deja de ocupar una tarjeta de caja.

REVERSA
    No es reversible: el valor anterior no es deducible. `RunPython.noop`.
"""

import re

from django.db import migrations

# ---------------------------------------------------------------------------
# Reglas ESPEJO de `services/taxonomia_contenedor.py` y
# `services/clasificacion_contenedor_objeto.py` (sin importar código vivo).
# ---------------------------------------------------------------------------

# Nombres normalizados (minúsculas, sin tildes) de las categorías que declaran
# bultos contenedores.
NOMBRES_CATEGORIA_CONTENEDOR = (
    'cajas y contenedores',
    'cajas y contenedor',
    'cajas / contenedores',
    'cajas/contenedores',
    'contenedores',
    'contenedor',
    'organizadores',
    'organizador',
    'cajas',
    'caja',
    'baules',
    'baul',
    'maletas',
    'maleta',
    'valijas',
    'valija',
    'canastos',
    'canasto',
)

# Cada vocal admite su versión acentuada («Baúles»/«Baules»).
_VOCAL_TOLERANTE = {
    'a': '[aá]', 'e': '[eé]', 'i': '[ií]', 'o': '[oó]', 'u': '[uú]',
}


def _variante_regex(nombre):
    """Regex de un nombre normalizado, tolerante a tildes y espacios múltiples."""
    partes = []
    for caracter in nombre:
        if caracter == ' ':
            partes.append(r'\s+')
            continue
        partes.append(_VOCAL_TOLERANTE.get(caracter, re.escape(caracter)))
    return ''.join(partes)


RE_CATEGORIA_CONTENEDOR = re.compile(
    r'^\s*(?:%s)\s*$' % '|'.join(
        _variante_regex(nombre) for nombre in NOMBRES_CATEGORIA_CONTENEDOR
    ),
    re.IGNORECASE,
)
RE_NOMBRE_CAJA = re.compile(r'^\s*cajas?', re.IGNORECASE)

# Valor de `especificaciones.alta_rapida` que declara el objeto como CAJA.
ALTA_RAPIDA_CAJA = 'caja'

# Tamaño del lote de UPDATE (evita un `pk__in` gigante en el motor de base).
TAMANO_LOTE = 500


def _declara_contenedor(nombre, categoria_nombre, especificaciones):
    """Misma regla que `clasificacion_contenedor_objeto.declara_contenedor`."""
    especificaciones = especificaciones or {}
    if especificaciones.get('es_espejo_contenedor'):
        return False
    if especificaciones.get('alta_rapida') == ALTA_RAPIDA_CAJA:
        return True
    if RE_NOMBRE_CAJA.match(str(nombre or '').strip()):
        return True
    return bool(RE_CATEGORIA_CONTENEDOR.match(str(categoria_nombre or '').strip()))


def apagar_contenedor_no_declarado(apps, schema_editor):
    """Apaga `es_contenedor` en todo Objeto que no declare ser contenedor."""
    Objeto = apps.get_model('inventario', 'Objeto')

    pendientes = []
    filas = (
        Objeto.objects
        .filter(es_contenedor=True)
        .values_list('pk', 'nombre', 'categoria__nombre', 'especificaciones')
        .iterator(chunk_size=1000)
    )
    for pk, nombre, categoria_nombre, especificaciones in filas:
        if _declara_contenedor(nombre, categoria_nombre, especificaciones):
            continue
        pendientes.append(pk)
        if len(pendientes) >= TAMANO_LOTE:
            Objeto.objects.filter(pk__in=pendientes).update(es_contenedor=False)
            pendientes = []

    if pendientes:
        Objeto.objects.filter(pk__in=pendientes).update(es_contenedor=False)


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0038_planes_familiar_empresas'),
    ]

    operations = [
        migrations.RunPython(
            apagar_contenedor_no_declarado, migrations.RunPython.noop,
        ),
    ]
