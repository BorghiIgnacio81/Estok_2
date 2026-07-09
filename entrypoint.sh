#!/bin/bash
set -e

echo "=== Starting Estok ==="

# Puerto principal (debe coincidir con EXPOSE en Dockerfile y listen en nginx)
ESTOC_PORT="${ESTOK_PORT:-8000}"
echo "Using ESTOK_PORT=${ESTOK_PORT}"

# Generar version.json con timestamp y versión
echo "Generating version.json..."
COMMIT_HASH=$(git log -1 --format=%H 2>/dev/null || echo "unknown")
DEPLOY_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > /app/version.json <<EOF
{
  "commit": "${COMMIT_HASH}",
  "deploy_timestamp": "${DEPLOY_TIMESTAMP}",
  "version": "1.1.0"
}
EOF
echo "Version: 1.1.0, Commit: ${COMMIT_HASH}"

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
