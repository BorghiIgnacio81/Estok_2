# DIAGNÓSTICO VERIFICADO - Estado Real del Proyecto Estok
**Fecha:** 20 Junio 2026 01:18 ART
**Último commit local:** `6e54808` - "refactor: reestructuración completa del sistema de puertos con variable ESTOK_PORT"
**Último commit en origin/main:** `41ea3d8` - "fix: revertir a puerto 8000 para coincidir con config de Coolify (Exposed Ports: 8000)"

⚠️ **ADVERTENCIA:** El último commit local (`6e54808`) NO está pusheado a origin/main. origin/main está 1 commit atrás. Coolify deploya desde origin/main, así que lo que está en producción NO incluye el refactor de ESTOK_PORT.

---

## 1. ARQUITECTURA DE CONTENEDORES

### A. Dockerfiles existentes (verificado con `Get-ChildItem`):
```
C:\Users\USER\Desktop\Estok_2\Dockerfile.backend   (57 líneas - multi-etapa Python + Gunicorn)
C:\Users\USER\Desktop\Estok_2\Dockerfile.combined  (76 líneas - 3 etapas: Node build + Python build + final con Nginx)
C:\Users\USER\Desktop\Estok_2\Dockerfile.frontend  (60 líneas - 2 etapas: Node build + Node+Nginx)
```

### B. ¿Cuál usa Coolify?
**`Dockerfile.combined`** - Verificado en `docker-compose.yml` línea 18:
```yaml
build:
  context: .
  dockerfile: Dockerfile.combined
```

### C. ¿Contenedor único o separados?
**CONTENEDOR ÚNICO.** `Dockerfile.combined` construye TODO en una sola imagen:
- Etapa 1: Build frontend (Node 22)
- Etapa 2: Build backend (Python 3.12)
- Etapa 3: Imagen final con Python + Node + Nginx, copia ambos builds

Los otros Dockerfiles (`Dockerfile.backend` y `Dockerfile.frontend`) **NO se usan en producción**. Son legacy de cuando había 3 contenedores separados.

### D. Entrypoint (verificado en `entrypoint.sh`):
```bash
#!/bin/bash
set -e

ESTOK_PORT="${ESTOK_PORT:-8000}"

# 1. Migraciones Django
python manage.py migrate --noinput

# 2. Seed data
python manage.py seed_data || echo "Seed data skipped"

# 3. Gunicorn en BACKGROUND (puerto 8001)
gunicorn config.wsgi:application --bind 0.0.0.0:8001 --workers 4 --timeout 120 &
GUNICORN_PID=$!

# 4. Astro Node server en BACKGROUND (puerto 4321) SI existe entry.mjs
if [ -f /app/frontend/dist/server/entry.mjs ]; then
    cd /app/frontend
    PORT=4321 HOST=0.0.0.0 node ./dist/server/entry.mjs &
    ASTRO_PID=$!
    cd /app
fi

# 5. Reemplazar puerto en nginx.conf si ESTOK_PORT != 8000
if [ "${ESTOK_PORT}" != "8000" ]; then
    sed -i "s/listen 8000;/listen ${ESTOK_PORT};/g" /etc/nginx/sites-enabled/default
fi

# 6. Nginx en FOREGROUND (puerto ESTOK_PORT)
nginx -g "daemon off;"
```

**NO usa supervisor.** Usa `&` (background) para Gunicorn y Astro, y Nginx en foreground. Esto es frágil: si Gunicorn o Astro mueren, no hay reinicio automático.

---

## 2. CONEXIÓN A BASE DE DATOS

### A. DB_HOST en docker-compose.yml (verificado línea 45):
```yaml
DB_HOST=${DB_HOST:-cagtcifjoy8ydxugg4bkdll1}
```
Default hardcodeado: `cagtcifjoy8ydxugg4bkdll1`

### B. Red Docker "coolify" (verificado líneas 66-81):
```yaml
networks:
  - default
  - coolify

networks:
  coolify:
    external: true
```
✅ El contenedor está conectado a la red externa `coolify`.

### C. DATABASES en settings.py (verificado líneas 130-139):
```python
DATABASES = {
    'default': {
        'ENGINE': os.environ.get('DB_ENGINE', 'django.db.backends.postgresql'),
        'NAME': os.environ.get('DB_NAME', 'estok_db'),
        'USER': os.environ.get('DB_USER', 'postgres'),
        'PASSWORD': os.environ.get('DB_PASSWORD', ''),
        'HOST': os.environ.get('DB_HOST', 'postgresql-database-cagtcifjoy8ydxugg4bkdll1'),
        'PORT': os.environ.get('DB_PORT', '5432'),
    }
}
```
**NO usa DATABASE_URL.** Usa solo variables DB_* individuales. El default de DB_HOST en settings.py es `postgresql-database-cagtcifjoy8ydxugg4bkdll1` (con prefijo `postgresql-database-`), mientras que en docker-compose.yml el default es `cagtcifjoy8ydxugg4bkdll1` (sin prefijo). ⚠️ **Estos defaults son diferentes** - aunque en producción ambos se sobreescriben con la variable de entorno, es una inconsistencia.

---

## 3. ESTADO DEL ÚLTIMO DEPLOY

### A. Último commit local:
```
6e54808 (HEAD -> main) refactor: reestructuración completa del sistema de puertos con variable ESTOK_PORT
```

### B. Último commit en origin/main (lo que Coolify deploya):
```
41ea3d8 (origin/main) fix: revertir a puerto 8000 para coincidir con config de Coolify (Exposed Ports: 8000)
```

**⚠️ HEAD está 1 commit adelante de origin/main.** Los cambios del refactor ESTOK_PORT NO están en producción. Los archivos modificados sin pushear:
- `Dockerfile.combined` (solo comentarios agregados)
- `docker-compose.yml` (agregó variable ESTOK_PORT, cambió ports de fijo a variable)
- `entrypoint.sh` (agregó lógica ESTOK_PORT)

Además hay **cambios sin commitear** (ver `git status`):
- `D inventario/api/viewsets.py` - eliminado (refactor a módulos)
- `M nginx.conf` - modificado
- `?? AUDITORIA_Y_MODULARIZACION.md` - nuevo
- `?? RESUMEN_PROBLEMAS_3_DIAS.md` - nuevo
- `?? frontend/src/lib/` - nuevo (refactor frontend)
- `?? inventario/api/viewsets/` - nuevo (refactor backend)

**No puedo confirmar si Coolify ya deployó el commit 41ea3d8 sin acceso al dashboard de Coolify.**

---

## 4. PUERTOS

### A. EXPOSE en Dockerfile.combined (línea 73):
```
EXPOSE 8000
```
**Fijo en 8000.** No usa variable ESTOK_PORT. Si Coolify pasa ESTOK_PORT=8080, el EXPOSE sigue siendo 8000.

### B. Nginx interno (nginx-combined.conf línea 9):
```
listen 8000;
```
**Fijo en 8000.** El entrypoint.sh tiene un `sed` que lo reemplaza si ESTOK_PORT cambia (pero esto solo funciona si el commit 6e54808 está deployado).

### C. Variable ESTOK_PORT:
- **Definida en:** `docker-compose.yml` línea 22: `${ESTOK_PORT:-8000}`
- **Usada en:** `docker-compose.yml` (ports, label de Traefik, environment)
- **Usada en:** `entrypoint.sh` (para reemplazar puerto en nginx.conf)
- **NO usada en:** `Dockerfile.combined` (EXPOSE sigue siendo 8000 fijo)
- **NO usada en:** `nginx-combined.conf` (listen sigue siendo 8000 fijo, el entrypoint lo parchea con sed)

**⚠️ Esto es frágil:** si el entrypoint.sh falla antes del `sed`, Nginx escucha en 8000 pero Traefik espera otro puerto.

---

## 5. ASTRO

### A. Versión de Astro (verificado en package.json):
```json
"astro": "^6.4.6"
```
**Astro 6.4.6** (compatible con ^6.x, la última minor de 6.x).

### B. output mode (verificado en astro.config.mjs línea 14):
```js
output: 'server',
```
**Modo `server`** (NO hybrid, NO static). Esto significa que TODAS las rutas se renderizan en servidor, no hay páginas estáticas pre-renderizadas.

### C. Adapter (verificado en astro.config.mjs líneas 15-17):
```js
adapter: node({
  mode: 'standalone',
}),
```
**`@astrojs/node`** con mode `standalone`. Esto genera `dist/server/entry.mjs` que es un servidor Node.js autónomo.

---

## 6. PROBLEMAS DETECTADOS (verificados contra código real)

### 🔴 CRÍTICO: HEAD no pusheado a origin/main
El commit `6e54808` (refactor ESTOK_PORT) está solo en local. origin/main está en `41ea3d8`. Coolify deploya desde origin/main. **Si Coolify hizo un redeploy, está usando el código de `41ea3d8` que NO tiene la variable ESTOK_PORT.**

### 🔴 CRÍTICO: EXPOSE no usa variable ESTOK_PORT
`Dockerfile.combined` línea 73: `EXPOSE 8000` - hardcodeado. Si Coolify pasa ESTOK_PORT=8080, el EXPOSE no coincide.

### 🔴 CRÍTICO: Nginx listen hardcodeado
`nginx-combined.conf` línea 9: `listen 8000;` - hardcodeado. El entrypoint lo parchea con `sed` pero si el `sed` falla, Nginx escucha en puerto incorrecto.

### ⚠️ ALTO: Sin supervisor para procesos
Gunicorn y Astro se lanzan con `&` (background). Si alguno muere, no hay reinicio automático. El contenedor sigue vivo con Nginx solo.

### ⚠️ ALTO: Defaults de DB_HOST inconsistentes
- `settings.py` default: `postgresql-database-cagtcifjoy8ydxugg4bkdll1`
- `docker-compose.yml` default: `cagtcifjoy8ydxugg4bkdll1`
Son diferentes. En producción se sobreescriben con variable de entorno, pero en desarrollo local sin .env configurado, uno fallaría.

### ⚠️ MEDIO: Código sin commitear
Hay cambios importantes sin commitear:
- `inventario/api/viewsets.py` eliminado (refactor a módulos completado pero no commiteado)
- `frontend/src/lib/` nuevo (refactor frontend)
- `nginx.conf` modificado

### ⚠️ MEDIO: .env.example desactualizado
Todavía referencia `DATABASE_URL` (línea 18) que ya no se usa. El sistema ahora usa variables DB_* individuales.

### ℹ️ INFO: Dockerfiles legacy no usados
`Dockerfile.backend` y `Dockerfile.frontend` existen pero NO son referenciados por `docker-compose.yml`. Son código muerto.

---

## 7. LO QUE NO PUEDO VERIFICAR

1. **Si Coolify ya deployó el commit 41ea3d8** - No tengo acceso al dashboard de Coolify.
2. **Si el servidor está corriendo** - No tengo acceso al servidor remoto.
3. **Si la IA (LM Studio) responde** - No tengo acceso a la red local donde corre LM Studio.
4. **Si la base de datos PostgreSQL responde** - No tengo acceso a la base de datos.
5. **Si el frontend Astro SSR funciona** - No tengo acceso al servidor para probar rutas.
