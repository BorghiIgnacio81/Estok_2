"""
Management command para purgar CONTENEDORES FANTASMA (muebles/estanterías
autogenerados por el viejo wizard del Mapa Estok al guardar grillas vacías).

Un contenedor es FANTASMA cuando cumple TODO esto:
  - NO es un mueble inmueble fijo (es_inmueble=False).
  - NO tiene sub-contenedores internos (no es un mueble/estantería con hijos).
  - NO aloja objetos REALES (solo, a lo sumo, su registro espejo homónimo).
  - Su nombre está vacío O es un rótulo por defecto del wizard
    ("División F1·C1", "Habitación F2·C3", "Mueble F1·C2", "Estantería F2·C1").

Al eliminar cada fantasma se borra TAMBIÉN su registro espejo en Objeto para
no dejar "objetos sueltos" huérfanos (la FK Objeto.contenedor es SET_NULL).

Uso:
    python manage.py limpiar_contenedores_fantasma --dry-run
    python manage.py limpiar_contenedores_fantasma --estok <UUID>
    python manage.py limpiar_contenedores_fantasma --ubicacion baño
    python manage.py limpiar_contenedores_fantasma --yes
"""

import logging
import re
import unicodedata

from django.core.management.base import BaseCommand
from django.db import transaction

from inventario.models import Contenedor, Objeto

logger = logging.getLogger(__name__)

# Mismo patrón que el frontend (rutaCajaMinimapas.ts): rótulos autogenerados.
RE_NOMBRE_AUTOGENERADO = re.compile(
    r'^(divisi[oó]n|habitaci[oó]n|mueble|estanter[ií]a|cajonera)'
    r'\s+f\d+\s*[·.\-x]\s*c\d+$',
    re.IGNORECASE,
)


def _normalizar(texto):
    """minúsculas sin acentos, para comparar nombres de ubicación en caliente."""
    sin_acentos = ''.join(
        c for c in unicodedata.normalize('NFKD', str(texto or ''))
        if not unicodedata.combining(c)
    )
    return sin_acentos.strip().lower()


def _es_nombre_fantasma(nombre):
    limpio = (nombre or '').strip()
    return limpio == '' or bool(RE_NOMBRE_AUTOGENERADO.match(limpio))


def _es_registro_espejo(objeto, contenedor):
    """Espejo homónimo creado por la dualidad Contenedor+Objeto (mudable raíz)."""
    if contenedor.es_inmueble or contenedor.parent_contenedor_id is not None:
        return False
    if objeto.parent_grid_row is not None or objeto.parent_grid_col is not None:
        return False
    return (objeto.nombre or '') == (contenedor.nombre or '')


def _objetos_reales(contenedor):
    """Objetos del contenedor que NO son su registro espejo homónimo."""
    reales = []
    for obj in Objeto.objects.filter(contenedor=contenedor, deleted_at__isnull=True):
        if not _es_registro_espejo(obj, contenedor):
            reales.append(obj)
    return reales


class Command(BaseCommand):
    help = (
        "Purga contenedores FANTASMA (muebles/estanterías vacíos autogenerados) "
        "que contaminan el listado de Objetos."
    )

    def add_arguments(self, parser):
        parser.add_argument('--estok', type=str, default=None,
                            help='Limita la purga a un Estok (UUID).')
        parser.add_argument('--ubicacion', type=str, default=None,
                            help='Limita la purga a ubicaciones cuyo nombre contenga el texto (ej: "baño", "pasillo").')
        parser.add_argument('--dry-run', action='store_true',
                            help='Solo muestra los fantasmas detectados, sin borrar nada.')
        parser.add_argument('--yes', action='store_true',
                            help='Omite la confirmación interactiva (entornos no interactivos).')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        estok_id = options['estok']
        filtro_ubicacion = _normalizar(options['ubicacion']) if options['ubicacion'] else None

        qs = (
            Contenedor.objects.select_related('ubicacion')
            .filter(es_inmueble=False, subcontenedores__isnull=True)
            .distinct()
        )
        if estok_id:
            qs = qs.filter(ubicacion__estok_id=estok_id)

        fantasmas = []
        for cont in qs:
            if not _es_nombre_fantasma(cont.nombre):
                continue
            if filtro_ubicacion and filtro_ubicacion not in _normalizar(cont.ubicacion.nombre):
                continue
            if _objetos_reales(cont):
                continue
            fantasmas.append(cont)

        self.stdout.write('\n🔍 Contenedores FANTASMA detectados: %d' % len(fantasmas))
        for cont in fantasmas:
            self.stdout.write(
                "   ⚠️  [%s] '%s' — ubicación: '%s'"
                % (cont.id, cont.nombre or '(sin nombre)', cont.ubicacion.nombre)
            )

        total = len(fantasmas)
        if dry_run:
            self.stdout.write(self.style.WARNING(
                '\n🧪 DRY RUN — No se eliminó nada. Ejecutá sin --dry-run para borrar %d contenedor(es).' % total
            ))
            return

        if total == 0:
            self.stdout.write(self.style.SUCCESS('\n✅ No hay contenedores fantasma para eliminar.'))
            return

        if not options['yes']:
            confirm = input(
                '\n⚠️  ¿Eliminar %d contenedor(es) fantasma (y su espejo en Objeto)? (sí/no): ' % total
            )
            if confirm.strip().lower() not in ('sí', 'si', 's', 'yes', 'y'):
                self.stdout.write(self.style.WARNING('Operación cancelada.'))
                return

        eliminados = 0
        espejos = 0
        with transaction.atomic():
            for cont in fantasmas:
                for obj in Objeto.objects.filter(contenedor=cont):
                    if _es_registro_espejo(obj, cont):
                        obj.delete()
                        espejos += 1
                cont.delete()
                eliminados += 1

        self.stdout.write(self.style.SUCCESS(
            '\n✅ Limpieza completada. %d contenedor(es) eliminado(s) y %d espejo(s) purgado(s).'
            % (eliminados, espejos)
        ))
