"""
Management command para limpiar ubicaciones truncas (sin estok asignado)
que inflan el contador del dashboard.

Uso: python manage.py limpiar_ubicaciones_truncas
     python manage.py limpiar_ubicaciones_truncas --dry-run  (solo mostrar, no eliminar)
"""
import logging
from django.core.management.base import BaseCommand
from inventario.models import Ubicacion, Contenedor, Objeto

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Elimina ubicaciones truncas (sin estok_id) que inflan el contador del dashboard"

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Solo muestra las ubicaciones a eliminar sin borrarlas',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        # 1. Ubicaciones sin estok asignado (estok_id IS NULL)
        sin_estok = Ubicacion.objects.filter(estok__isnull=True)
        self.stdout.write(f"\n🔍 Ubicaciones SIN estok asignado: {sin_estok.count()}")
        for u in sin_estok:
            contadores = Contenedor.objects.filter(ubicacion=u).count()
            objetos = Objeto.objects.filter(ubicacion=u).count()
            self.stdout.write(
                f"   ⚠️  [{u.id}] '{u.nombre}' — "
                f"Contenedores: {contadores}, Objetos: {objetos}"
            )

        # 2. Ubicaciones con estok_id pero cuyo estok no existe (FK huérfana)
        #    Django no permite FK huérfanas por integridad referencial,
        #    pero verificamos por si hay datos residuales
        todas = Ubicacion.objects.all()
        huerfanas = [u for u in todas if u.estok_id and not u.estok]
        self.stdout.write(f"\n🔍 Ubicaciones con estok_id huérfano: {len(huerfanas)}")
        for u in huerfanas:
            self.stdout.write(f"   ⚠️  [{u.id}] '{u.nombre}' — estok_id={u.estok_id} (no existe)")

        # 3. Ubicaciones con nombre genérico/trunco (ej: "Nueva ubicación", vacío, etc.)
        #    que además no tienen contenedores ni objetos
        truncas_nombre = Ubicacion.objects.filter(
            estok__isnull=True,
            contenedores__isnull=True,
        ).distinct()
        self.stdout.write(f"\n🔍 Ubicaciones truncas (sin estok + sin contenedores): {truncas_nombre.count()}")

        total_eliminar = sin_estok.count() + len(huerfanas)
        self.stdout.write(f"\n{'='*60}")
        self.stdout.write(f"📊 TOTAL a eliminar: {total_eliminar} ubicaciones")

        if dry_run:
            self.stdout.write(self.style.WARNING(
                f"\n🧪 DRY RUN — No se eliminó nada. "
                f"Ejecuta sin --dry-run para borrar {total_eliminar} ubicaciones."
            ))
            return

        # Confirmación
        confirm = input(
            f"\n⚠️  ¿Eliminar {total_eliminar} ubicaciones truncas? (sí/no): "
        )
        if confirm.lower() not in ('sí', 'si', 's', 'yes', 'y'):
            self.stdout.write(self.style.WARNING("Operación cancelada."))
            return

        # Eliminar
        eliminadas = 0
        for u in list(sin_estok) + huerfanas:
            try:
                u.delete()
                eliminadas += 1
                self.stdout.write(f"   ✅ Eliminada: '{u.nombre}' [{u.id}]")
            except Exception as e:
                self.stdout.write(self.style.ERROR(
                    f"   ❌ Error al eliminar '{u.nombre}': {e}"
                ))

        self.stdout.write(self.style.SUCCESS(
            f"\n✅ Limpieza completada. {eliminadas} ubicaciones eliminadas."
        ))
