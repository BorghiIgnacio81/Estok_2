# Arquitectura de Estok

Documentación de referencia basada en el estado real verificado del sistema en producción (Coolify).

---

## 1. Diagrama de flujo de red

```
Internet
    │
    ▼
Traefik (coolify-proxy)
    │  Host(`eeestok.duckdns.org`) && PathPrefix(`/`)
    │  puerto 443 (TLS)
    ▼
┌─────────────────────────────────────────────────────┐
│              Contenedor Único (estok-app)            │
│                                                      │
│  Nginx (ESTOK_PORT, default 8000)                    │
│    ├── /api/*        → proxy_pass → Gunicorn :8001   │
│    ├── /admin/*      → proxy_pass → Gunicorn :8001   │
│    ├── /media/*      → proxy_pass → Gunicorn :8001   │
│    ├── /static/*     → proxy_pass → Gunicorn :8001   │
│    ├── /assets/*     → root /app/frontend/dist/client │
│    ├── /icons/*      → root /app/frontend/dist/client │
│    ├── /manifest.json→ root /app/frontend/dist/client │
│    ├── /sw.js        → root /app/frontend/dist/client │
│    ├── /_astro/*     → root /app/frontend/dist/client │
│    └── /             → proxy_pass → Astro :4321       │
│                          fallback → archivos estáticos │
│                                                      │
│  Gunicorn (Django API) → puerto 8001                 │
│  Astro Node (Frontend SSR) → puerto 4321             │
│                                                      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
          PostgreSQL (Coolify)
          hostname: cagtcifjoy8ydxugg4bkdll1
          puerto: 5432
          red: coolify (externa)
```

---

## 2. Servicios reales en el servidor

| Nombre | Imagen | Puerto | Red(es) | Propósito |
|--------|--------|--------|---------|-----------|
| `estok-app` | `estok_2-app` (build local) | 8000 | default, coolify | Contenedor único: Nginx + Gunicorn + Astro |
| PostgreSQL | postgres (Coolify managed) | 5432 | coolify | Base de datos del inventario |

**TODO:** Verificar si hay otros contenedores de Coolify en el servidor (coolify-proxy/Traefik, coolify-db, etc.) y agregarlos a esta tabla.

---

## 3. Errores ya resueltos — NO repetir el diagnóstico

| # | Síntoma | Causa real | Solución |
|---|---------|------------|----------|
| 1 | `Temporary failure in name resolution` al conectar a PostgreSQL | DB_HOST tenía prefijo `postgresql-database-` (nombre visual de Coolify, no hostname real) | Cambiar DB_HOST a `cagtcifjoy8ydxugg4bkdll1` |
| 2 | `ModuleNotFoundError: No module named 'inventario.api.services'` | Import relativo `..services` en `organizacion.py` no actualizado al mover archivo de `api/viewsets.py` a `api/viewsets/organizacion.py` | Cambiar `..services` a `...services` |
| 3 | Django no arranca por `DATABASE_URL` no definida | `settings.py` tenía `import dj_database_url` y `os.environ.get('DATABASE_URL')` que no existe en el entorno | Eliminar `dj_database_url`, usar solo variables DB_* |
| 4 | Backend no resuelve hostname de PostgreSQL | El contenedor no estaba conectado a la red externa `coolify` | Agregar `networks: - coolify` en docker-compose.yml |
| 5 | 503 de Traefik aunque el contenedor responde OK | El campo "Domains" en Coolify no tenía `https://` al inicio, generando regla `Host(``) && PathPrefix(`dominio`)` | Poner `https://eeestok.duckdns.org` en el campo Domains |
| 6 | Contenedor manual `test-pg` corriendo sin propósito | Debug session previa que no se limpió | `docker rm -f test-pg` |

---

## 4. Cómo diagnosticar un 503 o app caída

Seguir estos pasos en orden:

### Paso 1: ¿El contenedor está corriendo?
```bash
docker ps -a | grep estok
```
Si no aparece, hacer redeploy desde Coolify o levantar manualmente.

### Paso 2: ¿La app arrancó correctamente?
```bash
docker logs estok-app --tail 50
```
Buscar:
- `"Starting Gunicorn on port 8001..."` ✅
- `"Starting Astro Node server on port 4321..."` ✅
- `"Starting Nginx on port ..."` ✅
- Si hay `Traceback` o `ModuleNotFoundError` → error de código, no de infraestructura.

### Paso 3: ¿Responde desde dentro del contenedor?
```bash
docker exec estok-app curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/
docker exec estok-app curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/
docker exec estok-app curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/api/
```
- Si `localhost:8000` responde 200 pero desde afuera da 503 → el problema es Traefik.
- Si `localhost:8000` no responde → el problema es Nginx.
- Si `localhost:8001` no responde → el problema es Gunicorn/Django.

### Paso 4: ¿Traefik está enrutando bien?
```bash
docker inspect estok-app | grep "traefik.http.routers.*rule"
```
La regla **correcta** debe ser:
```
Host(`eeestok.duckdns.org`) && PathPrefix(`/`)
```
Si dice `Host(``) && PathPrefix(`eeestok.duckdns.org`)` → el campo Domains en Coolify está mal formado (falta `https://`).

### Paso 5: ¿El contenedor está en la red coolify?
```bash
docker inspect estok-app | grep -A 15 '"Networks"'
```
Debe mostrar tanto `coolify` como `default` en la lista de redes.

---

## 5. Checklist antes de cualquier cambio de infraestructura

- [ ] **¿Confirmaste el estado real con comandos, no con memoria?**
  - `docker ps -a` para ver qué contenedores existen
  - `docker logs estok-app --tail 20` para ver el estado actual
  - `git log -1 --oneline` para saber qué commit está en origin/main

- [ ] **¿origin/main está actualizado?**
  - `git fetch origin && git log origin/main -1 --oneline`
  - Si el servidor tiene un commit distinto al de origin/main, el código en GitHub NO es el que está corriendo

- [ ] **¿Hay contenedores corriendo por fuera de Coolify que puedan confundir el diagnóstico?**
  - `docker ps -a` y revisar si hay contenedores manuales (nombres como `test-*`, `debug-*`, etc.)
  - Si existen, documentarlos y eliminarlos antes de cerrar la sesión

- [ ] **¿El cambio requiere redeploy explícito o se aplica solo?**
  - Cambios en `Domains` o `General` de Coolify → requieren Redeploy
  - Cambios en variables de entorno → requieren Redeploy
  - Cambios en código (git push) → requieren Redeploy
  - Nada en Coolify se aplica automáticamente al guardar

- [ ] **¿Verificaste los imports relativos después de mover archivos?**
  - `python manage.py check` (o pedir que lo corran en el servidor)
  - Los imports `..` vs `...` cambian de significado al cambiar la profundidad del directorio

---

## 6. Referencias de configuración

### Variables de entorno críticas (docker-compose.yml)

| Variable | Default | Dónde se usa |
|----------|---------|-------------|
| `ESTOK_PORT` | `8000` | EXPOSE en Dockerfile, listen en nginx, puerto de Traefik |
| `DB_HOST` | `cagtcifjoy8ydxugg4bkdll1` | Conexión a PostgreSQL (red coolify) |
| `DB_PORT` | `5432` | Conexión a PostgreSQL |
| `DB_NAME` | `estok_db` | Conexión a PostgreSQL |
| `DB_USER` | `postgres` | Conexión a PostgreSQL |
| `DB_PASSWORD` | (requerido) | Conexión a PostgreSQL |
| `DJANGO_SECRET_KEY` | (requerido) | Firma de sesiones y tokens |
| `JWT_SECRET` | (requerido) | Firma de tokens JWT |
| `AI_API_ENDPOINT` | `http://192.168.0.101:1234/v1` | Conexión a LM Studio (IA local) |

### Puertos internos (no expuestos al exterior)

| Puerto | Servicio | Propósito |
|--------|----------|-----------|
| 8001 | Gunicorn | API Django (solo localhost) |
| 4321 | Astro Node | Frontend SSR (solo localhost) |
| 8000 | Nginx | Gateway único (expuesto vía Traefik) |
