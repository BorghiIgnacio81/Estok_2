"""
Management command para reparar objetos existentes que no tienen
su modelo hijo (LibroRevista, Tecnologia, etc.) creado correctamente.

Esto puede pasar si se crearon con versiones anteriores del serializer
que no creaban correctamente la herencia multi-tabla.

Uso: python manage.py reparar_objetos
"""

from django.core.management.base import BaseCommand
from inventario.models import Objeto, LibroRevista, Tecnologia, MuebleArte, Ropa
import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Repara objetos que no tienen su modelo hijo creado'

    def handle(self, *args, **options):
        objetos = Objeto.objects.filter(deleted_at__isnull=True)
        reparados = 0
        sin_tipo = 0

        for obj in objetos:
            tiene_hijo = (
                hasattr(obj, 'librorevista') and obj.librorevista is not None
            ) or (
                hasattr(obj, 'tecnologia') and obj.tecnologia is not None
            ) or (
                hasattr(obj, 'mueblearte') and obj.mueblearte is not None
            ) or (
                hasattr(obj, 'ropa') and obj.ropa is not None
            )

            if not tiene_hijo:
                # Intentar determinar el tipo por el nombre o dejarlo como 'objeto'
                nombre_lower = obj.nombre.lower()
                
                # Palabras clave para detectar tipo
                palabras_libro = ['libro', 'revista', 'comic', 'cómic', 'novela', 'cuento', 'poesia', 'poesía', 'manual', 'guía', 'guia', 'diccionario', 'enciclopedia', 'tomo', 'volumen']
                palabras_tecno = ['computadora', 'computador', 'laptop', 'notebook', 'celular', 'telefono', 'teléfono', 'tablet', 'monitor', 'teclado', 'mouse', 'impresora', 'cargador', 'auricular', 'parlante', 'router', 'modem', 'módem', 'disco', 'memoria', 'cable']
                palabras_mueble = ['mueble', 'silla', 'mesa', 'escritorio', 'estante', 'biblioteca', 'cajonera', 'armario', 'cuadro', 'pintura', 'escultura', 'lámpara', 'lampara']
                palabras_ropa = ['ropa', 'camisa', 'pantalon', 'pantalón', 'zapato', 'zapatilla', 'vestido', 'chaqueta', 'abrigo', 'bufanda', 'gorro', 'cinturon', 'cinturón']

                tipo_detectado = 'objeto'
                for p in palabras_libro:
                    if p in nombre_lower:
                        tipo_detectado = 'libro'
                        break
                if tipo_detectado == 'objeto':
                    for p in palabras_tecno:
                        if p in nombre_lower:
                            tipo_detectado = 'tecnologia'
                            break
                if tipo_detectado == 'objeto':
                    for p in palabras_mueble:
                        if p in nombre_lower:
                            tipo_detectado = 'mueble'
                            break
                if tipo_detectado == 'objeto':
                    for p in palabras_ropa:
                        if p in nombre_lower:
                            tipo_detectado = 'ropa'
                            break

                try:
                    if tipo_detectado == 'libro':
                        LibroRevista.objects.create(objeto_ptr=obj)
                        self.stdout.write(f"  ✅ {obj.nombre} -> reparado como libro")
                    elif tipo_detectado == 'tecnologia':
                        Tecnologia.objects.create(objeto_ptr=obj)
                        self.stdout.write(f"  ✅ {obj.nombre} -> reparado como tecnologia")
                    elif tipo_detectado == 'mueble':
                        MuebleArte.objects.create(objeto_ptr=obj)
                        self.stdout.write(f"  ✅ {obj.nombre} -> reparado como mueble")
                    elif tipo_detectado == 'ropa':
                        Ropa.objects.create(objeto_ptr=obj)
                        self.stdout.write(f"  ✅ {obj.nombre} -> reparado como ropa")
                    else:
                        # Si no se puede detectar, dejar como objeto genérico
                        self.stdout.write(f"  ⚠️  {obj.nombre} -> sin tipo detectable, queda como 'objeto'")
                        sin_tipo += 1
                    
                    reparados += 1
                except Exception as e:
                    self.stdout.write(self.style.ERROR(f"  ❌ Error al reparar {obj.nombre}: {e}"))
            else:
                # Ya tiene hijo, verificar qué tipo
                if hasattr(obj, 'librorevista') and obj.librorevista is not None:
                    tipo = 'libro'
                elif hasattr(obj, 'tecnologia') and obj.tecnologia is not None:
                    tipo = 'tecnologia'
                elif hasattr(obj, 'mueblearte') and obj.mueblearte is not None:
                    tipo = 'mueble'
                elif hasattr(obj, 'ropa') and obj.ropa is not None:
                    tipo = 'ropa'
                else:
                    tipo = 'objeto'
                self.stdout.write(f"  ✓ {obj.nombre} -> {tipo} (ok)")

        self.stdout.write(self.style.SUCCESS(
            f"\n✅ Reparación completada: {reparados} objetos reparados, {sin_tipo} sin tipo detectable"
        ))
