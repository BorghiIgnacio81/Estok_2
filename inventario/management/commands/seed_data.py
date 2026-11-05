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
from inventario.services.feature_flags import sembrar_flags_estandar


class Command(BaseCommand):
    help = 'Crea los datos iniciales: roles básicos, usuario administrador y Estok Principal'

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE('Iniciando carga de datos iniciales...'))

        # ---------------------------------------------------------------------
        # 1. Asegurar los ROLES ESTÁNDAR (permisos garantizados en cada deploy)
        # ---------------------------------------------------------------------
        # Se usa update_or_create a propósito: el comando NO sólo crea lo que
        # falta, también GARANTIZA los permisos de los roles estándar (un rol
        # editado a mano en el admin vuelve a su definición canónica).
        # El NOMBRE no se renombra nunca: el código busca estos roles por nombre
        # (Role.objects.get(name='Admin') en el alta de Estok, EsAdminDelEstok,
        # etc.). El "nombre comercial" (Admin del Hogar / Editor Familiar /
        # Visualizador-Beneficiario) va en la descripción.
        roles_data = [
            {
                'name': 'Admin',
                'description': (
                    'Admin del Hogar: todos los permisos del Estok '
                    '(leer, escribir, editar y eliminar).'
                ),
                'can_read': True,
                'can_write': True,
                'can_edit': True,
                'can_delete': True,
            },
            {
                'name': 'Editor',
                'description': (
                    'Editor Familiar: puede leer, escribir y editar, pero no eliminar.'
                ),
                'can_read': True,
                'can_write': True,
                'can_edit': True,
                'can_delete': False,
            },
            {
                'name': 'Visualizador',
                'description': (
                    'Visualizador / Beneficiario: acceso de solo lectura. '
                    'No puede modificar ni eliminar.'
                ),
                'can_read': True,
                'can_write': False,
                'can_edit': False,
                'can_delete': False,
            },
            {
                'name': 'Administrador Físico',
                'description': (
                    'Encargado de Almacén / Gestor del espacio físico: además de '
                    'editar, es el único rol que puede confirmar el descarte final '
                    'de objetos y despachar los envíos vendidos.'
                ),
                'can_read': True,
                'can_write': True,
                'can_edit': True,
                'can_delete': False,
                'es_administrador_fisico': True,
            },
        ]

        created_roles = []
        for role_data in roles_data:
            datos = dict(role_data)
            nombre = datos.pop('name')
            # `es_administrador_fisico` se OMITE en los roles estándar para no
            # pisar una configuración manual del Admin Global; sólo el rol
            # «Administrador Físico» lo declara explícitamente.
            if nombre != 'Administrador Físico':
                datos.pop('es_administrador_fisico', None)

            role, created = Role.objects.update_or_create(
                name=nombre,
                defaults=datos,
            )
            if created:
                created_roles.append(role.name)
                self.stdout.write(self.style.SUCCESS(f'  ✓ Rol creado: {role.name}'))
            else:
                self.stdout.write(f'  - Rol asegurado (permisos canónicos): {role.name}')

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
        # 5. Sembrar los FEATURE FLAGS estándar (Control de Funcionalidades)
        # ---------------------------------------------------------------------
        # Idempotente: crea las filas que falten con el estado inicial
        # (activo_global=True + modo_promocional=True, para no cortar ninguna
        # función existente) y NO pisa lo que el Admin Global ya configuró.
        # Los switches se manejan desde el admin: «Feature Flags (control de
        # funcionalidades)».
        resultado_flags = sembrar_flags_estandar()
        if resultado_flags['creados']:
            self.stdout.write(self.style.SUCCESS(
                f'  ✓ Feature Flags creados: {", ".join(resultado_flags["creados"])}'
            ))
        if resultado_flags['existentes']:
            self.stdout.write(
                f'  - Feature Flags ya existentes: '
                f'{", ".join(resultado_flags["existentes"])}'
            )

        # ---------------------------------------------------------------------
        # Resumen final
        # ---------------------------------------------------------------------
        self.stdout.write(self.style.SUCCESS(
            '\n✅ Carga de datos iniciales completada exitosamente.'
        ))
        self.stdout.write(self.style.NOTICE(
            f'Roles creados: {", ".join(created_roles) if created_roles else "Ninguno (ya existían)"}'
        ))
