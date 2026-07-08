#!/bin/bash
set -e

echo "=== Starting Estok ==="

# Generar archivo de versión para detectar nuevos deploys
echo "Generating version.json..."
# Coolify provee SOURCE_COMMIT como variable de entorno.
# Si no está, intentar con git rev-parse, y si tampoco funciona, "unknown".
COMMIT_HASH="${SOURCE_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")}"
DEPLOY_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > /app/version.json << EOF
{
  "commit": "${COMMIT_HASH}",
  "deploy_timestamp": "${DEPLOY_TIMESTAMP}",
  "version": "1.0.0"
}
EOF

# Generar archivo JS con el commit hash para que Astro lo incluya en el HTML
# Esto permite que el frontend compare el commit con el que fue construido
# contra el que devuelve el backend, detectando así nuevos deploys.
cat > /app/frontend/public/build-info.js << EOF
// GENERATED AUTOMATICALLY - DO NOT EDIT
// Este archivo contiene el commit hash con el que fue construida esta versión.
window.__ESTOK_BUILD_COMMIT__ = "${COMMIT_HASH}";
window.__ESTOK_BUILD_TIMESTAMP__ = "${DEPLOY_TIMESTAMP}";
EOF

echo "Version: ${COMMIT_HASH} @ ${DEPLOY_TIMESTAMP}"

# Puerto principal (debe coincidir con EXPOSE en Dockerfile y listen en nginx)
ESTOK_PORT="${ESTOK_PORT:-8000}"
echo "Using ESTOK_PORT=${ESTOK_PORT}"

echo "Running migrations..."
python manage.py migrate --noinput

echo "Seeding data..."
python manage.py seed_data || echo "Seed data skipped (not critical)"

echo "Starting Gunicorn on port 8001..."
gunicorn config.wsgi:application --bind 0.0.0.0:8001 --workers 4 --timeout 200 &
GUNICORN_PID=$!
echo "Gunicorn started (PID: $GUNICORN_PID)"

# ESPERAR a que Gunicorn esté listo antes de continuar
# (evita el 503 si Coolify/Traefik empieza a rutear antes de tiempo)
echo "Waiting for Gunicorn to be ready..."
for i in $(seq 1 30); do
    if curl -s http://127.0.0.1:8001/api/ > /dev/null 2>&1; then
        echo "Gunicorn is ready! (attempt $i)"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "WARNING: Gunicorn did not respond after 30 attempts, continuing anyway..."
    else
        sleep 1
    fi
done

# Verificar si existe el servidor Astro
if [ -f /app/frontend/dist/server/entry.mjs ]; then
    echo "Starting Astro Node server on port 4321..."
    cd /app/frontend
    PORT=4321 HOST=0.0.0.0 node ./dist/server/entry.mjs &
    ASTRO_PID=$!
    echo "Astro server started (PID: $ASTRO_PID)"
    
    # ESPERAR a que Astro esté listo
    echo "Waiting for Astro to be ready..."
    for i in $(seq 1 15); do
        if curl -s http://127.0.0.1:4321/ > /dev/null 2>&1; then
            echo "Astro is ready! (attempt $i)"
            break
        fi
        if [ "$i" -eq 15 ]; then
            echo "WARNING: Astro did not respond after 15 attempts, continuing anyway..."
        else
            sleep 1
        fi
    done
    
    cd /app
else
    echo "WARNING: Astro server entry not found at /app/frontend/dist/server/entry.mjs"
    echo "Contents of /app/frontend/dist:"
    ls -la /app/frontend/dist/ 2>/dev/null || echo "  (dist directory not found)"
    echo "Will serve static files via Nginx only."
fi

# Reemplazar el puerto en nginx.conf si ESTOK_PORT cambió
if [ "${ESTOK_PORT}" != "8000" ]; then
    echo "Updating nginx listen port to ${ESTOK_PORT}..."
    sed -i "s/listen 8000;/listen ${ESTOK_PORT};/g" /etc/nginx/sites-enabled/default
fi

echo "Starting Nginx on port ${ESTOK_PORT}..."
nginx -g "daemon off;"
