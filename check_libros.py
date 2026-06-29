"""Script para verificar objetos tipo libro en BD"""
import django, os
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings'
import django; django.setup()
from inventario.models import Objeto, LibroRevista

# Ver los últimos 10 objetos
objetos = Objeto.objects.filter(deleted_at__isnull=True).order_by('-fecha_registro')[:10]
print(f"Total objetos activos: {Objeto.objects.filter(deleted_at__isnull=True).count()}")
print(f"Total libros (con LibroRevista): {Objeto.objects.filter(librorevista__isnull=False, deleted_at__isnull=True).count()}")
print()

for o in objetos:
    tiene_libro = hasattr(o, 'librorevista') and o.librorevista is not None
    print(f"ID={o.id} | nombre='{o.nombre}' | tipo_field='{o.tipo}' | tiene_librorevista={tiene_libro}")
    if tiene_libro:
        lr = o.librorevista
        print(f"  -> LibroRevista: autor='{lr.autor}' isbn='{lr.isbn_issn}' editorial='{lr.editorial}'")
    print()
