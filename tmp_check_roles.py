from inventario.models import CustomUser, Membresia

u = CustomUser.objects.get(username='ygumy44')
print('=== MEMBRESIAS DE ygumy44 ===')
mems = Membresia.objects.filter(usuario=u).select_related('estok', 'role')
for m in mems:
    print(f'  Estok: {m.estok.nombre} (id={m.estok.id})')
    print(f'  Role: {m.role.name if m.role else "SIN ROL"} (id={m.role_id})')
    if m.role:
        print(f'    can_read: {m.role.can_read}')
        print(f'    can_write: {m.role.can_write}')
        print(f'    can_edit: {m.role.can_edit}')
        print(f'    can_delete: {m.role.can_delete}')
    print()

# Tambien verificar el usuario Soledad Martinez
try:
    u2 = CustomUser.objects.get(username='soledadmartinez')
    print('=== MEMBRESIAS DE soledadmartinez ===')
    mems2 = Membresia.objects.filter(usuario=u2).select_related('estok', 'role')
    for m in mems2:
        print(f'  Estok: {m.estok.nombre} (id={m.estok.id})')
        print(f'  Role: {m.role.name if m.role else "SIN ROL"} (id={m.role_id})')
        if m.role:
            print(f'    can_read: {m.role.can_read}')
        print()
except CustomUser.DoesNotExist:
    print('soledadmartinez no existe')

# Verificar Santiago Borghi
try:
    u3 = CustomUser.objects.get(username='santiagoborghi')
    print('=== MEMBRESIAS DE santiagoborghi ===')
    mems3 = Membresia.objects.filter(usuario=u3).select_related('estok', 'role')
    for m in mems3:
        print(f'  Estok: {m.estok.nombre} (id={m.estok.id})')
        print(f'  Role: {m.role.name if m.role else "SIN ROL"} (id={m.role_id})')
        if m.role:
            print(f'    can_read: {m.role.can_read}')
        print()
except CustomUser.DoesNotExist:
    print('santiagoborghi no existe')

# Verificar Agustina Borghi
try:
    u4 = CustomUser.objects.get(username='agustinaborghi')
    print('=== MEMBRESIAS DE agustinaborghi ===')
    mems4 = Membresia.objects.filter(usuario=u4).select_related('estok', 'role')
    for m in mems4:
        print(f'  Estok: {m.estok.nombre} (id={m.estok.id})')
        print(f'  Role: {m.role.name if m.role else "SIN ROL"} (id={m.role_id})')
        if m.role:
            print(f'    can_read: {m.role.can_read}')
        print()
except CustomUser.DoesNotExist:
    print('agustinaborghi no existe')
