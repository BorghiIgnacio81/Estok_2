"""
Script de migración de datos para producción:
1. Crear Estok "El Camarin" para SoledadMartinez
2. Agregar a ygumy44 como miembro de "El Camarin"
3. Eliminar usuarios de prueba: diag_activo, test_diag
4. Opcional: remover admin de "Casa Borghi Federacion"
"""
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django; django.setup()
from inventario.models import CustomUser, Estok, Membresia, Role

admin_role = Role.objects.get(name='Admin')
editor_role = Role.objects.get(name='Editor')

# 1. Crear Estok "El Camarin"
el_camarin, created = Estok.objects.get_or_create(
    nombre='El Camarin',
    defaults={'descripcion': 'Inventario de Soledad Martinez'}
)
if created:
    print(f'✓ Estok "El Camarin" creado (id={el_camarin.id})')
else:
    print(f'- Estok "El Camarin" ya existe (id={el_camarin.id})')

# 2. Agregar a SoledadMartinez como Admin de "El Camarin"
try:
    soledad = CustomUser.objects.get(username='SoledadMartinez')
    m, created = Membresia.objects.get_or_create(
        usuario=soledad,
        estok=el_camarin,
        defaults={'role': admin_role}
    )
    if created:
        print(f'✓ SoledadMartinez agregada como Admin de "El Camarin"')
    else:
        print(f'- SoledadMartinez ya era miembro de "El Camarin"')
except CustomUser.DoesNotExist:
    print('✗ SoledadMartinez no encontrado')

# 3. Agregar a ygumy44 como miembro de "El Camarin"
try:
    ygumy = CustomUser.objects.get(username='ygumy44')
    m, created = Membresia.objects.get_or_create(
        usuario=ygumy,
        estok=el_camarin,
        defaults={'role': admin_role}
    )
    if created:
        print(f'✓ ygumy44 agregado como Admin de "El Camarin"')
    else:
        print(f'- ygumy44 ya era miembro de "El Camarin"')
except CustomUser.DoesNotExist:
    print('✗ ygumy44 no encontrado')

# 4. Eliminar usuarios de prueba
for username in ['diag_activo', 'test_diag']:
    try:
        user = CustomUser.objects.get(username=username)
        # Eliminar membresías primero
        Membresia.objects.filter(usuario=user).delete()
        user.delete()
        print(f'✓ Usuario "{username}" eliminado')
    except CustomUser.DoesNotExist:
        print(f'- Usuario "{username}" no existe')

# 5. Remover admin de "Casa Borghi Federacion" (opcional, pero el admin del sistema
#    no debería estar como miembro de un Estok privado)
try:
    admin_user = CustomUser.objects.get(username='admin')
    casa_borghi = Estok.objects.get(nombre='Casa Borghi Federacion')
    m = Membresia.objects.filter(usuario=admin_user, estok=casa_borghi).first()
    if m:
        m.delete()
        print(f'✓ admin removido de "Casa Borghi Federacion"')
    else:
        print(f'- admin no era miembro de "Casa Borghi Federacion"')
except Exception as e:
    print(f'  (opcional) {e}')

print()
print('=== ESTADO FINAL ===')
print('--- USUARIOS ---')
for u in CustomUser.objects.all():
    print(f'  {u.username} | {u.first_name} {u.last_name} | active={u.is_active} | staff={u.is_staff}')
print('--- ESTOKS ---')
for e in Estok.objects.all():
    print(f'  {e.nombre}')
print('--- MEMBRESIAS ---')
for m in Membresia.objects.select_related('usuario','estok','role').all():
    print(f'  {m.usuario.username} -> {m.estok.nombre} (role={m.role.name if m.role else None})')
