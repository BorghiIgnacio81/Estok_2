import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from inventario.models import Objeto
o = Objeto.objects.filter(dueno_original__username='ygumy44').first()
if o:
    print(f'ID: {o.id}, Nombre: {o.nombre}, Dueno: {str(o.dueno_original)}')
else:
    print('No se encontraron objetos con dueno_original=ygumy44')
