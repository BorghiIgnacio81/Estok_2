"""
AUDITORÍA Y REPARACIÓN · CAJAS RAÍZ GUARDADAS COMO NODOS DE DIVISIÓN ESPACIAL.

Una caja «Caja NN» creada con coordenadas de grilla fue inferida por
`services/taxonomia_contenedor.inferir_tipo_contenedor` como MUEBLE_MOVIL y
quedó guardada como si fuera una forma arquitectónica del cuarto: el lienzo 2D
de la habitación la dibujaba como un bloque del suelo («Caja 06» en la
«Habitación de atrás»).

Este comando REPORTA esas piezas y, con `--apply`, las devuelve a su
naturaleza real de CAJA pura:
  · tipo='CAJA' y es_inmueble=False;
  · sin coordenadas de dibujo 2D en la habitación (ui_* a default, sin
    parent_grid_row/col ni fusion_grupo);
  · conservando la UBICACIÓN (habitación) y el CONTENIDO intactos.

Es la versión manual/idempotente de la migración
`0041_cajas_fuera_del_plano_habitacion` (misma regla, mismo resultado).

Uso:
    python manage.py normalizar_cajas_en_habitacion --dry-run
    python manage.py normalizar_cajas_en_habitacion --nombre "Caja 06"
    python manage.py normalizar_cajas_en_habitacion --estok <UUID> --apply
    python manage.py normalizar_cajas_en_habitacion --habitacion "Habitación de atrás" --apply --yes
"""

import re

from django.core.management.base import BaseCommand
from django.db import transaction

from inventario.models import Contenedor
from inventario.services.taxonomia_contenedor import TIPO_CAJA

# Mismo patrón canónico del backend (`PATRON_NOMBRE_CAJA`).
RE_NOMBRE_CAJA = re.compile(r'^\s*cajas?', re.IGNORECASE)

# Default del modelo para la geometría elástica (sin forma dibujada).
GEOMETRIA_SIN_PLANO = {
    'ui_left': '0%',
    'ui_top': '0%',
    'ui_width': '100%',
    'ui_height': 'auto',
}


def _describir(cont):
    """Línea de reporte con el estado ANTES de reparar."""
    ubicacion = cont.ubicacion.nombre if cont.ubicacion_id else '(sin ubicación)'
    return (
        "[{id}] '{nombre}' — tipo={tipo} es_inmueble={inmueble} ubicación='{ubic}'"
        ' casillero={fila}/{col} ui=({l},{t},{w},{h})'
    ).format(
        id=cont.id,
        nombre=cont.nombre or '(sin nombre)',
        tipo=cont.tipo,
        inmueble=cont.es_inmueble,
        ubic=ubicacion,
        fila=cont.parent_grid_row,
        col=cont.parent_grid_col,
        l=cont.ui_left,
        t=cont.ui_top,
        w=cont.ui_width,
        h=cont.ui_height,
    )


class Command(BaseCommand):
    help = (
        'Reporta (y con --apply repara) las CAJAS raíz guardadas como nodos de '
        'división espacial: las devuelve a CAJA pura sin geometría 2D del cuarto.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--nombre', type=str, default=None,
                            help='Limita la búsqueda al rótulo exacto (ej: "Caja 06").')
        parser.add_argument('--estok', type=str, default=None,
                            help='Limita la búsqueda al Estok indicado (UUID).')
        parser.add_argument('--habitacion', type=str, default=None,
                            help='Limita la búsqueda a la habitación indicada (UUID o parte del nombre).')
        parser.add_argument('--dry-run', action='store_true',
                            help='Muestra el plan completo sin escribir en la base.')
        parser.add_argument('--apply', action='store_true',
                            help='Aplica la reparación (sin esta bandera sólo se reporta).')
        parser.add_argument('--yes', action='store_true',
                            help='Omite la confirmación interactiva (entornos no interactivos).')

    def handle(self, *args, **options):
        qs = (
            Contenedor.objects.select_related('ubicacion')
            .filter(parent_contenedor__isnull=True)
            .order_by('ubicacion__nombre', 'nombre')
        )
        if options['estok']:
            qs = qs.filter(ubicacion__estok_id=options['estok'])
        if options['habitacion']:
            filtro = options['habitacion'].strip()
            if re.fullmatch(r'[0-9a-fA-F-]{36}', filtro):
                qs = qs.filter(ubicacion_id=filtro)
            else:
                qs = qs.filter(ubicacion__nombre__icontains=filtro)

        afectadas = []
        for cont in qs:
            if not RE_NOMBRE_CAJA.match(str(cont.nombre or '').strip()):
                continue
            if options['nombre'] and cont.nombre.strip().lower() != options['nombre'].strip().lower():
                continue
            if cont.tipo == TIPO_CAJA and not cont.es_inmueble:
                continue
            afectadas.append(cont)

        self.stdout.write('\n🔍 CAJAS guardadas como nodo de división espacial: %d' % len(afectadas))
        for cont in afectadas:
            self.stdout.write('   ⚠️  ' + _describir(cont))

        total = len(afectadas)
        if not total:
            self.stdout.write(self.style.SUCCESS(
                '\n✅ Ninguna caja raíz está registrada como división del plano.'
            ))
            return

        if options['dry_run'] or not options['apply']:
            self.stdout.write(self.style.WARNING(
                '\n🧪 DRY RUN — No se escribió nada. Agregá --apply para reparar %d caja(s).' % total
            ))
            return

        if not options['yes']:
            confirm = input('\n⚠️  ¿Convertir %d caja(s) en CAJA pura sin geometría 2D? (sí/no): ' % total)
            if confirm.strip().lower() not in ('sí', 'si', 's', 'yes', 'y'):
                self.stdout.write(self.style.WARNING('Operación cancelada.'))
                return

        with transaction.atomic():
            for cont in afectadas:
                Contenedor.objects.filter(pk=cont.pk).update(
                    tipo=TIPO_CAJA,
                    es_inmueble=False,
                    parent_grid_row=None,
                    parent_grid_col=None,
                    fusion_grupo=None,
                    **GEOMETRIA_SIN_PLANO,
                )

        self.stdout.write(self.style.SUCCESS(
            '\n✅ %d caja(s) normalizada(s) a CAJA pura, conservando su habitación y contenido.' % total
        ))
