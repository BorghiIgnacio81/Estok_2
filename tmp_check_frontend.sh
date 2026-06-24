#!/bin/bash
CID="06659e7e46ee"

echo "=== 1. entry.mjs exists? ==="
docker exec $CID sh -c "ls -la /app/frontend/dist/server/entry.mjs 2>/dev/null || echo 'NOT FOUND'"

echo ""
echo "=== 2. dist/server/chunks/services/ ==="
docker exec $CID sh -c "ls /app/frontend/dist/server/chunks/services/ 2>/dev/null || echo 'NO SERVICES DIR'"

echo ""
echo "=== 3. Files containing X-Estok-Id ==="
docker exec $CID sh -c "grep -rl 'X-Estok-Id' /app/frontend/dist/server/chunks/ 2>/dev/null | head -10 || echo 'NONE FOUND'"

echo ""
echo "=== 4. Files containing cambiarEstokActivo ==="
docker exec $CID sh -c "grep -rl 'cambiarEstokActivo' /app/frontend/dist/server/chunks/ 2>/dev/null | head -10 || echo 'NONE FOUND'"

echo ""
echo "=== 5. Files containing getEstokActivoId ==="
docker exec $CID sh -c "grep -rl 'getEstokActivoId' /app/frontend/dist/server/chunks/ 2>/dev/null | head -10 || echo 'NONE FOUND'"

echo ""
echo "=== 6. dist/assets/ JS files (first 20) ==="
docker exec $CID sh -c "ls /app/frontend/dist/assets/ 2>/dev/null | head -20 || echo 'NO ASSETS DIR'"

echo ""
echo "=== 7. Check assets for X-Estok-Id ==="
docker exec $CID sh -c "grep -rl 'X-Estok-Id' /app/frontend/dist/assets/ 2>/dev/null | head -10 || echo 'NONE FOUND IN ASSETS'"
