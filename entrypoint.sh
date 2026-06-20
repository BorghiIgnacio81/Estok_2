#!/bin/bash
set -e

echo "=== Starting Estok ==="

echo "Running migrations..."
python manage.py migrate --noinput

echo "Seeding data..."
python manage.py seed_data || echo "Seed data skipped (not critical)"

echo "Starting Gunicorn on port 8001..."
gunicorn config.wsgi:application --bind 0.0.0.0:8001 --workers 4 --timeout 120 &
GUNICORN_PID=$!
echo "Gunicorn started (PID: $GUNICORN_PID)"

# Verificar si existe el servidor Astro
if [ -f /app/frontend/dist/server/entry.mjs ]; then
    echo "Starting Astro Node server on port 4321..."
    cd /app/frontend
    PORT=4321 HOST=0.0.0.0 node ./dist/server/entry.mjs &
    ASTRO_PID=$!
    echo "Astro server started (PID: $ASTRO_PID)"
    cd /app
else
    echo "WARNING: Astro server entry not found at /app/frontend/dist/server/entry.mjs"
    echo "Contents of /app/frontend/dist:"
    ls -la /app/frontend/dist/ 2>/dev/null || echo "  (dist directory not found)"
    echo "Will serve static files via Nginx only."
fi

echo "Starting Nginx on port 80..."
nginx -g "daemon off;"
