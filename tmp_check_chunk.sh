#!/bin/bash
CID="06659e7e46ee"

echo "=== Searching for 'estok' in server chunks ==="
docker exec $CID sh -c "grep -c 'estok' /app/frontend/dist/server/chunks/server_D83x6_Jp.mjs 2>/dev/null || echo '0'"

echo ""
echo "=== Searching for 'X-Estok' in server chunks ==="
docker exec $CID sh -c "grep -c 'X-Estok' /app/frontend/dist/server/chunks/server_D83x6_Jp.mjs 2>/dev/null || echo '0'"

echo ""
echo "=== Searching for 'getEstokActivoId' in server chunks ==="
docker exec $CID sh -c "grep -c 'getEstokActivoId' /app/frontend/dist/server/chunks/server_D83x6_Jp.mjs 2>/dev/null || echo '0'"

echo ""
echo "=== Searching for 'cambiarEstok' in server chunks ==="
docker exec $CID sh -c "grep -c 'cambiarEstok' /app/frontend/dist/server/chunks/server_D83x6_Jp.mjs 2>/dev/null || echo '0'"

echo ""
echo "=== Searching for 'ultimo_estok' in server chunks ==="
docker exec $CID sh -c "grep -c 'ultimo_estok' /app/frontend/dist/server/chunks/server_D83x6_Jp.mjs 2>/dev/null || echo '0'"

echo ""
echo "=== Searching for 'estok_activo' in server chunks ==="
docker exec $CID sh -c "grep -c 'estok_activo' /app/frontend/dist/server/chunks/server_D83x6_Jp.mjs 2>/dev/null || echo '0'"

echo ""
echo "=== Searching for 'estoks' in server chunks ==="
docker exec $CID sh -c "grep -c 'estoks' /app/frontend/dist/server/chunks/server_D83x6_Jp.mjs 2>/dev/null || echo '0'"

echo ""
echo "=== Checking client dir ==="
docker exec $CID sh -c "ls -la /app/frontend/dist/client/ 2>/dev/null && echo '---' && ls /app/frontend/dist/client/assets/ 2>/dev/null | head -20 || echo 'NO CLIENT ASSETS'"

echo ""
echo "=== Searching for X-Estok in client ==="
docker exec $CID sh -c "grep -rl 'X-Estok' /app/frontend/dist/client/ 2>/dev/null | head -10 || echo 'NONE IN CLIENT'"
