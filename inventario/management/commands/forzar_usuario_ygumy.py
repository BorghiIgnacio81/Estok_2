"""
Comando de emergencia para forzar el acceso del usuario ygumy44 en producción.

Usado cuando la base de datos quedó en un estado inconsistente tras un refactor
de CustomUser (401 Unauthorized en /api/token/). Este comando:

1. Crea (o actualiza) el CustomUser unificado con username="ygumy44".
2. Fuerza su contraseña con set_password().
3. Lo marca como is_staff=True e is_superuser=True.
4. Vincula al usuario al tenant global "Estok Principal" con rol Admin
   mediante la Membresia correspondiente.

Uso:
    python manage.py forzar_usuario_ygumy
"""

from django.core.management.base import BaseCommand

from inventario.models import CustomUser, Membresia, Role
from inventario.services.tenant import get_or_create_estok_principal

USERNAME = 'ygumy44'
EMAIL = 'ygumy44@gmail.com'
# Contraseña real usada para loguearse (misma que define seed_ygumy.py).
PASSWORD = 'C05m05'
FIRST_NAME = 'Ygumy'
LAST_NAME = '44'


class Command(BaseCommand):
    help = 'Fuerza el acceso del usuario ygumy44 en producción (superuser + Estok Principal)'

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE('🔐 Forzando usuario ygumy44...'))

        # ---------------------------------------------------------------------
        # 1. Asegurar que existe el rol Admin (necesario para la Membresia)
        # ---------------------------------------------------------------------
        admin_role, role_created = Role.objects.get_or_create(
            name='Admin',
            defaults={
                'description': 'Administrador del sistema con todos los permisos.',
                'can_read': True,
                'can_write': True,
                'can_edit': True,
                'can_delete': True,
            },
        )
        if role_created:
            self.stdout.write(self.style.SUCCESS('  ✓ Rol Admin creado'))
        else:
            self.stdout.write('  - Rol Admin ya existente')

        # ---------------------------------------------------------------------
        # 2. Crear (o actualizar) el CustomUser unificado
        # ---------------------------------------------------------------------
        user, created = CustomUser.objects.get_or_create(
            username=USERNAME,
            defaults={
                'email': EMAIL,
                'first_name': FIRST_NAME,
                'last_name': LAST_NAME,
                'description': 'Usuario principal',
                'phone': '',
                'is_staff': True,
                'is_superuser': True,
                'is_active': True,
            },
        )

        # Forzar los flags y la contraseña SIEMPRE (aunque ya exista)
        user.email = EMAIL
        user.first_name = FIRST_NAME
        user.last_name = LAST_NAME
        user.is_staff = True
        user.is_superuser = True
        user.is_active = True
        user.set_password(PASSWORD)
        user.save()

        if created:
            self.stdout.write(self.style.SUCCESS(
                f'  ✓ Usuario {USERNAME} creado exitosamente'
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                f'  ✓ Usuario {USERNAME} actualizado (flags superuser + password forzados)'
            ))

        # ---------------------------------------------------------------------
        # 3. Asegurar el tenant global "Estok Principal"
        # ---------------------------------------------------------------------
        estok_base, estok_created = get_or_create_estok_principal()
        if estok_created:
            self.stdout.write(self.style.SUCCESS(
                f'  ✓ Estok "{estok_base.nombre}" creado (ID: {estok_base.id})'
            ))
        else:
            self.stdout.write(
                f'  - Estok "{estok_base.nombre}" ya existente (ID: {estok_base.id})'
            )

        # ---------------------------------------------------------------------
        # 4. Vincular al usuario con el tenant mediante Membresia (rol Admin)
        # ---------------------------------------------------------------------
        _, membresia_created = Membresia.objects.get_or_create(
            usuario=user,
            estok=estok_base,
            defaults={
                'role': admin_role,
                'privacidad': 'compartido',
            },
        )
        if membresia_created:
            self.stdout.write(self.style.SUCCESS(
                f'  ✓ Membresía {USERNAME} → {estok_base.nombre} creada (rol Admin)'
            ))
        else:
            self.stdout.write(
                f'  - Membresía {USERNAME} → {estok_base.nombre} ya existente.'
            )

        # ---------------------------------------------------------------------
        # Resumen final
        # ---------------------------------------------------------------------
        self.stdout.write(self.style.SUCCESS(
            '\n✅ Usuario ygumy44 listo para iniciar sesión.'
        ))
        self.stdout.write(self.style.NOTICE(
            f'   Usuario: {USERNAME} / Email: {EMAIL} / Password: {PASSWORD}'
        ))
        self.stdout.write(f'   Staff: {user.is_staff} / Superuser: {user.is_superuser} / Activo: {user.is_active}')
