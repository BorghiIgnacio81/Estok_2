#!/bin/bash
set -e

echo "=== Starting Estok ==="

echo "Running migrations..."
python manage.py migrate --noinput

echo "Seeding data..."
python manage.py seed_data

echo "Starting Gunicorn on port 8000..."
gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 4 --timeout 120 &
GUNICORN_PID=$!
echo "Gunicorn started (PID: $GUNICORN_PID)"

echo "Starting Astro Node server on port 4321..."
cd /app/frontend
node ./dist/server/entry.mjs &
ASTRO_PID=$!
echo "Astro server started (PID: $ASTRO_PID)"

cd /app

echo "Starting Nginx on port 80..."
nginx -g "daemon off;"
