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
            tiene_hijo = False
            tipo_actual = None

            try:
                # Verificar si ya tiene hijo usando getattr con default
                if hasattr(obj, 'librorevista') and obj.librorevista is not None:
                    tiene_hijo = True
                    tipo_actual = 'libro'
                elif hasattr(obj, 'tecnologia') and obj.tecnologia is not None:
                    tiene_hijo = True
                    tipo_actual = 'tecnologia'
                elif hasattr(obj, 'mueblearte') and obj.mueblearte is not None:
                    tiene_hijo = True
                    tipo_actual = 'mueble'
                elif hasattr(obj, 'ropa') and obj.ropa is not None:
                    tiene_hijo = True
                    tipo_actual = 'ropa'
            except Exception:
                # Si hay error al acceder al hijo, es porque no existe
                tiene_hijo = False

            if not tiene_hijo:
                # Intentar determinar el tipo por el nombre
                nombre_lower = obj.nombre.lower()
                
                # Palabras clave para detectar tipo
                palabras_libro = ['libro', 'revista', 'comic', 'cómic', 'novela', 'cuento', 'poesia', 'poesía', 'manual', 'guía', 'guia', 'diccionario', 'enciclopedia', 'tomo', 'volumen', 'anne']
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
                        # Usar el OneToOneField directamente para no crear duplicados
                        lr = LibroRevista(objeto_ptr=obj)
                        lr.save()
                        self.stdout.write(f"  ✅ {obj.nombre} -> reparado como libro")
                    elif tipo_detectado == 'tecnologia':
                        t = Tecnologia(objeto_ptr=obj)
                        t.save()
                        self.stdout.write(f"  ✅ {obj.nombre} -> reparado como tecnologia")
                    elif tipo_detectado == 'mueble':
                        ma = MuebleArte(objeto_ptr=obj)
                        ma.save()
                        self.stdout.write(f"  ✅ {obj.nombre} -> reparado como mueble")
                    elif tipo_detectado == 'ropa':
                        r = Ropa(objeto_ptr=obj)
                        r.save()
                        self.stdout.write(f"  ✅ {obj.nombre} -> reparado como ropa")
                    else:
                        self.stdout.write(f"  ⚠️  {obj.nombre} -> sin tipo detectable, queda como 'objeto'")
                        sin_tipo += 1
                    
                    reparados += 1
                except Exception as e:
                    self.stdout.write(self.style.ERROR(f"  ❌ Error al reparar {obj.nombre}: {e}"))
            else:
                self.stdout.write(f"  ✓ {obj.nombre} -> {tipo_actual} (ok)")

        self.stdout.write(self.style.SUCCESS(
            f"\n✅ Reparación completada: {reparados} objetos reparados, {sin_tipo} sin tipo detectable"
        ))
