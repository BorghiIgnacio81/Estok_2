#!/bin/bash
CID="06659e7e46ee"

echo "=== api.ts source in container ==="
docker exec $CID sh -c "head -80 /app/frontend/src/services/api.ts 2>/dev/null || echo 'FILE NOT FOUND'"

echo ""
echo "=== auth.ts source in container ==="
docker exec $CID sh -c "head -80 /app/frontend/src/services/auth.ts 2>/dev/null || echo 'FILE NOT FOUND'"

echo ""
echo "=== types/index.ts source in container ==="
docker exec $CID sh -c "head -40 /app/frontend/src/types/index.ts 2>/dev/null || echo 'FILE NOT FOUND'"

echo ""
echo "=== usuarios.py source in container ==="
docker exec $CID sh -c "grep -n 'cambiar_estok_activo\|get_permissions\|HasRolePermission' /app/inventario/api/viewsets/usuarios.py 2>/dev/null | head -20 || echo 'FILE NOT FOUND'"

echo ""
echo "=== base.py source in container ==="
docker exec $CID sh -c "grep -n 'action_map\|can_read\|HasRolePermission' /app/inventario/api/viewsets/base.py 2>/dev/null | head -20 || echo 'FILE NOT FOUND'"
