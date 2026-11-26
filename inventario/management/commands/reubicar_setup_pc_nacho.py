"""
REUBICACIÓN Y PURGA del espacio/caja «SetUp PC Nacho».

QUÉ HACE (idempotente, en UNA transacción)
    1. Busca el contenedor ORIGEN («SetUp PC Nacho») y el DESTINO («Setup PC»
       de la habitación «Habitación Atras») del MISMO Estok.
    2. Reubica TODO lo que colgaba del origen:
         · Objetos activos alojados en la caja → pasan al destino
           (`contenedor`, `ubicacion`), sin coordenadas de casillero fantasma.
         · Sub-contenedores directos → pasan a ser hijos del destino y toda su
           descendencia hereda la ubicación del destino.
         · Objetos alojados en esos sub-contenedores → heredan la ubicación.
    3. Elimina el registro espejo (si existiera) del origen y, por último,
       ELIMINA el contenedor origen: deja de figurar como caja en el lienzo y
       en la lista de etiquetas QR.

    La FK `Objeto.contenedor` es SET_NULL y `Contenedor.parent_contenedor`
    también, así que el borrado NUNCA destruye inventario: por eso, igual, los
    objetos activos se reasignan ANTES de borrar.

Uso:
    python manage.py reubicar_setup_pc_nacho --dry-run
    python manage.py reubicar_setup_pc_nacho
    python manage.py reubicar_setup_pc_nacho --origen "Setup Pc Nacho" --destino "Setup PC"
"""

import logging
import unicodedata

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from inventario.models import Contenedor, Objeto

logger = logging.getLogger(__name__)

ORIGEN_POR_DEFECTO = 'SetUp PC Nacho'
DESTINO_POR_DEFECTO = 'Setup PC'


def _clave_nombre(texto):
    """Nombre comparable: minúsculas, sin acentos y con espacios colapsados."""
    sin_acentos = ''.join(
        c for c in unicodedata.normalize('NFKD', str(texto or ''))
        if not unicodedata.combining(c)
    )
    return ' '.join(sin_acentos.split()).casefold()


def _buscar_contenedor(nombre):
    """
    Contenedor por nombre, tolerante a mayúsculas/acentos/espacios.

    Primero intenta el `iexact` de PostgreSQL (barato); si no hay coincidencia
    compara en Python sobre la tabla de contenedores (es chica y el operador
    suele escribir «Setup Pc Nacho» con otra capitalización).
    """
    encontrado = Contenedor.objects.filter(nombre__iexact=str(nombre).strip()).first()
    if encontrado is not None:
        return encontrado
    clave = _clave_nombre(nombre)
    for contenedor in Contenedor.objects.all().only('id', 'nombre'):
        if _clave_nombre(contenedor.nombre) == clave:
            return contenedor
    return None


def _ids_descendencia(contenedor_id):
    """IDs de TODO el subárbol de sub-contenedores (sin incluir la raíz)."""
    ids = []
    pendientes = [contenedor_id]
    while pendientes:
        hijos = list(
            Contenedor.objects
            .filter(parent_contenedor_id__in=pendientes)
            .values_list('id', flat=True)
        )
        if not hijos:
            break
        ids.extend(hijos)
        pendientes = hijos
    return ids


class Command(BaseCommand):
    help = (
        'Reubica los objetos de «SetUp PC Nacho» en «Setup PC» y elimina el '
        'registro origen para que no figure más como caja ni en los QR.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--origen', default=ORIGEN_POR_DEFECTO,
            help='Nombre exacto/equivalente de la caja a eliminar (default: %(default)s).',
        )
        parser.add_argument(
            '--destino', default=DESTINO_POR_DEFECTO,
            help='Nombre del contenedor que recibe el contenido (default: %(default)s).',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Muestra el plan completo sin escribir NADA en la base.',
        )

    def handle(self, *args, **options):
        origen_nombre = options['origen']
        destino_nombre = options['destino']
        dry_run = options['dry_run']

        origen = _buscar_contenedor(origen_nombre)
        if origen is None:
            self.stdout.write(self.style.SUCCESS(
                'No existe el contenedor «%s»: nada que reubicar ni eliminar '
                '(comando idempotente).' % origen_nombre
            ))
            return

        destino = _buscar_contenedor(destino_nombre)
        if destino is None:
            raise CommandError(
                'No existe el contenedor destino «%s»: creálo antes de reubicar '
                'el inventario.' % destino_nombre
            )
        if destino.pk == origen.pk:
            raise CommandError('El origen y el destino son el mismo contenedor.')

        origen_estok = getattr(origen.ubicacion, 'estok_id', None)
        destino_estok = getattr(destino.ubicacion, 'estok_id', None)
        if origen_estok and destino_estok and origen_estok != destino_estok:
            raise CommandError(
                'Origen y destino pertenecen a Estoks distintos: la operación '
                'cruzada se rechaza.'
            )

        self.stdout.write(self.style.MIGRATE_HEADING('PLAN DE REUBICACIÓN'))
        self.stdout.write('  origen  : %s (%s)' % (origen.nombre, origen.id))
        self.stdout.write('  destino : %s (%s)' % (destino.nombre, destino.id))
        self.stdout.write('  modo    : %s' % ('DRY RUN (sin cambios)' if dry_run else 'APLICAR'))

        with transaction.atomic():
            reporte = self._ejecutar(origen, destino)

            self.stdout.write(self.style.MIGRATE_HEADING('RESULTADO'))
            self.stdout.write('  objetos reubicados            : %d' % reporte['objetos'])
            self.stdout.write('  objetos descartados (papelera): %d' % reporte['descartados'])
            self.stdout.write('  sub-contenedores reparentados : %d' % reporte['hijos'])
            self.stdout.write('  descendencia reubicada        : %d' % reporte['descendencia'])
            self.stdout.write('  espejos eliminados            : %d' % reporte['espejos'])
            self.stdout.write('  contenedor origen eliminado   : %s' % (reporte['borrado'] or '—'))

            if dry_run:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING(
                    '\nDRY RUN: no se escribió ningún cambio en la base.'
                ))
                return

        self.stdout.write(self.style.SUCCESS(
            '\nListo: «%s» ya no existe como caja ni aparece en la lista de QR.'
            % origen.nombre
        ))


    def _ejecutar(self, origen, destino):
        """
        Ejecuta las operaciones del plan (dentro de la transacción del `handle`).

        Usa `QuerySet.update()` en los traslados para NO disparar señales
        post_save (es una reparación de datos, no una edición del operador) y
        devuelve el conteo de cada paso para el reporte.
        """
        ubicacion_destino = destino.ubicacion
        descendencia = _ids_descendencia(origen.pk)

        # 1) OBJETOS ACTIVOS alojados en la caja origen → pasan al destino.
        #    Las coordenadas de casillero NO se heredan: el destino tiene su
        #    propia grilla y un índice ajeno dejaría el objeto en un casillero
        #    fantasma.
        objetos = Objeto.objects.filter(contenedor=origen, deleted_at__isnull=True)
        reubicados = objetos.update(
            contenedor=destino,
            ubicacion=ubicacion_destino,
            parent_grid_row=None,
            parent_grid_col=None,
        )

        # 2) Objetos DESCARTADOS (papelera): no se reubican —su caja es
        #    historia— y sólo se informan. Al borrar el origen, su FK queda en
        #    NULL (SET_NULL), sin destruir nada.
        descartados = Objeto.objects.filter(contenedor=origen).count()

        # 3) SUB-CONTENEDORES directos → hijos del destino; su descendencia
        #    hereda la ubicación del destino (igual que la propagación del
        #    viewset al mover un contenedor).
        hijos = Contenedor.objects.filter(parent_contenedor=origen).update(
            parent_contenedor=destino,
            ubicacion=ubicacion_destino,
        )
        if descendencia:
            Contenedor.objects.filter(id__in=descendencia).update(
                ubicacion=ubicacion_destino,
            )
            Objeto.objects.filter(
                contenedor_id__in=descendencia, deleted_at__isnull=True,
            ).update(ubicacion=ubicacion_destino)

        # 4) ESPEJOS de dualidad del origen: duplican el espacio físico, no son
        #    inventario. Sin este borrado quedarían como «objeto suelto» al
        #    desaparecer su contenedor.
        espejos = Objeto.objects.filter(
            contenedor=origen,
            especificaciones__has_key='es_espejo_contenedor',
            especificaciones__es_espejo_contenedor=True,
        )
        espejos_eliminados = espejos.count()
        espejos.delete()

        # 5) PURGA del contenedor origen: deja de existir como caja, como
        #    tarjeta del lienzo y como etiqueta QR.
        id_origen = str(origen.id)
        origen.delete()

        return {
            'objetos': reubicados,
            'descartados': descartados,
            'hijos': hijos,
            'descendencia': len(descendencia),
            'espejos': espejos_eliminados,
            'borrado': id_origen,
        }

