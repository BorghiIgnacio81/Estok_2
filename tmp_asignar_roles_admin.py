"""
Script para asignar rol Admin a todos los miembros de cada Estok,
y asegurar que ygumy44 sea superuser con acceso a todo.

Uso: python manage.py shell < tmp_asignar_roles_admin.py
"""

import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from inventario.models import CustomUser, Membresia, Role, Estok

# =============================================================================
# 1. Asegurar que ygumy44 sea superuser
# =============================================================================
try:
    ygumy44 = CustomUser.objects.get(username='ygumy44')
    if not ygumy44.is_superuser:
        ygumy44.is_superuser = True
        ygumy44.is_staff = True
        ygumy44.save()
        print(f'✅ ygumy44 ahora es superuser')
    else:
        print(f'✅ ygumy44 ya era superuser')
except CustomUser.DoesNotExist:
    print('❌ ygumy44 no existe en la base de datos')

# =============================================================================
# 2. Obtener el rol Admin
# =============================================================================
try:
    role_admin = Role.objects.get(name='Admin')
    print(f'✅ Rol Admin encontrado (id={role_admin.id})')
except Role.DoesNotExist:
    print('❌ El rol Admin no existe. Ejecutá primero: python manage.py seed_data')
    exit()

# =============================================================================
# 3. Asignar rol Admin a todos los miembros de todos los Estoks
# =============================================================================
usuarios_procesados = set()

for estok in Estok.objects.all():
    print(f'\n📦 Estok: {estok.nombre} (id={estok.id})')
    membresias = Membresia.objects.filter(estok=estok).select_related('usuario', 'role')
    
    for m in membresias:
        role_anterior = m.role.name if m.role else 'SIN ROL'
        m.role = role_admin
        m.save()
        usuarios_procesados.add(m.usuario.username)
        print(f'  👤 {m.usuario.username}: {role_anterior} → Admin')

# =============================================================================
# 4. Verificar que todos los usuarios tengan membresía con Admin
# =============================================================================
print(f'\n{"="*50}')
print('RESUMEN FINAL:')
print(f'{"="*50}')

for user in CustomUser.objects.all():
    print(f'\n👤 {user.username} (superuser={user.is_superuser})')
    mems = Membresia.objects.filter(usuario=user).select_related('estok', 'role')
    for m in mems:
        print(f'  📦 {m.estok.nombre} → Rol: {m.role.name if m.role else "SIN ROL"}')

print(f'\n✅ Proceso completado.')
