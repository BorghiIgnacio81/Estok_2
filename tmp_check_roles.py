from inventario.models import Role
roles = Role.objects.all()
print(f'Total roles: {roles.count()}')
for r in roles:
    print(f'  ID: {r.id} | Name: {r.name} | can_read: {r.can_read} | can_write: {r.can_write} | can_edit: {r.can_edit} | can_delete: {r.can_delete}')
