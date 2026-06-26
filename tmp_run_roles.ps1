$keyPath = "C:\Users\USER\Desktop\Estok_2\Hetzner\llavehezner"
$remoteCmd = 'docker exec sq641axhkdx4oz4oss522ht9-141222431794 python manage.py shell -c "from inventario.models import Role; roles = Role.objects.all(); print(''Total roles:'', roles.count()); [print(''  ID:'', r.id, ''| Name:'', r.name, ''| can_read:'', r.can_read, ''| can_write:'', r.can_write, ''| can_edit:'', r.can_edit, ''| can_delete:'', r.can_delete) for r in roles]"'
ssh -i $keyPath -o StrictHostKeyChecking=no root@178.156.224.212 $remoteCmd
