"""
Comando one-shot: migra los datos existentes al modelo multi-estok.

Crea un Estok por cada usuario existente que tenga objetos/ubicaciones/contenedores,
y asigna esos recursos al Estok correspondiente.

Ejecutar después de aplicar la migración 0002:
    python manage.py migrate
    python manage.py migrar_a_estok

Es seguro ejecutarlo múltiples veces (idempotente).
"""

import logging
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from inventario.models import Estok, Membresia, Objeto, Ubicacion, Contenedor

logger = logging.getLogger(__name__)
User = get_user_model()


class Command(BaseCommand):
    help = "Migra datos existentes al modelo multi-estok (one-shot)"

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE("=== Migración a Estok ==="))
        usuarios_procesados = 0
        estoks_creados = 0
        objetos_asignados = 0
        ubicaciones_asignadas = 0
        contenedores_asignados = 0

        for user in User.objects.all():
            # Verificar si el usuario ya tiene un Estok (idempotencia)
            if Membresia.objects.filter(usuario=user).exists():
                self.stdout.write(f"  ⏭️  {user.username} ya tiene Estok, saltando...")
                continue

            # Buscar objetos, ubicaciones y contenedores del usuario
            # (sin estok asignado todavía)
            objetos = Objeto.objects.filter(estok__isnull=True)
            ubicaciones = Ubicacion.objects.filter(estok__isnull=True)
            contenedores = Contenedor.objects.filter(estok__isnull=True)

            total = objetos.count() + ubicaciones.count() + contenedores.count()
            if total == 0:
                self.stdout.write(f"  ⏭️  {user.username} no tiene datos sin Estok, saltando...")
                continue

            # Crear Estok para el usuario
            estok = Estok.objects.create(
                nombre=f"Inventario de {user.get_full_name() or user.username}",
                descripcion=f"Estok personal de {user.username}",
            )
            estoks_creados += 1

            # Crear membresía admin
            Membresia.objects.create(
                estok=estok,
                usuario=user,
                rol_en_estok='admin',
                invitacion_aceptada=True,
            )

            # Asignar objetos al Estok
            for obj in objetos:
                obj.estok = estok
                obj.save(update_fields=['estok'])
                objetos_asignados += 1

            # Asignar ubicaciones al Estok
            for ubi in ubicaciones:
                ubi.estok = estok
                ubi.save(update_fields=['estok'])
                ubicaciones_asignadas += 1

            # Asignar contenedores al Estok
            for cont in contenedores:
                cont.estok = estok
                cont.save(update_fields=['estok'])
                contenedores_asignados += 1

            usuarios_procesados += 1
            self.stdout.write(
                self.style.SUCCESS(
                    f"  ✅ {user.username}: Estok '{estok.nombre}' creado "
                    f"({objetos.count()} objetos, {ubicaciones.count()} ubicaciones, "
                    f"{contenedores.count()} contenedores)"
                )
            )

        self.stdout.write(self.style.SUCCESS(
            f"\n=== Resumen ==="
            f"\n  Usuarios procesados: {usuarios_procesados}"
            f"\n  Estoks creados: {estoks_creados}"
            f"\n  Objetos asignados: {objetos_asignados}"
            f"\n  Ubicaciones asignadas: {ubicaciones_asignadas}"
            f"\n  Contenedores asignados: {contenedores_asignados}"
        ))
