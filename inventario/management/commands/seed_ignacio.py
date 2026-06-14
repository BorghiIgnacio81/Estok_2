"""
Comando de gestión para crear el usuario Ignacio Borghi con rol Admin.

Uso:
    python manage.py seed_ignacio
"""

from django.core.management.base import BaseCommand
from django.contrib.auth.hashers import make_password
from inventario.models import Role, CustomUser


class Command(BaseCommand):
    help = 'Crea el usuario Ignacio Borghi con rol Admin para pruebas'

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE('Creando usuario Ignacio Borghi...'))

        # ---------------------------------------------------------------------
        # 1. Asegurar que existe el rol Admin
        # ---------------------------------------------------------------------
        admin_role, created = Role.objects.get_or_create(
            name='Admin',
            defaults={
                'description': 'Administrador del sistema con todos los permisos.',
                'can_read': True,
                'can_write': True,
                'can_edit': True,
                'can_delete': True,
            }
        )
        if created:
            self.stdout.write(self.style.SUCCESS('  ✓ Rol Admin creado'))
        else:
            self.stdout.write('  - Rol Admin ya existente')

        # ---------------------------------------------------------------------
        # 2. Crear o actualizar usuario Ignacio Borghi
        # ---------------------------------------------------------------------
        user_data = {
            'email': 'ignacio.borghi@estok.com',
            'password': make_password('S0l3d4d'),
            'first_name': 'Ignacio',
            'last_name': 'Borghi',
            'role': admin_role,
            'description': 'Administrador del sistema - Ignacio Borghi',
            'phone': '',
            'is_staff': True,
            'is_superuser': True,
            'is_active': True,
        }

        user, created = CustomUser.objects.update_or_create(
            username='ignacio_borghi',
            defaults=user_data,
        )

        if created:
            self.stdout.write(self.style.SUCCESS(
                '  ✓ Usuario Ignacio Borghi creado exitosamente'
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                '  ✓ Usuario Ignacio Borghi actualizado exitosamente'
            ))

        # ---------------------------------------------------------------------
        # 3. Verificar datos del usuario
        # ---------------------------------------------------------------------
        self.stdout.write(self.style.NOTICE('\n--- Datos del usuario ---'))
        self.stdout.write(f'  Username:  {user.username}')
        self.stdout.write(f'  Nombre:    {user.get_full_name()}')
        self.stdout.write(f'  Email:     {user.email}')
        self.stdout.write(f'  Rol:       {user.role.name if user.role else "Sin rol"}')
        self.stdout.write(f'  Staff:     {user.is_staff}')
        self.stdout.write(f'  Superuser: {user.is_superuser}')
        self.stdout.write(f'  Activo:    {user.is_active}')

        # ---------------------------------------------------------------------
        # Resumen final
        # ---------------------------------------------------------------------
        self.stdout.write(self.style.SUCCESS(
            '\n✅ Usuario Ignacio Borghi listo para usar.'
        ))
        self.stdout.write(self.style.NOTICE(
            '   Credenciales: ignacio_borghi / S0l3d4d'
        ))
