#!/bin/bash
CID="06659e7e46ee"

echo "=== entry.mjs content ==="
docker exec $CID sh -c "cat /app/frontend/dist/server/entry.mjs"

echo ""
echo "=== dist/ listing ==="
docker exec $CID sh -c "ls -la /app/frontend/dist/"

echo ""
echo "=== dist/assets/ ==="
docker exec $CID sh -c "ls -la /app/frontend/dist/assets/ 2>/dev/null || echo 'NO ASSETS DIR'"

echo ""
echo "=== dist/server/ ==="
docker exec $CID sh -c "ls -la /app/frontend/dist/server/ 2>/dev/null"

echo ""
echo "=== dist/server/chunks/ ==="
docker exec $CID sh -c "ls -la /app/frontend/dist/server/chunks/ 2>/dev/null || echo 'NO CHUNKS DIR'"

echo ""
echo "=== Check for X-Estok-Id anywhere in dist ==="
docker exec $CID sh -c "grep -rl 'X-Estok-Id' /app/frontend/dist/ 2>/dev/null | head -10 || echo 'NONE FOUND'"

echo ""
echo "=== Check for getEstokActivoId anywhere in dist ==="
docker exec $CID sh -c "grep -rl 'getEstokActivoId' /app/frontend/dist/ 2>/dev/null | head -10 || echo 'NONE FOUND'"
