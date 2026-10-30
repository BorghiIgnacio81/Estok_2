"""
Limpia las REFERENCIAS HUÉRFANAS a cajas de otro Estok (mudanza entre Estoks).

CONTEXTO
  `Objeto.contenedor` es SET_NULL, así que borrar una caja nunca deja un FK roto.
  El problema es la MUDANZA: el objeto viaja al Estok destino pero conserva un
  `contenedor_id` que apunta a una pieza del Estok ORIGEN (Contenedor no tiene FK
  a Estok: pertenece al inquilinato vía `ubicacion.estok`). Esa caja existe pero es
  INALCANZABLE desde el Estok activo, así que el objeto no aparece en ningún
  árbol, ni dentro de la caja, ni en la canasta de «Elementos por ubicar»: queda
  invisible e imposible de reubicar (p. ej. los libros «Anne…» tras la mudanza).

QUÉ HACE
  Recorre los objetos con `contenedor` NO nulo, resuelve si la caja es alcanzable
  dentro del Estok de referencia del objeto y, cuando NO lo es, limpia la
  referencia (`contenedor = None`) y el casillero fino (`parent_grid_row/col`).
  NUNCA borra objetos ni contenedores: la ubicación se respeta y el bulto vuelve a
  listarse como «Objeto huérfano a reubicar» para asignarlo a la caja nueva.

  La misma regla viaja ORM en `?bandeja=true`
  (services/referencias_huerfanas.q_contenedor_ajeno_al_estok): los objetos ya se
  ven en la bandeja ANTES de correr este comando. Este comando deja la base
  limpia para que el contador de la caja no cuente referencias fantasma.

Uso:
    python manage.py limpiar_huerfanos_contenedor --dry-run
    python manage.py limpiar_huerfanos_contenedor --estok <UUID>
    python manage.py limpiar_huerfanos_contenedor --estok <UUID> --yes
"""

from django.core.management.base import BaseCommand

from inventario.services.referencias_huerfanas import sanear_referencias_huerfanas


class Command(BaseCommand):
    help = (
        "Limpia el contenedor_id de los objetos que apuntan a cajas de otro Estok "
        "(huérfanos de mudanza) para que vuelvan a «Objetos a reubicar»."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--estok', type=str, default=None,
            help='Limita el saneamiento a un Estok (UUID).',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Solo lista los huérfanos detectados, sin escribir en la base.',
        )
        parser.add_argument(
            '--yes', action='store_true',
            help='Omite la confirmación interactiva (entornos no interactivos).',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        estok_id = options['estok']

        reporte = sanear_referencias_huerfanas(estok_id=estok_id, dry_run=True)
        self.stdout.write(
            '\n🔎 Objetos con contenedor INALCANZABLE: %d' % len(reporte)
        )
        for item in reporte:
            self.stdout.write(
                "   ⚠️  [%s] %r → caja %r (%s) del Estok %s"
                % (
                    item['id'], item['nombre'], item['contenedor_nombre'],
                    item['contenedor_id'], item['estok_id'] or '(sin estok)',
                )
            )

        if not reporte:
            self.stdout.write(self.style.SUCCESS(
                '\n✅ No hay referencias huérfanas: todas las cajas son alcanzables.'
            ))
            return

        if dry_run:
            self.stdout.write(self.style.WARNING(
                '\n🧪 DRY RUN — no se escribió nada. Ejecutá sin --dry-run para '
                'liberar %d objeto(s).' % len(reporte)
            ))
            return

        if not options['yes']:
            confirmacion = input(
                '\n⚠️  ¿Liberar la referencia de %d objeto(s)? (sí/no): ' % len(reporte)
            )
            if confirmacion.strip().lower() not in ('sí', 'si', 's', 'yes', 'y'):
                self.stdout.write(self.style.WARNING('Operación cancelada.'))
                return

        aplicado = sanear_referencias_huerfanas(estok_id=estok_id, dry_run=False)
        self.stdout.write(self.style.SUCCESS(
            '\n✅ Referencias liberadas: %d. Los objetos ya se listan en la '
            'bandeja «🧺 Elementos por ubicar» para asignarlos a una caja activa.'
            % len(aplicado)
        ))
