import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django; django.setup()
from inventario.models import CustomUser, Estok, Membresia
print('=== USUARIOS ===')
for u in CustomUser.objects.all():
    print(f'  {u.id} | {u.username} | {u.first_name} {u.last_name} | active={u.is_active} | staff={u.is_staff}')
print()
print('=== ESTOKS ===')
for e in Estok.objects.all():
    print(f'  {e.id} | {e.nombre}')
print()
print('=== MEMBRESIAS ===')
for m in Membresia.objects.select_related('usuario','estok','role').all():
    print(f'  {m.usuario.username} -> {m.estok.nombre} (role={m.role.name if m.role else None})')
