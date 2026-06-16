"""
Comando de gestión para crear el usuario ygumy44@gmail.com con rol Admin.

Uso:
    python manage.py seed_ygumy
"""

from django.core.management.base import BaseCommand
from django.contrib.auth.hashers import make_password
from inventario.models import Role, CustomUser


class Command(BaseCommand):
    help = 'Crea el usuario ygumy44@gmail.com con rol Admin'

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE('Creando usuario ygumy44@gmail.com...'))

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
        # 2. Crear o actualizar usuario ygumy44
        # ---------------------------------------------------------------------
        user_data = {
            'email': 'ygumy44@gmail.com',
            'password': make_password('C05m05'),
            'first_name': 'Ygumy',
            'last_name': '44',
            'role': admin_role,
            'description': 'Usuario principal',
            'phone': '',
            'is_staff': True,
            'is_superuser': True,
            'is_active': True,
        }

        user, created = CustomUser.objects.update_or_create(
            username='ygumy44',
            defaults=user_data,
        )

        if created:
            self.stdout.write(self.style.SUCCESS(
                '  ✓ Usuario ygumy44 creado exitosamente'
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                '  ✓ Usuario ygumy44 actualizado exitosamente'
            ))

        # ---------------------------------------------------------------------
        # 3. Verificar datos del usuario
        # ---------------------------------------------------------------------
        self.stdout.write(self.style.NOTICE('\n--- Datos del usuario ---'))
        self.stdout.write(f'  Username:  {user.username}')
        self.stdout.write(f'  Email:     {user.email}')
        self.stdout.write(f'  Password:  C05m05')
        self.stdout.write(f'  Staff:     {user.is_staff}')
        self.stdout.write(f'  Superuser: {user.is_superuser}')
        self.stdout.write(f'  Activo:    {user.is_active}')

        # ---------------------------------------------------------------------
        # Resumen final
        # ---------------------------------------------------------------------
        self.stdout.write(self.style.SUCCESS(
            '\n✅ Usuario ygumy44 listo para usar.'
        ))
        self.stdout.write(self.style.NOTICE(
            '   Email: ygumy44@gmail.com / Contraseña: C05m05'
        ))
