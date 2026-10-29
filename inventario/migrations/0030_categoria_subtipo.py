"""
Campo `Categoria.subtipo`: familia de atributos técnicos del objeto.

Motivo: el formulario (alta y edición) decidía qué campos técnicos mostrar
comparando el NOMBRE de la categoría en el navegador. Con este campo la
asociación es EXPLÍCITA y viaja por la API: «Ropa» despliega Talla/Tamaño sin
depender del texto del nombre.

Incluye un backfill idempotente para las filas existentes (las 11 oficiales,
«Ropa»/«Libros» y categorías de usuario con pistas reconocibles). El frontend
conserva el fallback por nombre para filas que queden sin subtipo.
"""

import unicodedata

from django.db import migrations, models

# Debe coincidir con SUBTIPOS_CATEGORIA de inventario/models/clasificacion.py.
SUBTIPOS_CATEGORIA = (
    ('libro', 'Libro / Revista'),
    ('tecnologia', 'Tecnología'),
    ('mueble_arte', 'Mueble / Arte'),
    ('ropa', 'Ropa'),
)
SUBTIPOS_VALIDOS = {clave for clave, _ in SUBTIPOS_CATEGORIA}

# Snapshot congelado de las reglas de inferencia (no importar el servicio:
# las migraciones deben seguir funcionando aunque el código evolucione).
EXACTOS = {
    'libro': 'libro', 'libros': 'libro', 'revista': 'libro',
    'revistas': 'libro', 'comic': 'libro', 'comics': 'libro',
    'ropa': 'ropa', 'calzado': 'ropa', 'indumentaria': 'ropa',
    'mueble': 'mueble_arte', 'muebles': 'mueble_arte',
    'silla': 'mueble_arte', 'sillas': 'mueble_arte',
    'sillon': 'mueble_arte', 'sillones': 'mueble_arte',
    'mesa': 'mueble_arte', 'mesas': 'mueble_arte',
    'escritorio': 'mueble_arte', 'escritorios': 'mueble_arte',
    'estante': 'mueble_arte', 'estantes': 'mueble_arte',
    'estanteria': 'mueble_arte', 'estanterias': 'mueble_arte',
    'arte': 'mueble_arte', 'antiguedad': 'mueble_arte',
    'antiguedades': 'mueble_arte', 'coleccionables': 'mueble_arte',
    'hogar': 'mueble_arte', 'cocina': 'mueble_arte',
    'jardin': 'mueble_arte', 'herramientas': 'mueble_arte',
    'materiales': 'mueble_arte', 'decoracion': 'mueble_arte',
    'electronica': 'tecnologia', 'computacion': 'tecnologia',
    'informatica': 'tecnologia', 'tecnologia': 'tecnologia',
}
PISTAS = (
    ('libro', 'libro'), ('revista', 'libro'), ('comic', 'libro'),
    ('ropa', 'ropa'), ('calzado', 'ropa'), ('indumentaria', 'ropa'),
    ('electron', 'tecnologia'), ('comput', 'tecnologia'),
    ('informatic', 'tecnologia'), ('celular', 'tecnologia'),
    ('tecnolog', 'tecnologia'), ('mueble', 'mueble_arte'),
    ('silla', 'mueble_arte'), ('sillon', 'mueble_arte'),
    ('mesa', 'mueble_arte'), ('escritorio', 'mueble_arte'),
    ('estante', 'mueble_arte'), ('arte', 'mueble_arte'),
    ('antiguedad', 'mueble_arte'), ('coleccion', 'mueble_arte'),
    ('hogar', 'mueble_arte'), ('cocina', 'mueble_arte'),
    ('jardin', 'mueble_arte'), ('herramienta', 'mueble_arte'),
    ('material', 'mueble_arte'), ('decoracion', 'mueble_arte'),
)


def _normalizar(texto):
    limpio = unicodedata.normalize('NFD', str(texto or ''))
    limpio = ''.join(c for c in limpio if unicodedata.category(c) != 'Mn')
    return ' '.join(limpio.lower().split())


def _inferir(nombre):
    clave = _normalizar(nombre)
    if not clave:
        return ''
    if clave in EXACTOS:
        return EXACTOS[clave]
    for fragmento, subtipo in PISTAS:
        if fragmento in clave:
            return subtipo
    return ''


def backfill_subtipos(apps, schema_editor):
    """Completa `subtipo` en las categorías que aún no lo tienen."""
    Categoria = apps.get_model('inventario', 'Categoria')
    pendientes = Categoria.objects.exclude(subtipo__in=SUBTIPOS_VALIDOS)
    for categoria in pendientes.only('id', 'nombre', 'subtipo').iterator():
        inferido = _inferir(categoria.nombre)
        if inferido:
            Categoria.objects.filter(pk=categoria.pk).update(subtipo=inferido)


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0029_mercadolibrepublicacion'),
    ]

    operations = [
        migrations.AddField(
            model_name='categoria',
            name='subtipo',
            field=models.CharField(
                blank=True,
                choices=SUBTIPOS_CATEGORIA,
                default='',
                help_text=(
                    'Familia de atributos técnicos que despliega el formulario '
                    '(libro, tecnologia, mueble_arte, ropa). Vacío = sin atributos.'
                ),
                max_length=20,
                verbose_name='Subtipo de objeto',
            ),
        ),
        migrations.RunPython(backfill_subtipos, migrations.RunPython.noop),
    ]
