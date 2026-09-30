"""
REPARACION QUIRURGICA DE UNA CAJA DESCALZADA POR UNA INSERCION DOBLE ERRONEA.

Contexto del incidente
----------------------
El Drag & Drop de la pantalla de Almacenamiento puede disparar, por un fallo del
endpoint de traslado de stock, una INSERCION DOBLE: la caja movil termina con
los parametros de un espacio FIJO del plano (tipo != 'CAJA' y/o
es_inmueble=True y/o encastrada en la grilla de la habitacion con
parent_grid_row/col). El registro aparece entonces como habitacion/mueble
inmueble dentro del plano, y sus objetos internos quedan colgando de una pieza
que el operador ve como descartable (si borra ese bloque de la UI, los objetos
se liberan a la bandeja de huerfanos).

Este comando aplica una reparacion QUIRURGICA y ATOMICA sobre el registro
afectado: le devuelve su naturaleza original de contenedor MOVIL
(tipo='CAJA', es_inmueble=False), lo reasigna como hijo directo del mueble real
(p. ej. "Ropero Empotrado") y libera las coordenadas de la grilla de la
habitacion con las que habia quedado encastrado. NUNCA borra objetos.

Uso:
    python manage.py reparar_caja_descalzada --dry-run
    python manage.py reparar_caja_descalzada --id <UUID> --yes
    python manage.py reparar_caja_descalzada --purgar-id <UUID>

Opciones:
    --nombre   Rotulo exacto del contenedor a reparar (default: el del incidente).
    --padre    Rotulo exacto del mueble anfitrion real (default: "Ropero Empotrado").
    --id       UUID exacto a reparar (obligatorio si hay mas de una coincidencia).
    --estok    Limita la busqueda al Estok indicado (UUID).
    --conservar-casillero  No limpia parent_grid_row/col del registro reparado.
    --dry-run  Muestra el plan completo sin escribir en la base.
    --yes      Omite la confirmacion interactiva (entornos no interactivos).
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from inventario.models import Contenedor, Objeto
from inventario.services.taxonomia_contenedor import TIPO_CAJA, TIPO_MUEBLE

NOMBRE_CAJA_DEFAULT = 'Caja 03(Piezas Yeso Pesebre)'
NOMBRE_PADRE_DEFAULT = 'Ropero Empotrado'


def _titulo(texto):
    """Encabezado legible de bloque dentro del reporte de consola."""
    limpio = str(texto or '').strip()
    return '\n=== %s %s' % (limpio, '=' * max(0, 58 - len(limpio)))


def _objetos_del(contenedor):
    """Objetos (incluidos los soft-deleted) que cuelgan del contenedor."""
    return list(
        Objeto.objects.filter(contenedor=contenedor)
        .order_by('nombre')
        .values_list('id', 'nombre', 'deleted_at', 'parent_grid_row', 'parent_grid_col')
    )


def _subcontenedores_de(contenedor):
    """Sub-contenedores directos del contenedor, ordenados por rotulo."""
    return list(
        Contenedor.objects.filter(parent_contenedor=contenedor)
        .order_by('nombre')
        .values_list('id', 'nombre', 'tipo', 'es_inmueble', 'parent_grid_row', 'parent_grid_col')
    )


def _describir(contenedor, sangria='   '):
    """Volcado completo y auditable de un Contenedor (una linea por bloque)."""
    padre = contenedor.parent_contenedor.nombre if contenedor.parent_contenedor_id else '(raiz)'
    ubicacion = contenedor.ubicacion.nombre if contenedor.ubicacion_id else '(sin ubicacion)'
    return (
        '%s- id=%s nombre=%r\n'
        '%s  tipo=%s es_inmueble=%s ubicacion=%r padre=%r casillero=%s/%s\n'
        '%s  grilla=%sx%s config=%s subcontenedores=%s objetos=%s'
        % (
            sangria, contenedor.id, contenedor.nombre,
            sangria, contenedor.tipo, contenedor.es_inmueble,
            ubicacion, padre, contenedor.parent_grid_row, contenedor.parent_grid_col,
            sangria, contenedor.grid_filas, contenedor.grid_columnas,
            contenedor.grid_filas_config,
            Contenedor.objects.filter(parent_contenedor=contenedor).count(),
            Objeto.objects.filter(contenedor=contenedor).count(),
        )
    )


class Command(BaseCommand):
    help = (
        'Repara de forma atomica una caja descalzada (tipo/es_inmueble/parent '
        'alterados por una insercion doble erronea) y purga registros fantasma vacios.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--nombre', type=str, default=NOMBRE_CAJA_DEFAULT,
                            help='Rotulo exacto del contenedor a reparar.')
        parser.add_argument('--padre', type=str, default=NOMBRE_PADRE_DEFAULT,
                            help='Rotulo exacto del mueble anfitrion real.')
        parser.add_argument('--id', type=str, default=None,
                            help='UUID exacto a reparar (obligatorio si hay varias coincidencias).')
        parser.add_argument('--estok', type=str, default=None,
                            help='Limita la busqueda al Estok indicado (UUID).')
        parser.add_argument('--conservar-casillero', action='store_true',
                            help='No limpia parent_grid_row/col del contenedor reparado.')
        parser.add_argument('--dry-run', action='store_true',
                            help='Muestra el plan completo sin modificar la base.')
        parser.add_argument('--yes', action='store_true',
                            help='Omite la confirmacion interactiva.')

    # ------------------------------------------------------------------ utilidades
    def _coincidencias(self, nombre, estok_id):
        """Busca por rotulo exacto (case-insensitive) y cae a contains si no hay."""
        base = Contenedor.objects.select_related('ubicacion', 'parent_contenedor')
        if estok_id:
            base = base.filter(ubicacion__estok_id=estok_id)
        exactos = list(base.filter(nombre__iexact=nombre).order_by('created_at'))
        if exactos:
            return exactos, True
        return list(base.filter(nombre__icontains=nombre).order_by('created_at')), False

    def _volcar_detalle(self, contenedor):
        """Imprime el contenedor con sus sub-contenedores y objetos internos."""
        self.stdout.write(_describir(contenedor))
        for sub in _subcontenedores_de(contenedor):
            self.stdout.write(
                '      sub: id=%s nombre=%r tipo=%s inmueble=%s casillero=%s/%s' % sub
            )
        for obj in _objetos_del(contenedor):
            self.stdout.write(
                '      obj: id=%s nombre=%r borrado=%s casillero=%s/%s' % obj
            )

    def _resolver_padre(self, nombre, estok_id):
        """Resuelve el mueble anfitrion real; avisa si hay ambiguedad de rotulo."""
        qs = Contenedor.objects.select_related('ubicacion').filter(nombre__iexact=nombre)
        if estok_id:
            qs = qs.filter(ubicacion__estok_id=estok_id)
        candidatos = list(qs.order_by('created_at'))
        if not candidatos:
            raise CommandError('No existe ningun contenedor con el rotulo padre %r.' % nombre)
        muebles = [c for c in candidatos if c.tipo == TIPO_MUEBLE or c.es_inmueble]
        elegidos = muebles or candidatos
        if len(elegidos) > 1:
            self.stdout.write(self.style.WARNING(
                'AVISO: hay %d coincidencias para el padre %r; se usa la primera:'
                % (len(elegidos), nombre)
            ))
            for c in elegidos:
                self.stdout.write(_describir(c))
        return elegidos[0]


    # -------------------------------------------------------------------- comando
    def handle(self, *args, **options):
        dry_run = options['dry_run']
        nombre = (options['nombre'] or NOMBRE_CAJA_DEFAULT).strip()
        nombre_padre = (options['padre'] or NOMBRE_PADRE_DEFAULT).strip()
        estok_id = (options['estok'] or '').strip() or None
        id_forzado = (options['id'] or '').strip() or None
        conservar = options['conservar_casillero']

        self.stdout.write(_titulo('DIAGNOSTICO'))
        self.stdout.write('  contenedor a reparar : %r' % nombre)
        self.stdout.write('  mueble anfitrion     : %r' % nombre_padre)
        self.stdout.write('  estok                : %s' % (estok_id or '(todos)'))
        self.stdout.write('  modo                 : %s'
                          % ('DRY RUN (sin cambios)' if dry_run else 'APLICAR'))

        # ------------------------------------------------------------------ objetivo
        if id_forzado:
            try:
                caja = Contenedor.objects.select_related(
                    'ubicacion', 'parent_contenedor'
                ).get(id=id_forzado)
            except (Contenedor.DoesNotExist, ValueError, TypeError):
                raise CommandError('No existe el contenedor con id=%s.' % id_forzado)
        else:
            elegidos, exactos = self._coincidencias(nombre, estok_id)
            if not elegidos:
                raise CommandError('No se encontro ningun contenedor con el rotulo %r.' % nombre)
            if len(elegidos) > 1:
                self.stdout.write(self.style.WARNING(
                    '\nATENCION: %d registros coinciden con %r (%s). No se modifica nada.'
                    % (len(elegidos), nombre, 'rotulo exacto' if exactos else 'coincidencia parcial')
                ))
                for candidato in elegidos:
                    self._volcar_detalle(candidato)
                raise CommandError(
                    'Hay multiples coincidencias: repita el comando con --id <UUID> '
                    'indicando el registro exacto a reparar.'
                )
            caja = elegidos[0]

        # --------------------------------------------------------------- padre real
        estok_caja = str(caja.ubicacion.estok_id) if caja.ubicacion_id else None
        padre = self._resolver_padre(nombre_padre, estok_id or estok_caja)
        if padre.id == caja.id:
            raise CommandError('El mueble anfitrion y la caja a reparar son el mismo registro.')

        # ------------------------------------------------- estado actual (evidencia)
        self.stdout.write(_titulo('ESTADO ACTUAL DEL REGISTRO A REPARAR'))
        subs = _subcontenedores_de(caja)
        objs = _objetos_del(caja)
        self.stdout.write(_describir(caja))
        self.stdout.write('   sub-contenedores internos: %d' % len(subs))
        for sub in subs:
            self.stdout.write('      id=%s nombre=%r tipo=%s inmueble=%s casillero=%s/%s' % sub)
        self.stdout.write('   objetos internos: %d' % len(objs))
        for obj in objs:
            self.stdout.write('      id=%s nombre=%r borrado=%s casillero=%s/%s' % obj)
        self.stdout.write(_titulo('MUEBLE ANFITRION REAL (DESTINO)'))
        self.stdout.write(_describir(padre))
        self.stdout.write('   sub-contenedores del anfitrion: %d'
                          % Contenedor.objects.filter(parent_contenedor=padre).count())
        for sub in _subcontenedores_de(padre):
            self.stdout.write('      id=%s nombre=%r tipo=%s inmueble=%s casillero=%s/%s' % sub)

        # ------------------------------------------------------------------- plan
        self.stdout.write(_titulo('PLAN DE REPARACION'))
        self.stdout.write('   tipo              %s -> %s' % (caja.tipo, TIPO_CAJA))
        self.stdout.write('   es_inmueble       %s -> %s' % (caja.es_inmueble, False))
        self.stdout.write('   parent_contenedor %s -> %s'
                          % (caja.parent_contenedor_id, padre.id))
        self.stdout.write('   ubicacion         %s -> %s'
                          % (caja.ubicacion_id, padre.ubicacion_id))
        if conservar:
            self.stdout.write('   casillero         se conserva %s/%s'
                              % (caja.parent_grid_row, caja.parent_grid_col))
        else:
            self.stdout.write('   casillero         %s/%s -> None/None (liberar plano)'
                              % (caja.parent_grid_row, caja.parent_grid_col))
        self.stdout.write('   Los %d objeto(s) y %d sub-contenedor(es) internos NO se tocan.'
                          % (len(objs), len(subs)))

        if dry_run:
            self.stdout.write(self.style.WARNING(
                '\nDRY RUN: no se escribio nada. Ejecute sin --dry-run para aplicar.'
            ))
            return

        if not options['yes']:
            respuesta = input('\nConfirmar reparacion del registro %s (si/no): ' % caja.id)
            if respuesta.strip().lower() not in ('si', 's', 'yes', 'y'):
                self.stdout.write(self.style.WARNING('Operacion cancelada.'))
                return


        # --------------------------------------------------------------- escritura
        with transaction.atomic():
            caja.tipo = TIPO_CAJA
            caja.es_inmueble = False
            caja.parent_contenedor = padre
            caja.ubicacion = padre.ubicacion
            update_fields = ['tipo', 'es_inmueble', 'parent_contenedor', 'ubicacion', 'updated_at']
            if not conservar:
                caja.parent_grid_row = None
                caja.parent_grid_col = None
                update_fields += ['parent_grid_row', 'parent_grid_col']
            caja.save(update_fields=update_fields)
            self._propagar_ubicacion(caja)

        # ------------------------------------------------------ verificacion en vivo
        verificado = Contenedor.objects.select_related(
            'ubicacion', 'parent_contenedor'
        ).get(pk=caja.pk)
        self.stdout.write(_titulo('RESULTADO VERIFICADO (releido de la base)'))
        self.stdout.write(_describir(verificado))
        if (
            verificado.tipo != TIPO_CAJA
            or verificado.es_inmueble
            or verificado.parent_contenedor_id != padre.id
        ):
            raise CommandError('La reparacion NO quedo aplicada. Revise la base antes de seguir.')
        self.stdout.write(self.style.SUCCESS(
            '\nOK: la caja recupero tipo=CAJA, es_inmueble=False y quedo dentro de %r.'
            % padre.nombre
        ))

    def _propagar_ubicacion(self, contenedor):
        """Propaga la ubicacion recien asignada a todo el subarbol interno."""
        for sub in Contenedor.objects.filter(parent_contenedor=contenedor):
            if sub.ubicacion_id != contenedor.ubicacion_id:
                sub.ubicacion_id = contenedor.ubicacion_id
                sub.save(update_fields=['ubicacion', 'updated_at'])
            self._propagar_ubicacion(sub)

