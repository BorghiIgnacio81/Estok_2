"""
Comando de emergencia para forzar el acceso del usuario ygumy44 en producción.

Usado cuando la base de datos quedó en un estado inconsistente tras un refactor
de CustomUser (401 Unauthorized en /api/token/). Este comando:

1. Crea (o actualiza) el CustomUser unificado con username="ygumy44".
2. Fuerza su contraseña con set_password().
3. Lo marca como is_staff=True e is_superuser=True.
4. Vincula al usuario al tenant global "Estok Principal" con rol Admin
   mediante la Membresia correspondiente.
5. Vincula al usuario al tenant "Casa Borghi Federación" con rol Admin
   (localizado por UUID o por nombre), restaurando la Membresia que el
   reset de la base de datos en producción dejó sin crear.

Uso:
    python manage.py forzar_usuario_ygumy
"""

from django.core.management.base import BaseCommand

from inventario.models import CustomUser, Estok, Membresia, Role
from inventario.services.tenant import get_or_create_estok_principal

USERNAME = 'ygumy44'
EMAIL = 'ygumy44@gmail.com'
# Contraseña real usada para loguearse (misma que define seed_ygumy.py).
PASSWORD = 'C05m05'
FIRST_NAME = 'Ygumy'
LAST_NAME = '44'

# Segundo inquilino legítimo de ygumy44: "Casa Borghi Federación".
# Se localiza primero por UUID (rápido) y luego por nombre, de forma que el
# comando siga funcionando aunque el reset de la BD haya regenerado el UUID.
ESTOK_BORGHI_UUID = '4617d670-38b0-4998-9112-b091b1cd1981'
ESTOK_BORGHI_NOMBRE = 'Casa Borghi Federación'


class Command(BaseCommand):
    help = 'Fuerza el acceso del usuario ygumy44 en producción (superuser + Estok Principal + Casa Borghi Federación)'

    def _vincular_membresia_admin(self, user, estok, admin_role):
        """
        Crea (o reutiliza) la Membresia de `user` en `estok` con rol Admin.

        Devuelve la tupla (membresia, created) para que el llamador pueda
        reportar si la relación se inyectó o ya existía. Idempotente gracias
        a unique_together (usuario, estok).
        """
        return Membresia.objects.get_or_create(
            usuario=user,
            estok=estok,
            defaults={
                'role': admin_role,
                'privacidad': 'compartido',
            },
        )

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
        _, membresia_created = self._vincular_membresia_admin(user, estok_base, admin_role)
        if membresia_created:
            self.stdout.write(self.style.SUCCESS(
                f'  ✓ Membresía {USERNAME} → {estok_base.nombre} creada (rol Admin)'
            ))
        else:
            self.stdout.write(
                f'  - Membresía {USERNAME} → {estok_base.nombre} ya existente.'
            )

        # ---------------------------------------------------------------------
        # 5. Inyección relacional: "Casa Borghi Federación"
        #    Se localiza primero por UUID (rápido) y luego por nombre. Restaura
        #    la Membresia que el reset de la BD en producción dejó sin crear.
        # ---------------------------------------------------------------------
        estok_borghi = Estok.objects.filter(id=ESTOK_BORGHI_UUID).first()
        if estok_borghi is None:
            estok_borghi = Estok.objects.filter(nombre=ESTOK_BORGHI_NOMBRE).first()

        if estok_borghi is not None:
            self.stdout.write(
                f'  - Estok "{estok_borghi.nombre}" localizado (ID: {estok_borghi.id})'
            )
            _, membresia_borghi_created = self._vincular_membresia_admin(
                user, estok_borghi, admin_role
            )
            if membresia_borghi_created:
                self.stdout.write(self.style.SUCCESS(
                    f'  ✓ Membresía {USERNAME} → {estok_borghi.nombre} creada (rol Admin)'
                ))
            else:
                self.stdout.write(
                    f'  - Membresía {USERNAME} → {estok_borghi.nombre} ya existente.'
                )
        else:
            self.stdout.write(self.style.WARNING(
                f'  ⚠ Estok "{ESTOK_BORGHI_NOMBRE}" no encontrado — no se pudo '
                f'inyectar la Membresía. Verificar que el inquilino exista en la BD.'
            ))

        # ---------------------------------------------------------------------
        # Resumen final
        # ---------------------------------------------------------------------
        self.stdout.write(self.style.SUCCESS(
            '\n✅ Usuario ygumy44 listo para iniciar sesión.'
        ))
        self.stdout.write(
            f'   Estoks vinculados: {user.membresias.count()}'
        )
        self.stdout.write(self.style.NOTICE(
            f'   Usuario: {USERNAME} / Email: {EMAIL} / Password: {PASSWORD}'
        ))
        self.stdout.write(f'   Staff: {user.is_staff} / Superuser: {user.is_superuser} / Activo: {user.is_active}')
