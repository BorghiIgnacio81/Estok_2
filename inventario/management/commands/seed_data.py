"""
Comando de gestión para poblar la base de datos con datos iniciales (seeds).

Crea los roles básicos del sistema, el primer usuario administrador,
el tenant global "Estok Principal" y la membresía del admin a ese Estok.

IMPORTANTE (taxonomía unificada):
- CustomUser ya NO tiene campo `role` global (el RBAC se asigna por Membresia).
- Por eso el admin se crea como superuser directo, sin `role=`.
- El tenant global "Estok Principal" se crea aquí para que
  cargar_categorias_meli encuentre al menos un Estok al repoblar
  las 11 categorías oficiales.

Uso:
    python manage.py seed_data
"""

from django.core.management.base import BaseCommand
from django.contrib.auth.hashers import make_password
from inventario.models import Role, CustomUser, Membresia


class Command(BaseCommand):
    help = 'Crea los datos iniciales: roles básicos, usuario administrador y Estok Principal'

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE('Iniciando carga de datos iniciales...'))

        # ---------------------------------------------------------------------
        # 1. Crear Roles Básicos
        # ---------------------------------------------------------------------
        roles_data = [
            {
                'name': 'Admin',
                'description': 'Administrador del sistema con todos los permisos.',
                'can_read': True,
                'can_write': True,
                'can_edit': True,
                'can_delete': True,
            },
            {
                'name': 'Editor',
                'description': 'Puede leer, escribir y editar, pero no eliminar.',
                'can_read': True,
                'can_write': True,
                'can_edit': True,
                'can_delete': False,
            },
            {
                'name': 'Visualizador',
                'description': 'Acceso de solo lectura. No puede modificar ni eliminar.',
                'can_read': True,
                'can_write': False,
                'can_edit': False,
                'can_delete': False,
            },
        ]

        created_roles = []
        for role_data in roles_data:
            role, created = Role.objects.get_or_create(
                name=role_data['name'],
                defaults=role_data
            )
            if created:
                created_roles.append(role.name)
                self.stdout.write(self.style.SUCCESS(f'  ✓ Rol creado: {role.name}'))
            else:
                self.stdout.write(f'  - Rol ya existente: {role.name}')

        admin_role = Role.objects.get(name='Admin')

        # ---------------------------------------------------------------------
        # 2. Crear Usuario Administrador
        # ---------------------------------------------------------------------
        # OJO: CustomUser NO tiene campo `role` global. El RBAC se asigna por
        # Membresia (por Estok). NO pasar `role=` aquí (causa FieldError).
        admin_user, created = CustomUser.objects.get_or_create(
            username='admin',
            defaults={
                'email': 'admin@estok.com',
                'password': make_password('admin123'),
                'first_name': 'Administrador',
                'last_name': 'del Sistema',
                'description': 'Administrador principal del sistema',
                'is_staff': True,
                'is_superuser': True,
            }
        )

        if created:
            self.stdout.write(self.style.SUCCESS(
                '  ✓ Usuario administrador creado: admin / admin123'
            ))
        else:
            self.stdout.write('  - Usuario administrador ya existente.')

        # ---------------------------------------------------------------------
        # 3. Crear Estok Principal (tenant global, necesario para cargar_categorias_meli)
        # ---------------------------------------------------------------------
        from inventario.services.tenant import get_or_create_estok_principal
        estok_base, estok_created = get_or_create_estok_principal()
        if estok_created:
            self.stdout.write(self.style.SUCCESS(
                f'  ✓ Estok Principal creado: {estok_base.nombre} (ID: {estok_base.id})'
            ))
        else:
            self.stdout.write(f'  - Estok Principal ya existente: {estok_base.nombre}')

        # ---------------------------------------------------------------------
        # 4. Asignar Membresía del admin al Estok Principal
        # ---------------------------------------------------------------------
        _, membresia_created = Membresia.objects.get_or_create(
            usuario=admin_user,
            estok=estok_base,
            defaults={
                'role': admin_role,
                'privacidad': 'compartido',
            }
        )
        if membresia_created:
            self.stdout.write(self.style.SUCCESS(
                '  ✓ Membresía admin → Estok Principal creada (rol Admin)'
            ))
        else:
            self.stdout.write('  - Membresía admin → Estok Principal ya existente.')

        # ---------------------------------------------------------------------
        # Resumen final
        # ---------------------------------------------------------------------
        self.stdout.write(self.style.SUCCESS(
            '\n✅ Carga de datos iniciales completada exitosamente.'
        ))
        self.stdout.write(self.style.NOTICE(
            f'Roles creados: {", ".join(created_roles) if created_roles else "Ninguno (ya existían)"}'
        ))
