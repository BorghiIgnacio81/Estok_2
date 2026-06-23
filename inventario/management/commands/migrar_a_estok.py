"""
Comando one-shot: migra datos legacy al sistema multi-Estok.

Crea UN SOLO Estok llamado "Mi Inventario" y asigna:
- Todos los usuarios existentes como miembros (Admin si superuser, Editor si no)
- Todos los Objeto, Ubicacion, Contenedor existentes a ese Estok

Soporta --dry-run para previsualizar sin escribir nada.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from ...models import Estok, Membresia, Role, CustomUser, Objeto, Ubicacion, Contenedor


class Command(BaseCommand):
    help = "Migra datos legacy al sistema multi-Estok (one-shot)"

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help="Solo muestra lo que se haría sin escribir nada a la base de datos.",
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        self.stdout.write(self.style.NOTICE("=== MIGRACIÓN A SISTEMA MULTI-ESTOK ==="))
        if dry_run:
            self.stdout.write(self.style.WARNING("⚠️  MODO DRY-RUN: No se escribirá nada.\n"))

        # --- Verificar si ya hay Estoks ---
        estoks_existentes = Estok.objects.count()
        if estoks_existentes > 0 and not dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"Ya existen {estoks_existentes} Estok(s) en la base de datos. "
                    "Si ya se ejecutó esta migración antes, no es necesario repetirla."
                )
            )
            # Preguntar si continuar de todos modos
            confirm = input("¿Continuar de todas formas? (s/N): ").strip().lower()
            if confirm != 's':
                self.stdout.write(self.style.SUCCESS("Migración cancelada."))
                return

        # --- Obtener roles ---
        try:
            role_admin = Role.objects.get(name='Admin')
            role_editor = Role.objects.get(name='Editor')
        except Role.DoesNotExist as e:
            self.stdout.write(
                self.style.ERROR(f"Rol requerido no encontrado: {e}. "
                                 "Ejecutá primero 'python manage.py seed_data' o creá los roles manualmente.")
            )
            return

        # --- Contar datos existentes ---
        total_usuarios = CustomUser.objects.count()
        superusers = CustomUser.objects.filter(is_superuser=True)
        no_superusers = CustomUser.objects.filter(is_superuser=False)
        total_objetos = Objeto.objects.count()
        total_ubicaciones = Ubicacion.objects.count()
        total_contenedores = Contenedor.objects.count()

        self.stdout.write(f"\nDatos existentes:")
        self.stdout.write(f"  Usuarios totales:        {total_usuarios}")
        self.stdout.write(f"    → Superusers (Admin):  {superusers.count()}")
        self.stdout.write(f"    → No superusers (Editor): {no_superusers.count()}")
        self.stdout.write(f"  Objetos:                 {total_objetos}")
        self.stdout.write(f"  Ubicaciones:             {total_ubicaciones}")
        self.stdout.write(f"  Contenedores:            {total_contenedores}")

        if total_usuarios == 0:
            self.stdout.write(self.style.WARNING("No hay usuarios para migrar. Nada que hacer."))
            return

        # --- Mostrar plan ---
        self.stdout.write(f"\nPlan de migración:")
        self.stdout.write(f"  1. Crear Estok 'Mi Inventario'")
        self.stdout.write(f"  2. Crear {total_usuarios} Membresia(s):")
        for u in superusers:
            self.stdout.write(f"     - {u.username} → Admin")
        for u in no_superusers:
            self.stdout.write(f"     - {u.username} → Editor")
        self.stdout.write(f"  3. Asignar Estok a {total_objetos} Objeto(s)")
        self.stdout.write(f"  4. Asignar Estok a {total_ubicaciones} Ubicacion(es)")
        self.stdout.write(f"  5. Asignar Estok a {total_contenedores} Contenedor(es)")

        if dry_run:
            self.stdout.write(self.style.SUCCESS(
                "\n✅ Dry-run completado. No se escribió nada. "
                "Ejecutá sin --dry-run para aplicar la migración."
            ))
            return

        # --- Ejecutar migración ---
        confirm = input(f"\n¿Crear Estok 'Mi Inventario' y migrar {total_usuarios} usuarios, "
                        f"{total_objetos} objetos, {total_ubicaciones} ubicaciones y "
                        f"{total_contenedores} contenedores? (s/N): ").strip().lower()
        if confirm != 's':
            self.stdout.write(self.style.SUCCESS("Migración cancelada."))
            return

        with transaction.atomic():
            # 1. Crear Estok
            estok = Estok.objects.create(
                nombre="Mi Inventario",
                descripcion="Estok principal creado durante la migración desde el sistema legacy.",
            )
            self.stdout.write(self.style.SUCCESS(f"  ✅ Estok creado: '{estok.nombre}' (ID: {estok.id})"))

            # 2. Crear Membresias
            membresias_creadas = 0
            for user in superusers:
                Membresia.objects.create(usuario=user, estok=estok, role=role_admin)
                membresias_creadas += 1
                self.stdout.write(f"  ✅ Membresia: {user.username} → Admin")

            for user in no_superusers:
                Membresia.objects.create(usuario=user, estok=estok, role=role_editor)
                membresias_creadas += 1
                self.stdout.write(f"  ✅ Membresia: {user.username} → Editor")

            # 3. Asignar Estok a Objetos
            objetos_actualizados = Objeto.objects.filter(estok__isnull=True).update(estok=estok)
            self.stdout.write(f"  ✅ {objetos_actualizados} Objeto(s) asignados a '{estok.nombre}'")

            # 4. Asignar Estok a Ubicaciones
            ubicaciones_actualizadas = Ubicacion.objects.filter(estok__isnull=True).update(estok=estok)
            self.stdout.write(f"  ✅ {ubicaciones_actualizadas} Ubicacion(es) asignadas a '{estok.nombre}'")

            # 5. Asignar Estok a Contenedores
            contenedores_actualizados = Contenedor.objects.filter(estok__isnull=True).update(estok=estok)
            self.stdout.write(f"  ✅ {contenedores_actualizados} Contenedor(es) asignados a '{estok.nombre}'")

        self.stdout.write(self.style.SUCCESS(
            f"\n🎉 Migración completada exitosamente.\n"
            f"   Estok creado: '{estok.nombre}' (ID: {estok.id})\n"
            f"   Membresias creadas: {membresias_creadas}\n"
            f"   Objetos migrados: {objetos_actualizados}\n"
            f"   Ubicaciones migradas: {ubicaciones_actualizadas}\n"
            f"   Contenedores migrados: {contenedores_actualizados}"
        ))
