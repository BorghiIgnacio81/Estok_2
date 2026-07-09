#!/bin/bash
docker run --rm --network coolify \
  -e PGPASSWORD=93nKM4A450bcb4VgM3hXlOVoDBM94JZsyH16TBHH7FpDoZbgwSxtSflzQvsU8lQI \
  postgres:16-alpine \
  psql -h cagtcifjoy8ydxugg4bkdll1 -U estok_user -d estok \
  -c "INSERT INTO django_migrations (app, name, applied) VALUES ('inventario', '0011_add_alias_por_estok', NOW()) ON CONFLICT DO NOTHING;"
