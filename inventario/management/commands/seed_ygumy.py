"""
Comando de gestión para crear el usuario ygumy44@gmail.com con rol Admin.

Uso:
    python manage.py seed_ygumy
"""

from django.core.management.base import BaseCommand
from inventario.models import Role, CustomUser, Membresia


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
            'first_name': 'Ygumy',
            'last_name': '44',
            # NOTA: CustomUser NO tiene campo `role` global (RBAC por Membresia).
            'description': 'Usuario principal',
            'phone': '',
            'is_staff': True,
            'is_superuser': True,
            'is_active': True,
            # NOTA CRÍTICA: el campo `password` NO va en defaults. La contraseña
            # por defecto se aplica EXCLUSIVAMENTE en la creación inicial con
            # set_password() (abajo). Si el usuario ya existe, su clave
            # personalizada jamás debe ser sobrescrita (bug crítico de
            # persistencia de contraseñas en producción).
        }

        user, created = CustomUser.objects.update_or_create(
            username='ygumy44',
            defaults=user_data,
        )

        if created:
            # Creación por primera vez: única oportunidad legítima para
            # inyectar la contraseña por defecto (C05m05).
            user.set_password('C05m05')
            user.save(update_fields=['password'])
            self.stdout.write(self.style.SUCCESS(
                '  ✓ Usuario ygumy44 creado exitosamente (password por defecto aplicado)'
            ))
        else:
            # El usuario YA EXISTE: se respeta su contraseña personalizada.
            # NO se toca el hash del password bajo ninguna circunstancia.
            # (update_or_create ya actualizó el perfil sin incluir la clave.)
            self.stdout.write(self.style.SUCCESS(
                '  ✓ Usuario ygumy44 actualizado (password PRESERVADO)'
            ))

        # ---------------------------------------------------------------------
        # 3. Asignar membresía al Estok Principal (tenant global)
        # ---------------------------------------------------------------------
        from inventario.services.tenant import get_or_create_estok_principal
        estok_base, _ = get_or_create_estok_principal()
        _, membresia_created = Membresia.objects.get_or_create(
            usuario=user,
            estok=estok_base,
            defaults={'role': admin_role, 'privacidad': 'compartido'},
        )
        if membresia_created:
            self.stdout.write(self.style.SUCCESS(
                f'  ✓ Membresía ygumy44 → {estok_base.nombre} creada (rol Admin)'
            ))
        else:
            self.stdout.write(
                f'  - Membresía ygumy44 → {estok_base.nombre} ya existente.'
            )

        # ---------------------------------------------------------------------
        # 4. Verificar datos del usuario
        # ---------------------------------------------------------------------
        self.stdout.write(self.style.NOTICE('\n--- Datos del usuario ---'))
        self.stdout.write(f'  Username:  {user.username}')
        self.stdout.write(f'  Email:     {user.email}')
        self.stdout.write(
            f'  Password:  C05m05' if created
            else '  Password:  (personalizada — preservada)'
        )
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
            (
                '   Email: ygumy44@gmail.com / Contraseña: C05m05'
                if created
                else '   Email: ygumy44@gmail.com / Contraseña: (personalizada — preservada)'
            )
        ))
