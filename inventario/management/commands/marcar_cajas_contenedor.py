"""
ACTUALIZACIÓN DIRECTA DE DATOS · Todas las CAJAS quedan clasificadas.

QUÉ CORRIGE
    1. `Objeto.es_contenedor = True` para todo Objeto cuyo rótulo EMPIEZA por
       «Caja» o cuya categoría es «Cajas y Contenedores» (incluye el alta rápida
       declarada caja). Misma regla que la migración `0033_cajas_es_contenedor_
       retroactivo`, pero re-ejecutable a demanda sobre producción.
    2. `Contenedor.declarado_movible = True` para todo `Contenedor` de tipo CAJA
       (no inmueble) cuyo rótulo EMPIEZA por «Caja»: es la DECLARACIÓN EXPLÍCITA
       que la canasta «🧺 Elementos por ubicar» exige para listar una caja
       (`api/viewsets/organizacion/filtros_bandeja.aplicar_filtro_bandeja`).
       Sin esta marca las «Caja 01…05» —que existen como `Contenedor`, no como
       `Objeto`— dependían sólo del rótulo para ser reconocidas.

    El script NO toca geometría (`ui_left`/`ui_top`/`ui_height`), ni jerarquías,
    ni el contenido de las cajas: sólo enciende los dos flags de clasificación.
    Los espejos de dualidad Contenedor⇄Objeto quedan excluidos (su caja real ya
    es un `Contenedor` y marcarlos duplicaría el bulto en las pestañas).

USO
    python manage.py marcar_cajas_contenedor            # informe (no escribe)
    python manage.py marcar_cajas_contenedor --apply    # aplica los cambios
    python manage.py marcar_cajas_contenedor --apply --estok <UUID>

    Idempotente: una segunda ejecución informa 0 registros a corregir.
"""

from django.core.management.base import BaseCommand
from django.db.models import Q

from inventario.models import Contenedor, Objeto
from inventario.services.taxonomia_contenedor import TIPO_CAJA

# Mismos patrones que `services/taxonomia_contenedor` (`PATRON_NOMBRE_CAJA` y
# `PATRON_CATEGORIA_CAJA`): regex ORM, soportado por PostgreSQL y SQLite.
PATRON_PREFIJO_CAJA = r'^\s*cajas?'
PATRON_CATEGORIA_CAJA = r'^cajas?\s*(?:y|/)\s*contenedores?$'

# Marca de dualidad dentro del JSON libre `especificaciones`.
CLAVE_ESPEJO = 'es_espejo_contenedor'

# Cuántos rótulos se listan en el informe (el resto se resume en un conteo).
ETIQUETA_MUESTRA = 25


class Command(BaseCommand):
    help = (
        'Marca es_contenedor=True en los Objetos-caja y declarado_movible=True '
        'en los Contenedores CAJA cuyo rótulo empieza por «Caja».'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Escribe los cambios (sin esta bandera sólo informa).',
        )
        parser.add_argument(
            '--estok',
            default=None,
            help='Limita la actualización a un Estok (UUID).',
        )

    # ------------------------------------------------------------------ filtros
    def _objetos_pendientes(self, estok_id):
        """Objetos que declaran caja por rótulo/categoría y no lo reflejan."""
        qs = Objeto.objects.filter(es_contenedor=False)
        if estok_id:
            qs = qs.filter(estok_id=estok_id)
        return qs.filter(
            Q(nombre__iregex=PATRON_PREFIJO_CAJA)
            | Q(categoria__nombre__iregex=PATRON_CATEGORIA_CAJA)
        ).order_by('nombre')

    def _contenedores_pendientes(self, estok_id):
        """Contenedores CAJA móviles con rótulo de caja y sin declaración."""
        qs = Contenedor.objects.filter(
            tipo=TIPO_CAJA, es_inmueble=False, declarado_movible=False,
        ).filter(nombre__iregex=PATRON_PREFIJO_CAJA)
        if estok_id:
            qs = qs.filter(ubicacion__estok_id=estok_id)
        return qs.order_by('nombre')

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _es_espejo(especificaciones):
        """True si el objeto es el espejo de dualidad de un Contenedor."""
        return bool((especificaciones or {}).get(CLAVE_ESPEJO))

    def _informar(self, titulo, nombres):
        """Encabezado + rótulos afectados (recortados a ETIQUETA_MUESTRA)."""
        self.stdout.write(f'\n=== {titulo} ({len(nombres)})')
        for nombre in nombres[:ETIQUETA_MUESTRA]:
            self.stdout.write(f'   - {nombre}')
        if len(nombres) > ETIQUETA_MUESTRA:
            self.stdout.write(f'   ... y {len(nombres) - ETIQUETA_MUESTRA} mas')

    # ------------------------------------------------------------------- handle
    def handle(self, *args, **options):
        aplicar = options['apply']
        estok_id = options['estok']

        # ---------------------------------------------------------- OBJETOS
        objetos = [
            (pk, nombre)
            for pk, nombre, especificaciones in self._objetos_pendientes(
                estok_id,
            ).values_list('pk', 'nombre', 'especificaciones')
            if not self._es_espejo(especificaciones)
        ]
        self._informar(
            'OBJETOS a marcar es_contenedor=True', [n for _, n in objetos],
        )
        if aplicar and objetos:
            Objeto.objects.filter(pk__in=[pk for pk, _ in objetos]).update(
                es_contenedor=True,
            )
            self.stdout.write(self.style.SUCCESS(
                f'   OK: {len(objetos)} Objeto(s) actualizados.'
            ))

        # ------------------------------------------------------ CONTENEDORES
        contenedores = list(
            self._contenedores_pendientes(estok_id).values_list('pk', 'nombre')
        )
        self._informar(
            'CONTENEDORES a marcar declarado_movible=True',
            [n for _, n in contenedores],
        )
        if aplicar and contenedores:
            Contenedor.objects.filter(
                pk__in=[pk for pk, _ in contenedores],
            ).update(declarado_movible=True)
            self.stdout.write(self.style.SUCCESS(
                f'   OK: {len(contenedores)} Contenedor(es) actualizados.'
            ))

        if not aplicar:
            self.stdout.write(self.style.WARNING(
                '\nDRY RUN: no se escribio nada. Reejecuta con --apply.'
            ))
        elif not objetos and not contenedores:
            self.stdout.write(self.style.SUCCESS(
                '\nOK: nada que corregir, todas las cajas ya estan clasificadas.'
            ))
