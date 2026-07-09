"""
Script para configurar el alias "Yamza" para ygumy44 en el Estok de SoledadMartinez.
"""
import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

from inventario.models import CustomUser, Membresia

# Buscar al usuario ygumy44
try:
    ygumy44 = CustomUser.objects.get(username='ygumy44')
    print(f"✅ Usuario ygumy44 encontrado: {ygumy44.get_full_name()} (ID: {ygumy44.id})")
except CustomUser.DoesNotExist:
    print("❌ Usuario ygumy44 no encontrado")
    sys.exit(1)

# Buscar los Estoks donde SoledadMartinez es miembro
try:
    soledad = CustomUser.objects.get(username='SoledadMartinez')
    print(f"✅ Usuario SoledadMartinez encontrado: {soledad.get_full_name()} (ID: {soledad.id})")
except CustomUser.DoesNotExist:
    print("❌ Usuario SoledadMartinez no encontrado")
    sys.exit(1)

# Buscar Estoks donde SoledadMartinez es miembro
soledad_membresias = Membresia.objects.filter(usuario=soledad).select_related('estok')
print(f"\n📋 Estoks de SoledadMartinez:")
for m in soledad_membresias:
    print(f"  - {m.estok.nombre} (ID: {m.estok.id})")

# Buscar Estoks donde ygumy44 también es miembro (Estoks compartidos)
print(f"\n📋 Estoks compartidos entre ygumy44 y SoledadMartinez:")
compartidos = Membresia.objects.filter(
    usuario=ygumy44,
    estok__in=[m.estok for m in soledad_membresias]
).select_related('estok')

for m in compartidos:
    print(f"  - {m.estok.nombre} (ID: {m.estok.id})")

# Configurar alias "Yamza" para ygumy44 en esos Estoks
if compartidos:
    alias_dict = {}
    for m in compartidos:
        estok_id_str = str(m.estok.id)
        alias_dict[estok_id_str] = 'Yamza'
    
    ygumy44.alias_por_estok = alias_dict
    ygumy44.save(update_fields=['alias_por_estok'])
    print(f"\n✅ Alias configurado: ygumy44 ahora se mostrará como 'Yamza' en {len(compartidos)} Estok(s)")
    print(f"   Dict: {alias_dict}")
else:
    print("\n⚠️ No hay Estoks compartidos entre ygumy44 y SoledadMartinez")
    print("   No se configuró ningún alias.")
