# Resumen de Problemas (17-20 Jun 2026) - Para Claude Code

## Problema Principal
El botón "Analizar con IA" en `/objetos/nuevo` se queda trabado en "Analizando..." o muestra error "signal is aborted without reason" casi instantáneamente.

## Arquitectura Actual
- **Frontend**: Astro (SSR) en puerto 4321
- **Backend**: Django + Gunicorn en puerto 8001
- **Proxy**: Nginx en puerto 8000 (envuelve todo)
- **Infra**: Coolify + Traefik (proxy reverso externo)
- **IA**: LM Studio (GPU Radeon RX 9060 XT) - corre como proceso separado en el mismo servidor
- **Contenedor**: Único (Dockerfile.combined) con entrypoint.sh que lanza Gunicorn + Astro + Nginx

## Timeouts Configurados
- Nginx `proxy_read_timeout`: 200s (para `/api/`)
- Gunicorn: 200s (por defecto)
- Frontend AbortController: 210000ms (210s)
- Heartbeat: 5000ms (5s)

## Lo que ya verificamos (y descartamos)

### 1. Error de unidades en AbortController
**DESCARTADO.** El código en el commit `a09e8f1` (que está corriendo en producción) tiene `210000` ms, NO `210`. Verificado con `git show a09e8f1:frontend/src/pages/objetos/nuevo.astro`.

### 2. Service Worker interfiriendo
**DESCARTADO.** El `sw.js` explícitamente ignora requests a `/api/` (línea 66: `if (url.pathname.startsWith('/api/')) return;`). Leído completo (136 líneas). No hay `event.respondWith()` para POST a `/api/`. El SW es inocente.

### 3. clearTimeout no ejecutado en catch/finally
**PARCIALMENTE CIERTO.** El `clearTimeout(timeoutId)` estaba solo después del fetch exitoso. Si el fetch lanzaba excepción, el timeout de 210s seguía corriendo en background. Pero 210s no explica el error "casi instantáneo".

### 4. LM Studio caído
**DESCARTADO.** El endpoint responde inmediatamente desde PowerShell (401 sin token). El backend está vivo.

### 5. Heartbeat reporta IA disponible pero el endpoint real falla
**POSIBLE.** El heartbeat usa `GET /api/objetos/test_ia_stress/` que es un endpoint liviano. El análisis real usa `POST /api/objetos/analizar_imagen/` que requiere conexión a LM Studio. Si LM Studio está en un estado donde acepta conexiones pero no procesa (por ejemplo, modelo no cargado), el heartbeat puede dar OK pero el análisis real falla.

### 6. Nginx cierra conexión antes que Gunicorn
**DESCARTADO.** El endpoint responde inmediatamente desde PowerShell (pasa por Nginx igual que el navegador).

### 7. CORS Preflight (NUEVA HIPÓTESIS PRINCIPAL)
**CAUSA MÁS PROBABLE.** El fetch lleva `Authorization: Bearer <token>` → header "no simple" → navegador envía OPTIONS preflight ANTES del POST. Si el preflight falla (por cualquier razón), el navegador NUNCA envía el POST real y el fetch se queda colgado.

## Evidencia que apoya CORS Preflight

### A. Configuración de CORS (settings.py)
- `CORS_ALLOW_ALL_ORIGINS = True` ✅
- `CORS_ALLOW_METHODS` incluye `'OPTIONS'` ✅
- `CORS_ALLOW_HEADERS` incluye `'authorization'` y `'content-type'` ✅
- `CORS_ALLOW_CREDENTIALS = True` ✅

### B. Orden de MIDDLEWARE (settings.py líneas 93-103)
```
1. SecurityMiddleware
2. WhiteNoiseMiddleware  ← ANTES que CorsMiddleware
3. SessionMiddleware
4. CorsMiddleware  ← ANTES que AuthMiddleware ✅
5. CommonMiddleware
6. CsrfViewMiddleware
7. AuthenticationMiddleware ← DESPUÉS de CORS ✅
8. MessageMiddleware
9. XFrameOptionsMiddleware
```
CorsMiddleware (posición 4) está ANTES que AuthenticationMiddleware (posición 7) ✅. Pero WhiteNoiseMiddleware (posición 2) está ANTES que CorsMiddleware - potencialmente podría interceptar OPTIONS para archivos estáticos, pero no para `/api/`.

### C. Nginx (nginx-combined.conf líneas 25-33)
```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_read_timeout 200s;
    proxy_connect_timeout 30s;
    # NO hay manejo especial de OPTIONS
}
```
Nginx pasa OPTIONS directamente a Gunicorn. No hay `if ($request_method = OPTIONS)` ni headers CORS en Nginx.

### D. Permission classes del viewset (objetos.py línea 42)
```python
class ObjetoViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]
```
**TODAS las acciones requieren autenticación**, incluyendo `analizar_imagen`.

## Mecanismo del bug (CORS Preflight)

1. El fetch en `nuevo.astro` línea 785-796 incluye `Authorization: Bearer <token>` → header "no simple"
2. El navegador (Chrome/Firefox) envía un OPTIONS preflight a `/api/objetos/analizar_imagen/` ANTES del POST
3. El OPTIONS no lleva `Authorization` (por definición, los preflights no llevan credenciales)
4. CorsMiddleware (posición 4 en MIDDLEWARE) DEBERÍA interceptar el OPTIONS y responder 200 inmediatamente
5. **PERO si CorsMiddleware no intercepta** (por cualquier razón: bug, configuración, orden de middleware), el OPTIONS sigue bajando
6. Llega a AuthenticationMiddleware → no hay token → 401
7. DRF devuelve 401 al OPTIONS
8. **El navegador ve 401 en el preflight → NUNCA envía el POST real**
9. El fetch del POST se queda colgado indefinidamente esperando una respuesta que nunca llega
10. Chrome muestra "signal is aborted without reason" porque internamente aborta la promesa

**Por qué PowerShell funciona:** `Invoke-WebRequest` no hace CORS preflight. No es un navegador. Envía el POST directamente y recibe 401 (sin token). Por eso responde al instante.

**Por qué pasa en Chrome/incógnito/teléfono:** Todos son navegadores que respetan CORS. Todos hacen preflight.

## Para confirmar
Revisar logs de Gunicorn/Django en el servidor: buscar requests OPTIONS a `/api/objetos/analizar_imagen/`. Si llega un OPTIONS y responde 401, la causa está confirmada.

## Posibles soluciones

### Solución 1 (rápida): Hacer que Nginx responda OPTIONS directamente
Agregar en `nginx-combined.conf` dentro de `location /api/`:
```nginx
if ($request_method = OPTIONS) {
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS, PUT, PATCH, DELETE" always;
    add_header Access-Control-Allow-Headers "authorization, content-type, accept, origin, x-csrftoken, x-requested-with" always;
    add_header Access-Control-Allow-Credentials "true" always;
    add_header Content-Length "0" always;
    add_header Content-Type "text/plain" always;
    return 204;
}
```

### Solución 2 (correcta): Debuggear por qué CorsMiddleware no intercepta
- Verificar que `django-cors-headers` esté instalado (`pip show django-cors-headers`)
- Verificar que `corsheaders` esté en `INSTALLED_APPS` (sí, línea 89)
- Verificar que CorsMiddleware esté en la posición correcta (sí, posición 4)
- Probar con `curl -X OPTIONS -H "Origin: https://eeestok.duckdns.org" https://eeestok.duckdns.org/api/objetos/analizar_imagen/` desde el servidor

### Solución 3 (workaround): No usar Authorization header, usar cookie/session
Si el fetch es same-origin (API_URL = '/api'), las cookies de sesión se envían automáticamente. No necesitaría `Authorization: Bearer`. Sin ese header, el fetch es "simple" y no dispara preflight.

## Cambios realizados (commit a610abd)
1. Agregado `console.log('[IA] Enviando fetch a analizar_imagen con timeout de 210s')` justo antes del fetch
2. Agregado `console.log('[IA] Fetch completado, status:', response.status)` justo después
3. Agregado `console.warn('[IA] Timeout de 210s alcanzado, abortando fetch')` dentro del setTimeout
4. Movido `clearTimeout(timeoutId)` inmediatamente después del fetch exitoso (antes estaba después de procesar la respuesta)

## Preguntas para Claude Code

1. **CORS Preflight:** ¿Es correcto que CorsMiddleware con `CORS_ALLOW_ALL_ORIGINS = True` DEBERÍA interceptar OPTIONS automáticamente? ¿Hay algún caso donde no lo haga?

2. **WhiteNoise antes que CorsMiddleware:** WhiteNoiseMiddleware está en posición 2, antes que CorsMiddleware (posición 4). ¿Podría WhiteNoise estar interceptando el OPTIONS para `/api/`? WhiteNoise normalmente solo maneja GET/HEAD para archivos estáticos, pero ¿hay algún caso borde?

3. **¿Por qué CorsMiddleware no interceptaría?** Si `CORS_ALLOW_ALL_ORIGINS = True`, CorsMiddleware debería responder 200 a cualquier OPTIONS con header Origin. ¿Hay alguna configuración que pueda impedir esto? ¿El orden de middleware es correcto?

4. **Solución 3 (sin Authorization):** Si el fetch es same-origin (`/api/`), ¿las cookies de sesión de Django se enviarían automáticamente? ¿DRF con SessionAuthentication funcionaría sin el header Bearer? ¿O JWTAuthentication es obligatorio?

5. **¿Conviene la solución 1 (Nginx responde OPTIONS)?** Es la más rápida y no requiere redeploy del backend. ¿Tiene alguna desventaja?

## Archivos Relevantes
- `frontend/src/pages/objetos/nuevo.astro` - Todo el frontend del formulario + IA
- `inventario/api/viewsets/objetos.py` - Endpoint `analizar_imagen` (línea 200+)
- `inventario/services/ai_vision_service.py` - Servicio que conecta con LM Studio
- `nginx-combined.conf` - Config de Nginx (timeouts en línea 31)
- `entrypoint.sh` - Script de arranque (Gunicorn + Astro + Nginx)
- `Dockerfile.combined` - Dockerfile de producción
- `frontend/public/sw.js` - Service Worker
