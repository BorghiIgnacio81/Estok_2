#!/bin/bash
# Obtener token de Coolify
TOKEN=$(docker exec coolify cat /data/coolify/proxy/api-token 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "No se pudo obtener token de Coolify"
  exit 1
fi

# Hacer deploy
curl -s -X POST 'https://coolify.178.156.224.212.nip.io/api/v1/deploy?uuid=sq641axhkdx4oz4oss522ht9' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}'
