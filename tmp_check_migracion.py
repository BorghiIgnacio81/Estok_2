import os
migrations_dir = '/app/inventario/migrations/'
files = os.listdir(migrations_dir)
print("Archivos de migracion:")
for f in sorted(files):
    if f.endswith('.py') and not f.startswith('__'):
        print(f"  {f}")

print("\n---")
try:
    from inventario.models import Mensaje
    print("MODELO Mensaje: OK")
except ImportError as e:
    print(f"MODELO Mensaje: NO EXISTE - {e}")

print("---")
try:
    import inventario.api.viewsets.chat
    print("VIEWSET chat: OK")
except ImportError as e:
    print(f"VIEWSET chat: NO EXISTE - {e}")
