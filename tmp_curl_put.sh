#!/bin/sh
# Obtener un ID de objeto de tipo tecnologia
OBJ_ID=$(docker exec sq641axhkdx4oz4oss522ht9-205724817134 python -c "
import os,django; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); django.setup()
from inventario.models import Objeto
obj = Objeto.objects.filter(tecnologia__isnull=False).first()
if obj: print(obj.id)
" 2>/dev/null)

echo "OBJ_ID=$OBJ_ID"

if [ -n "$OBJ_ID" ]; then
  # Hacer PUT directo a Gunicorn
  curl -s -w "\nHTTP_CODE:%{http_code}\n" -X PUT \
    "http://localhost:8001/api/objetos/$OBJ_ID/" \
    -H "Content-Type: application/json" \
    -H "X-Estok-Id: 00000000-0000-0000-0000-000000000001" \
    -d "{\"nombre\":\"Test PUT desde curl\",\"tipo\":\"tecnologia\",\"marca\":\"MarcaTest\",\"modelo\":\"ModeloTest\"}"
fi
