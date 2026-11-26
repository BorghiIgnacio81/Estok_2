"""
AUDITORÍA Y REPARACIÓN · «ARMARIO ESPEJO» COMO SUB-ESPACIO FANTASMA.

Un mueble físico puede quedar registrado (por un Drop/duplicación accidental)
como HIJO de espacios que no lo contienen —«Repisas», «Cama», «Zona Indoor»,
«Setup PC»— y entonces aparece dibujado como sub-espacio fantasma dentro de
ellos, imposible de corregir desde el plano del padre.

Este comando:
  1. Busca TODAS las instancias cuyo nombre coincida con el buscado (sin
     distinguir mayúsculas ni acentos).
  2. Revisa su cadena de ancestros (`parent_contenedor` → …) y marca las que
     cuelguen de alguno de los espacios declarados como padres INVÁLIDOS.
  3. Propone UNA de estas dos correcciones por instancia:
       · ELIMINAR   → si la instancia es un duplicado VACÍO (sin sub-espacios y
                      sin objetos activos).
       · REUBICAR   → si aloja contenido real: se desvincula del padre inválido
                      y queda como espacio raíz de la habitación destino
                      («Habitación Atras»), conservando TODO su inventario.
     La reubicación limpia coordenadas de casillero (`parent_grid_row/col`),
     `fusion_grupo` y la geometría `ui_*` heredada del padre equivocado, para
     que la pieza no quede superpuesta sobre el plano del cuarto.

Es IDEMPOTENTE: correrlo dos veces sobre datos sanos reporta 0 hallazgos.

Uso:
    python manage.py auditar_armario_espejo --dry-run
    python manage.py auditar_armario_espejo --estok <UUID> --dry-run
    python manage.py auditar_armario_espejo --apply --yes
"""

import unicodedata

from django.core.management.base import BaseCommand
from django.db import transaction

from inventario.models import Contenedor, Objeto, Ubicacion

# Parents INVÁLIDOS por defecto (los espacios donde el fantasma fue reportado).
PADRES_INVALIDOS = 'Repisas,Cama,Zona Indoor,Setup PC'

# Habitación real a la que pertenece el mueble.
DESTINO_POR_DEFECTO = 'Habitación Atras'

# Geometría neutra (default del modelo) al desvincular del padre equivocado.
GEOMETRIA_SIN_PLANO = {
    'ui_left': '0%',
    'ui_top': '0%',
    'ui_width': '100%',
    'ui_height': 'auto',
}

# Guardia anti-ciclos al recorrer la cadena de ancestros.
MAX_PROFUNDIDAD = 32


def _normalizar(texto):
    """minúsculas sin acentos, para comparar nombres en caliente."""
    sin_acentos = ''.join(
        c for c in unicodedata.normalize('NFKD', str(texto or ''))
        if not unicodedata.combining(c)
    )
    return sin_acentos.strip().lower()


def _cadena_de_padres(contenedor):
    """Nombres de TODOS los ancestros (del inmediato hacia la raíz)."""
    nombres = []
    actual = contenedor.parent_contenedor
    profundidad = 0
    while actual is not None and profundidad < MAX_PROFUNDIDAD:
        nombres.append(actual.nombre)
        actual = actual.parent_contenedor
        profundidad += 1
    return nombres


def _ubicacion_destino(estok_id, destino_normalizado, nombre_buscado):
    """
    Ubicación real «Habitación Atras» del Estok activo.

    Primero por nombre exacto normalizado; si no existe, se toma la ubicación
    del contenedor CANÓNICO (mismo nombre, raíz, en esa habitación).
    """
    for ubicacion in Ubicacion.objects.filter(estok_id=estok_id):
        if _normalizar(ubicacion.nombre) == destino_normalizado:
            return ubicacion
    canonico = (
        Contenedor.objects.select_related('ubicacion')
        .filter(ubicacion__estok_id=estok_id, parent_contenedor__isnull=True)
        .filter(nombre__iexact=nombre_buscado)
        .first()
    )
    return canonico.ubicacion if canonico else None


def _tiene_contenido(contenedor):
    """Contenido REAL que impide borrar la instancia (sub-espacios u objetos)."""
    if contenedor.subcontenedores.exists():
        return True
    return Objeto.objects.filter(
        contenedor=contenedor, deleted_at__isnull=True
    ).exists()


class Command(BaseCommand):
    help = (
        'Audita (y con --apply repara) las instancias de «Armario espejo» que '
        'cuelgan de espacios inválidos y aparecen como sub-espacios fantasma.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--nombre', type=str, default='Armario espejo',
                            help='Nombre exacto a auditar (default: "Armario espejo").')
        parser.add_argument('--padres', type=str, default=PADRES_INVALIDOS,
                            help='Padres inválidos separados por coma (default: "%s").' % PADRES_INVALIDOS)
        parser.add_argument('--destino', type=str, default=DESTINO_POR_DEFECTO,
                            help='Habitación real a la que pertenece la pieza (default: "%s").' % DESTINO_POR_DEFECTO)
        parser.add_argument('--estok', type=str, default=None,
                            help='Limita la auditoría a un Estok (UUID).')
        parser.add_argument('--dry-run', action='store_true',
                            help='Sólo reporta el plan, sin escribir en la base.')
        parser.add_argument('--apply', action='store_true',
                            help='Aplica las correcciones (sin esta bandera sólo se reporta).')
        parser.add_argument('--yes', action='store_true',
                            help='Omite la confirmación interactiva (entornos no interactivos).')

    def handle(self, *args, **options):
        nombre_normalizado = _normalizar(options['nombre'])
        padres_invalidos = {
            _normalizar(p) for p in options['padres'].split(',') if p.strip()
        }
        destino_normalizado = _normalizar(options['destino'])

        qs = Contenedor.objects.select_related(
            'ubicacion', 'parent_contenedor',
        ).order_by('ubicacion__nombre', 'nombre')
        if options['estok']:
            qs = qs.filter(ubicacion__estok_id=options['estok'])

        hallazgos = []
        for contenedor in qs:
            if _normalizar(contenedor.nombre) != nombre_normalizado:
                continue
            cadena = _cadena_de_padres(contenedor)
            padre_invalido = next(
                (nombre for nombre in cadena if _normalizar(nombre) in padres_invalidos),
                None,
            )
            if padre_invalido is None:
                continue
            accion = 'reubicar' if _tiene_contenido(contenedor) else 'eliminar'
            hallazgos.append((contenedor, padre_invalido, accion))

        self.stdout.write(
            '\n🔍 «%s» colgando de padres inválidos: %d'
            % (options['nombre'], len(hallazgos))
        )
        for contenedor, padre_invalido, accion in hallazgos:
            self.stdout.write(
                "   ⚠️  [%s] '%s' — hijo de '%s' · ubicación actual: '%s' · acción: %s"
                % (
                    contenedor.id,
                    contenedor.nombre,
                    padre_invalido,
                    contenedor.ubicacion.nombre if contenedor.ubicacion_id else '(sin ubicación)',
                    'ELIMINAR (duplicado vacío)' if accion == 'eliminar'
                    else 'REUBICAR a «%s» con su contenido' % options['destino'],
                )
            )

        total = len(hallazgos)
        if not total:
            self.stdout.write(self.style.SUCCESS(
                '\n✅ Sin sub-espacios fantasma: la jerarquía de «%s» está sana.'
                % options['nombre']
            ))
            return

        if options['dry_run'] or not options['apply']:
            self.stdout.write(self.style.WARNING(
                '\n🧪 DRY RUN — No se escribió nada. Agregá --apply para corregir %d instancia(s).'
                % total
            ))
            return

        if not options['yes']:
            confirm = input(
                '\n⚠️  ¿Corregir %d instancia(s) de «%s»? (sí/no): '
                % (total, options['nombre'])
            )
            if confirm.strip().lower() not in ('sí', 'si', 's', 'yes', 'y'):
                self.stdout.write(self.style.WARNING('Operación cancelada.'))
                return

        eliminados = 0
        reubicados = 0
        omitidos = 0
        with transaction.atomic():
            for contenedor, padre_invalido, accion in hallazgos:
                if accion == 'eliminar':
                    contenedor.delete()
                    eliminados += 1
                    continue
                destino = _ubicacion_destino(
                    contenedor.ubicacion.estok_id, destino_normalizado, options['nombre'],
                )
                if destino is None:
                    self.stdout.write(self.style.ERROR(
                        "   ❌ [%s] '%s': no se encontró la habitación destino «%s». Omitido."
                        % (contenedor.id, contenedor.nombre, options['destino'])
                    ))
                    omitidos += 1
                    continue
                Contenedor.objects.filter(pk=contenedor.pk).update(
                    ubicacion=destino,
                    parent_contenedor=None,
                    parent_grid_row=None,
                    parent_grid_col=None,
                    fusion_grupo=None,
                    **GEOMETRIA_SIN_PLANO
                )
                reubicados += 1

        self.stdout.write(self.style.SUCCESS(
            '\n✅ Auditoría aplicada: %d eliminado(s), %d reubicado(s), %d omitido(s).'
            % (eliminados, reubicados, omitidos)
        ))
