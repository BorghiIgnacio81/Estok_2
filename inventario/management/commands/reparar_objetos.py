"""
Management command para reparar objetos existentes que no tienen
su modelo hijo (LibroRevista, Tecnologia, etc.) creado correctamente.

Esto puede pasar si se crearon con versiones anteriores del serializer
que no creaban correctamente la herencia multi-tabla.

Uso: python manage.py reparar_objetos
"""

from django.core.management.base import BaseCommand
from django.db import connection
from inventario.models import Objeto, LibroRevista, Tecnologia, MuebleArte, Ropa
import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Repara objetos que no tienen su modelo hijo creado'

    def handle(self, *args, **options):
        objetos = Objeto.objects.filter(deleted_at__isnull=True)
        reparados = 0
        sin_tipo = 0

        # Primero, limpiar registros huérfanos de ejecuciones anteriores
        # (cuando se usó create() en vez de save() directo)
        self._limpiar_huérfanos()

        for obj in objetos:
            tiene_hijo = False
            tipo_actual = None

            try:
                # Verificar si ya tiene hijo
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
                tiene_hijo = False

            if not tiene_hijo:
                nombre_lower = obj.nombre.lower()
                
                palabras_libro = ['libro', 'revista', 'comic', 'cómic', 'novela', 'cuento', 'poesia', 'poesía', 'manual', 'guía', 'guia', 'diccionario', 'enciclopedia', 'tomo', 'volumen', 'anne', 'garfield']
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
                        # INSERT directo en la tabla hijo para evitar
                        # que Django cree un nuevo Objeto (multi-table inheritance)
                        # Los campos CharField con blank=True pero sin null=True
                        # necesitan string vacío '' como valor por defecto
                        with connection.cursor() as cursor:
                            cursor.execute("""
                                INSERT INTO inventario_librorevista 
                                    (objeto_ptr_id, autor, edicion, isbn_issn, nombre_serie, 
                                     titulo_tomo, editorial, idioma)
                                VALUES (%s, '', '', '', '', '', '', '')
                                ON CONFLICT (objeto_ptr_id) DO NOTHING
                            """, [str(obj.id)])
                        self.stdout.write(f"  ✅ {obj.nombre} -> reparado como libro")
                    elif tipo_detectado == 'tecnologia':
                        with connection.cursor() as cursor:
                            cursor.execute("""
                                INSERT INTO inventario_tecnologia 
                                    (objeto_ptr_id)
                                VALUES (%s)
                                ON CONFLICT (objeto_ptr_id) DO NOTHING
                            """, [str(obj.id)])
                        self.stdout.write(f"  ✅ {obj.nombre} -> reparado como tecnologia")
                    elif tipo_detectado == 'mueble':
                        with connection.cursor() as cursor:
                            cursor.execute("""
                                INSERT INTO inventario_mueblearte 
                                    (objeto_ptr_id)
                                VALUES (%s)
                                ON CONFLICT (objeto_ptr_id) DO NOTHING
                            """, [str(obj.id)])
                        self.stdout.write(f"  ✅ {obj.nombre} -> reparado como mueble")
                    elif tipo_detectado == 'ropa':
                        with connection.cursor() as cursor:
                            cursor.execute("""
                                INSERT INTO inventario_ropa 
                                    (objeto_ptr_id)
                                VALUES (%s)
                                ON CONFLICT (objeto_ptr_id) DO NOTHING
                            """, [str(obj.id)])
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

    def _limpiar_huérfanos(self):
        """
        Limpia registros huérfanos creados por ejecuciones anteriores del script.
        Cuando se usó LibroRevista.objects.create(objeto_ptr=obj), Django intentó
        crear un nuevo Objeto con el mismo UUID, lo que dejó la BD inconsistente.
        """
        self.stdout.write("🧹 Limpiando registros huérfanos de ejecuciones anteriores...")
        
        with connection.cursor() as cursor:
            # Buscar registros en inventario_librorevista cuyo objeto_ptr_id
            # NO exista realmente como objeto (porque el create() falló)
            cursor.execute("""
                DELETE FROM inventario_librorevista 
                WHERE objeto_ptr_id IN (
                    SELECT lr.objeto_ptr_id 
                    FROM inventario_librorevista lr
                    LEFT JOIN inventario_objeto o ON o.id = lr.objeto_ptr_id
                    WHERE o.id IS NULL
                )
            """)
            deleted = cursor.rowcount
            if deleted:
                self.stdout.write(f"  🗑️  Eliminados {deleted} registros huérfanos de librorevista")
            
            cursor.execute("""
                DELETE FROM inventario_tecnologia 
                WHERE objeto_ptr_id IN (
                    SELECT t.objeto_ptr_id 
                    FROM inventario_tecnologia t
                    LEFT JOIN inventario_objeto o ON o.id = t.objeto_ptr_id
                    WHERE o.id IS NULL
                )
            """)
            deleted = cursor.rowcount
            if deleted:
                self.stdout.write(f"  🗑️  Eliminados {deleted} registros huérfanos de tecnologia")
