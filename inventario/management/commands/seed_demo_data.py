"""
Comando para poblar la base de datos con datos de demostración completos.

Crea:
- Roles básicos (Admin, Editor, Visualizador)
- Usuario admin
- Un Estok de demostración
- Ubicaciones y contenedores
- Objetos de prueba de varios tipos (libro, tecnología, mueble, ropa, objeto genérico)

Uso:
    python manage.py seed_demo_data
"""

from django.core.management.base import BaseCommand
from django.contrib.auth.hashers import make_password
from django.utils import timezone
from inventario.models import (
    Role, CustomUser, Estok, Membresia,
    Ubicacion, Contenedor,
    Objeto, LibroRevista, Tecnologia, MuebleArte, Ropa,
)
import uuid


class Command(BaseCommand):
    help = 'Crea datos de demostración: roles, admin, estok, ubicaciones, contenedores y objetos'

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE('🚀 Iniciando carga de datos de demostración...'))

        # =========================================================================
        # 1. Crear Roles Básicos
        # =========================================================================
        self.stdout.write(self.style.NOTICE('\n📋 Creando roles...'))
        roles_data = [
            {'name': 'Admin', 'description': 'Administrador del sistema con todos los permisos.', 'can_read': True, 'can_write': True, 'can_edit': True, 'can_delete': True},
            {'name': 'Editor', 'description': 'Puede leer, escribir y editar, pero no eliminar.', 'can_read': True, 'can_write': True, 'can_edit': True, 'can_delete': False},
            {'name': 'Visualizador', 'description': 'Acceso de solo lectura.', 'can_read': True, 'can_write': False, 'can_edit': False, 'can_delete': False},
        ]
        created_roles = []
        for rd in roles_data:
            role, created = Role.objects.get_or_create(name=rd['name'], defaults=rd)
            if created:
                created_roles.append(role.name)
                self.stdout.write(self.style.SUCCESS(f'  ✓ Rol creado: {role.name}'))
            else:
                self.stdout.write(f'  - Rol ya existente: {role.name}')

        admin_role = Role.objects.get(name='Admin')

        # =========================================================================
        # 2. Crear Usuario Administrador
        # =========================================================================
        self.stdout.write(self.style.NOTICE('\n👤 Creando usuario administrador...'))
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
            self.stdout.write(self.style.SUCCESS('  ✓ Usuario admin creado: admin / admin123'))
        else:
            self.stdout.write('  - Usuario admin ya existente.')

        # =========================================================================
        # 3. Crear Estok de Demostración
        # =========================================================================
        self.stdout.write(self.style.NOTICE('\n🏢 Creando Estok de demostración...'))
        estok_demo, created = Estok.objects.get_or_create(
            nombre='Estok Demo',
            defaults={
                'descripcion': 'Estok de demostración con datos de prueba para verificar el funcionamiento del sistema',
            }
        )
        if created:
            self.stdout.write(self.style.SUCCESS(f'  ✓ Estok creado: {estok_demo.nombre} (ID: {estok_demo.id})'))
        else:
            self.stdout.write(f'  - Estok ya existente: {estok_demo.nombre}')

        # Asignar admin al Estok Demo
        Membresia.objects.get_or_create(
            usuario=admin_user,
            estok=estok_demo,
            defaults={'role': admin_role, 'privacidad': 'compartido'}
        )

        # =========================================================================
        # 4. Crear Ubicaciones
        # =========================================================================
        self.stdout.write(self.style.NOTICE('\n📍 Creando ubicaciones...'))
        ubicaciones_data = [
            {'nombre': 'Garaje', 'descripcion': 'Garaje principal de la casa', 'estok': estok_demo},
            {'nombre': 'Living', 'descripcion': 'Living comedor', 'estok': estok_demo},
            {'nombre': 'Dormitorio Principal', 'descripcion': 'Habitación principal', 'estok': estok_demo},
            {'nombre': 'Depósito', 'descripcion': 'Depósito de objetos varios', 'estok': estok_demo},
            {'nombre': 'Cocina', 'descripcion': 'Cocina', 'estok': estok_demo},
        ]
        ubicaciones = {}
        for ud in ubicaciones_data:
            ubi, created = Ubicacion.objects.get_or_create(
                nombre=ud['nombre'],
                estok=ud['estok'],
                defaults={'descripcion': ud['descripcion']}
            )
            ubicaciones[ud['nombre']] = ubi
            if created:
                self.stdout.write(self.style.SUCCESS(f'  ✓ Ubicación: {ubi.nombre}'))
            else:
                self.stdout.write(f'  - Ubicación ya existente: {ubi.nombre}')

        # =========================================================================
        # 5. Crear Contenedores
        # =========================================================================
        self.stdout.write(self.style.NOTICE('\n📦 Creando contenedores...'))
        contenedores_data = [
            {'nombre': 'Estante A', 'descripcion': 'Estante metálico grande', 'ubicacion': 'Garaje'},
            {'nombre': 'Caja de Herramientas', 'descripcion': 'Caja roja de herramientas', 'ubicacion': 'Garaje'},
            {'nombre': 'Biblioteca', 'descripcion': 'Biblioteca de madera', 'ubicacion': 'Living'},
            {'nombre': 'Cajonera', 'descripcion': 'Cajonera de plástico blanca', 'ubicacion': 'Dormitorio Principal'},
            {'nombre': 'Baúl', 'descripcion': 'Baúl antiguo de madera', 'ubicacion': 'Depósito'},
            {'nombre': 'Estante B', 'descripcion': 'Estante de plástico', 'ubicacion': 'Depósito'},
        ]
        contenedores = {}
        for cd in contenedores_data:
            ubi = ubicaciones[cd['ubicacion']]
            cont, created = Contenedor.objects.get_or_create(
                nombre=cd['nombre'],
                ubicacion=ubi,
                defaults={'descripcion': cd['descripcion']}
            )
            contenedores[cd['nombre']] = cont
            if created:
                self.stdout.write(self.style.SUCCESS(f'  ✓ Contenedor: {cont.nombre} (en {ubi.nombre})'))
            else:
                self.stdout.write(f'  - Contenedor ya existente: {cont.nombre}')

        # =========================================================================
        # 6. Crear Objetos de Prueba
        # =========================================================================
        self.stdout.write(self.style.NOTICE('\n🎯 Creando objetos de prueba...'))

        objetos_data = [
            # Objeto genérico
            {
                'nombre': 'Jarrón Chino',
                'descripcion': 'Jarrón de porcelana china decorado con dragones. Herencia familiar.',
                'estok': estok_demo,
                'ubicacion': 'Living',
                'contenedor': None,
                'estado_conservacion': 'excelente',
                'valor_estimado': 1500.00,
                'color': 'Blanco y azul',
                'estado_carga': 'completo',
                'tipo': 'objeto',
            },
            # Libro
            {
                'nombre': 'Cien Años de Soledad',
                'descripcion': 'Novela de Gabriel García Márquez. Edición conmemorativa.',
                'estok': estok_demo,
                'ubicacion': 'Living',
                'contenedor': 'Biblioteca',
                'estado_conservacion': 'bueno',
                'valor_estimado': 45.00,
                'color': 'Rojo',
                'estado_carga': 'completo',
                'tipo': 'libro',
                'datos_especificos': {
                    'autor': 'Gabriel García Márquez',
                    'edicion': 'Conmemorativa 50 aniversario',
                    'anio': 2017,
                    'isbn_issn': '978-987-1234-56-7',
                    'editorial': 'Sudamericana',
                    'idioma': 'Español',
                }
            },
            # Tecnología
            {
                'nombre': 'MacBook Pro 14" M3',
                'descripcion': 'Laptop Apple MacBook Pro 14 pulgadas con chip M3 Pro, 18GB RAM, 512GB SSD.',
                'estok': estok_demo,
                'ubicacion': 'Dormitorio Principal',
                'contenedor': 'Cajonera',
                'estado_conservacion': 'excelente',
                'valor_estimado': 2200.00,
                'color': 'Gris espacial',
                'estado_carga': 'completo',
                'tipo': 'tecnologia',
                'datos_especificos': {
                    'marca': 'Apple',
                    'modelo': 'MacBook Pro 14" M3 Pro',
                    'numero_serie': 'FVFJ3K8Q9L',
                    'peso': 1.6,
                    'especificaciones': {'RAM': '18GB', 'SSD': '512GB', 'Pantalla': '14" Liquid Retina XDR'},
                }
            },
            # Mueble
            {
                'nombre': 'Mesa Ratona',
                'descripcion': 'Mesa ratona de madera de roble macizo, estilo rústico.',
                'estok': estok_demo,
                'ubicacion': 'Living',
                'contenedor': None,
                'estado_conservacion': 'bueno',
                'valor_estimado': 350.00,
                'color': 'Marrón',
                'estado_carga': 'completo',
                'tipo': 'mueble',
                'datos_especificos': {
                    'material': 'Madera',
                    'largo': 120,
                    'ancho': 60,
                    'alto': 45,
                    'artista_fabricante': 'Muebles del Sur',
                }
            },
            # Ropa
            {
                'nombre': 'Campera de Cuero',
                'descripcion': 'Campera de cuero genuino negra, marca Harley Davidson.',
                'estok': estok_demo,
                'ubicacion': 'Dormitorio Principal',
                'contenedor': None,
                'estado_conservacion': 'bueno',
                'valor_estimado': 580.00,
                'color': 'Negro',
                'estado_carga': 'completo',
                'tipo': 'ropa',
                'datos_especificos': {
                    'marca': 'Harley Davidson',
                    'material': 'Cuero',
                    'tamano': 'M',
                }
            },
            # Objeto incompleto (para probar estado_carga)
            {
                'nombre': 'Reloj de Bolsillo',
                'descripcion': 'Reloj de bolsillo antiguo. Pendiente de análisis completo.',
                'estok': estok_demo,
                'ubicacion': 'Depósito',
                'contenedor': 'Baúl',
                'estado_conservacion': 'regular',
                'valor_estimado': None,
                'color': '',
                'estado_carga': 'incompleto',
                'tipo': 'objeto',
            },
        ]

        objetos_creados = 0
        for od in objetos_data:
            tipo = od.pop('tipo')
            datos_esp = od.pop('datos_especificos', None)

            # Manejar ubicación y contenedor por nombre
            ubi_nombre = od.pop('ubicacion', None)
            cont_nombre = od.pop('contenedor', None)
            if ubi_nombre and ubi_nombre in ubicaciones:
                od['ubicacion'] = ubicaciones[ubi_nombre]
            if cont_nombre and cont_nombre in contenedores:
                od['contenedor'] = contenedores[cont_nombre]

            # Verificar si ya existe (por nombre en el mismo estok)
            existing = Objeto.objects.filter(nombre=od['nombre'], estok=od['estok']).first()
            if existing:
                self.stdout.write(f'  - Objeto ya existente: {od["nombre"]}')
                continue

            # Crear objeto base
            objeto = Objeto.objects.create(**od)

            # Crear datos específicos según tipo
            if tipo == 'libro':
                LibroRevista.objects.create(
                    objeto_ptr=objeto,
                    **{k: v for k, v in (datos_esp or {}).items() if k in ['autor', 'edicion', 'anio', 'isbn_issn', 'nombre_serie', 'titulo_tomo', 'numero_tomo', 'editorial', 'idioma']}
                )
            elif tipo == 'tecnologia':
                Tecnologia.objects.create(
                    objeto_ptr=objeto,
                    **{k: v for k, v in (datos_esp or {}).items() if k in ['marca', 'modelo', 'numero_serie', 'peso', 'especificaciones']}
                )
            elif tipo == 'mueble':
                MuebleArte.objects.create(
                    objeto_ptr=objeto,
                    **{k: v for k, v in (datos_esp or {}).items() if k in ['material', 'largo', 'ancho', 'alto', 'artista_fabricante']}
                )
            elif tipo == 'ropa':
                Ropa.objects.create(
                    objeto_ptr=objeto,
                    **{k: v for k, v in (datos_esp or {}).items() if k in ['marca', 'material', 'tamano']}
                )

            objetos_creados += 1
            self.stdout.write(self.style.SUCCESS(f'  ✓ Objeto creado: {objeto.nombre} ({tipo})'))

        # =========================================================================
        # Resumen final
        # =========================================================================
        self.stdout.write(self.style.SUCCESS('\n' + '=' * 60))
        self.stdout.write(self.style.SUCCESS('✅ Carga de datos de demostración completada.'))
        self.stdout.write(self.style.SUCCESS('=' * 60))
        self.stdout.write(f'  Roles: {len(created_roles) if created_roles else 0} creados')
        self.stdout.write(f'  Usuario admin: admin / admin123')
        self.stdout.write(f'  Estok: {estok_demo.nombre}')
        self.stdout.write(f'  Ubicaciones: {len(ubicaciones)}')
        self.stdout.write(f'  Contenedores: {len(contenedores)}')
        self.stdout.write(f'  Objetos: {objetos_creados}')
        self.stdout.write('')
        self.stdout.write(self.style.WARNING('⚠️  Recordá hacer redeploy en Coolify después de ejecutar este script.'))
