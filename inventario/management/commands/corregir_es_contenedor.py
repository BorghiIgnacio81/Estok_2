"""
REPARACIÓN DE `Objeto.es_contenedor` MAL MARCADO POR CATEGORÍA.

PROBLEMA QUE RESUELVE
    Hasta este fix, la clasificación de caja leía `Categoria.es_contenedor`
    (campo que en realidad significa «categoría de Mercado Libre que contiene
    subcategorías» y que la siembra oficial deja en True para TODAS las
    categorías del Estok). Resultado: cualquier objeto con categoría nacía con
    `es_contenedor=True` y el listado lo agrupaba en «📦 Cajas e Inventario
    Interno». Casos reales reportados:

        · «Escalera» (categoría Materiales)      → figuraba como caja.
        · «Mesa»     (categoría Muebles)         → figuraba como caja.

REGLA DE REPARACIÓN (una sola, la misma del alta)
    Se apaga `es_contenedor` en todo Objeto que NO declare ser contenedor según
    `services.clasificacion_contenedor_objeto.declara_contenedor`:
      · categoría «Cajas y Contenedores» / «Cajas» / «Baúles» / «Organizadores»…
      · rótulo que EMPIEZA por «Caja» («Caja 02»),
      · alta rápida marcada como caja (`especificaciones.alta_rapida='caja'`).

    Todo lo demás vuelve a `es_contenedor=False` y, por lo tanto, al bloque que
    le corresponde en /objetos: «🧸 Objetos Sueltos o sin Caja» si no tiene
    ubicación, o «📦 Objetos en Contenedor» si vive dentro de un mueble/caja.

    NO se toca ninguna otra columna: ni la categoría, ni la ubicación, ni la
    jerarquía (`contenedor` / `objeto_padre`), ni las fotos. La escritura usa
    `QuerySet.update()`, que NO dispara señales post_save (la reparación no
    puede re-marcarse a sí misma).

USO
    # 1) Ver el plan sin escribir nada (SIEMPRE primero en producción):
    python manage.py corregir_es_contenedor --dry-run

    # 2) Aplicar sólo a un Estok:
    python manage.py corregir_es_contenedor --estok <UUID> --yes

    # 3) Aplicar a todos los Estok (entorno no interactivo, p. ej. contenedor):
    python manage.py corregir_es_contenedor --yes

    Sin `--yes`, en una terminal interactiva pide confirmación. En un entorno
    no interactivo (contenedor/CI) exige `--yes` explícito para no colgarse.
"""

import sys

from django.core.management.base import BaseCommand
from django.db import transaction

from inventario.models import Objeto
from inventario.services.clasificacion_contenedor_objeto import declara_contenedor

# Tamaño del lote de UPDATE (evita un `pk__in` gigante en el motor de base).
TAMANO_LOTE = 500

# Ejemplos que se muestran en el reporte.
MAX_EJEMPLOS = 10


def _titulo(texto):
    """Encabezado legible de bloque dentro del reporte de consola."""
    limpio = str(texto or '').strip()
    return '\n=== %s %s' % (limpio, '=' * max(0, 58 - len(limpio)))


def _nombre_categoria(objeto):
    """Nombre de la categoría del objeto (o «(sin categoría)»)."""
    categoria = objeto.categoria
    nombre = getattr(categoria, 'nombre', '') if categoria is not None else ''
    return nombre or '(sin categoría)'


def _bloque_destino(objeto):
    """
    Bloque del listado /objetos al que vuelve el objeto al apagar el flag.

    Es la consecuencia visible de la reparación (no se persiste nada distinto
    del flag): con ubicación/contenedor/padre ⇒ «Objetos en Contenedor»;
    sin ninguno de los tres ⇒ «Objetos Sueltos o sin Caja».
    """
    if objeto.contenedor_id or objeto.ubicacion_id or objeto.objeto_padre_id:
        return 'Objetos en Contenedor'
    return 'Objetos Sueltos o sin Caja'


class Command(BaseCommand):
    help = (
        'Apaga Objeto.es_contenedor en los objetos que NO son cajas/baúles/'
        'organizadores (mesas, escaleras, herramientas…), devolviéndolos a '
        '«Objetos Sueltos» o «Objetos en Contenedor».'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--estok', type=str, default=None,
            help='Limita la reparación al Estok indicado (UUID).',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Muestra el plan completo sin escribir en la base.',
        )
        parser.add_argument(
            '--yes', action='store_true',
            help='Omite la confirmación interactiva (entornos no interactivos).',
        )

    # ------------------------------------------------------------------ helpers
    def _candidatos(self, estok_id):
        """Objetos marcados como contenedor, con su categoría ya cargada."""
        qs = (
            Objeto.objects
            .filter(es_contenedor=True)
            .select_related('categoria')
            .order_by('nombre')
        )
        if estok_id:
            qs = qs.filter(estok_id=estok_id)
        return list(qs)

    def _reporte_por_categoria(self, objetos):
        """Conteo de objetos a corregir agrupado por nombre de categoría."""
        conteo = {}
        for objeto in objetos:
            clave = _nombre_categoria(objeto)
            conteo[clave] = conteo.get(clave, 0) + 1
        return sorted(conteo.items(), key=lambda par: (-par[1], par[0]))

    # ------------------------------------------------------------------ comando
    def handle(self, *args, **options):
        dry_run = options['dry_run']
        estok_id = (options['estok'] or '').strip() or None

        self.stdout.write(_titulo('DIAGNÓSTICO'))
        self.stdout.write('  estok : %s' % (estok_id or '(todos)'))
        self.stdout.write('  modo  : %s'
                          % ('DRY RUN (sin cambios)' if dry_run else 'APLICAR'))

        marcados = self._candidatos(estok_id)
        if not marcados:
            self.stdout.write(self.style.SUCCESS(
                '\nNo hay objetos con es_contenedor=True: nada que reparar.'
            ))
            return

        legitimos = []
        a_corregir = []
        for objeto in marcados:
            if declara_contenedor(
                objeto.nombre, objeto.categoria, objeto.especificaciones,
            ):
                legitimos.append(objeto)
            else:
                a_corregir.append(objeto)

        self.stdout.write(_titulo('RESULTADO'))
        self.stdout.write('  objetos con es_contenedor=True : %d' % len(marcados))
        self.stdout.write('  legítimos (caja/baúl/rótulo)  : %d' % len(legitimos))
        self.stdout.write('  a corregir a False             : %d' % len(a_corregir))

        if not a_corregir:
            self.stdout.write(self.style.SUCCESS(
                '\nTodos los objetos marcados son contenedores reales: '
                'no se modifica nada.'
            ))
            return

        self.stdout.write(_titulo('CORRECCIONES POR CATEGORÍA'))
        for nombre, cantidad in self._reporte_por_categoria(a_corregir):
            self.stdout.write('  %-32s %d' % (nombre, cantidad))

        self.stdout.write(_titulo('PRIMEROS %d OBJETOS A CORREGIR' % MAX_EJEMPLOS))
        for objeto in a_corregir[:MAX_EJEMPLOS]:
            self.stdout.write(
                '  %r  [%s]  -> %s'
                % (objeto.nombre, _nombre_categoria(objeto), _bloque_destino(objeto))
            )

        self.stdout.write(
            '\n  Se apaga SÓLO `es_contenedor`. No se toca la categoría, la '
            'ubicación ni la jerarquía.'
        )

        if dry_run:
            self.stdout.write(self.style.WARNING(
                '\nDRY RUN: no se escribió nada. Ejecutá sin --dry-run para aplicar.'
            ))
            return

        if not options['yes']:
            if not sys.stdin or not sys.stdin.isatty():
                self.stdout.write(self.style.ERROR(
                    '\nEntorno no interactivo: repetí el comando con --yes para '
                    'aplicar la reparación.'
                ))
                return
            respuesta = input(
                '\nConfirmar corrección de %d objeto(s) (si/no): ' % len(a_corregir)
            )
            if respuesta.strip().lower() not in ('si', 's', 'yes', 'y'):
                self.stdout.write(self.style.WARNING('Operación cancelada.'))
                return

        # ------------------------------------------------------------------ escritura
        ids = [objeto.id for objeto in a_corregir]
        actualizados = 0
        with transaction.atomic():
            for inicio in range(0, len(ids), TAMANO_LOTE):
                lote = ids[inicio:inicio + TAMANO_LOTE]
                # `update()` NO dispara post_save: la señal de clasificación no
                # puede volver a encender el flag que estamos apagando.
                actualizados += Objeto.objects.filter(id__in=lote).update(
                    es_contenedor=False,
                )

        self.stdout.write(self.style.SUCCESS(
            '\nListo: %d objeto(s) pasaron a es_contenedor=False.'
            % actualizados
        ))
