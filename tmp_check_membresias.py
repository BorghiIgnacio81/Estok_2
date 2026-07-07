import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from inventario.models import CustomUser, Membresia

u = CustomUser.objects.get(username='ygumy44')
print(f'Usuario: {u.username} | ultimo_estok_activo_id: {u.ultimo_estok_activo_id}')

mems = Membresia.objects.filter(usuario=u).select_related('estok', 'role')
for m in mems:
    role_name = m.role.name if m.role else 'SIN ROL'
    print(f'  Estok: {m.estok.nombre} (id={m.estok.id}) | Role: {role_name} | role_id: {m.role_id}')
