"""
Comando de gestión para poblar la base de datos con datos iniciales (seeds).

Crea los roles básicos del sistema y el primer usuario administrador.

Uso:
    python manage.py seed_data
"""

from django.core.management.base import BaseCommand
from django.contrib.auth.hashers import make_password
from inventario.models import Role, CustomUser


class Command(BaseCommand):
    help = 'Crea los datos iniciales: roles básicos y usuario administrador'

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

        # ---------------------------------------------------------------------
        # 2. Crear Usuario Administrador
        # ---------------------------------------------------------------------
        admin_role = Role.objects.get(name='Admin')

        admin_user, created = CustomUser.objects.get_or_create(
            username='admin',
            defaults={
                'email': 'admin@estok.com',
                'password': make_password('admin123'),
                'first_name': 'Administrador',
                'last_name': 'del Sistema',
                'role': admin_role,
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
        # Resumen final
        # ---------------------------------------------------------------------
        self.stdout.write(self.style.SUCCESS(
            '\n✅ Carga de datos iniciales completada exitosamente.'
        ))
        self.stdout.write(self.style.NOTICE(
            f'Roles creados: {", ".join(created_roles) if created_roles else "Ninguno (ya existían)"}'
        ))
