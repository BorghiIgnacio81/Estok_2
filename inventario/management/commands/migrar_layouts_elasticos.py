"""
Comando de gestión: migra los layouts matriciales previos (grid_row/grid_col)
al nuevo diseño elástico 2D (ui_left/ui_top/ui_width/ui_height).

Uso:
    python manage.py migrar_layouts_elasticos                # todos los Estoks
    python manage.py migrar_layouts_elasticos --estok <UUID> # un Estok puntual
    python manage.py migrar_layouts_elasticos --dry-run      # simulación

Idempotente: solo convierte registros que aún tienen el layout matricial viejo.
"""
from django.core.management.base import BaseCommand

from inventario.services.layouts_elasticos import migrar_layouts


class Command(BaseCommand):
    help = 'Recalcula el layout matricial previo (grid_row/grid_col) a geometría elástica 2D (ui_*).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--estok',
            type=str,
            default=None,
            help='UUID del Estok a migrar (por defecto: todos).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Simula la migración sin escribir en la base de datos.',
        )

    def handle(self, *args, **options):
        estok_id = options.get('estok')
        dry_run = options.get('dry_run', False)
        resumen = migrar_layouts(estok_id, dry_run)
        prefijo = '🔎 [dry-run] ' if dry_run else '✅ '
        self.stdout.write(
            f"{prefijo}Ubicaciones migradas: {resumen['ubicaciones']} · "
            f"Contenedores migrados: {resumen['contenedores']} "
            f"({'simulado' if dry_run else 'persistido'})."
        )
