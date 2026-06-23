# Resumen Técnico General - Estok

## ¿Qué es Estok?
Sistema de inventario personal con reconocimiento de objetos por IA. Permite catalogar objetos (libros, tecnología, muebles, ropa) tomando fotos y usando un modelo de visión local para autocompletar los datos.

---

## 1. LM Studio - Reconocimiento de Imágenes

### Modelo
- **Modelo**: `qwen2.5-vl-7b-instruct` (7B parámetros, visión-lenguaje)
- **Servidor**: LM Studio corriendo en GPU AMD Radeon RX 9060 XT (8GB VRAM)
- **Endpoint**: `http://localhost:1234/v1` (API compatible con OpenAI)
- **Timeout normal**: 120s (configurable vía `AI_API_TIMEOUT`)
- **Timeout alta resolución**: 180-240s (configurable vía `AI_HIGH_RES_TIMEOUT`)

### Cómo funciona el análisis
1. El usuario toma/sube una foto desde el frontend Astro
2. La imagen se codifica en Base64 en el navegador
3. Se envía al backend Django vía `POST /api/objetos/analizar_imagen/`
4. Django comprime la imagen (máx 640px, calidad 30%) para no exceder el contexto de 4096 tokens del modelo
5. Se envía a LM Studio pidiendo un JSON estructurado con: nombre, marca, autor, año, ISBN, estado de conservación, precio estimado, descripción, color, categoría
6. LM Studio responde con JSON → Django lo parsea y devuelve al frontend
7. El frontend autocompleta el formulario con los datos recibidos

### RAG (Retrieval Augmented Generation)
Antes de analizar, el backend busca objetos similares ya catalogados en PostgreSQL y los incluye como contexto en el prompt para mejorar la precisión.

### Limitaciones conocidas
- Contexto de solo 4096 tokens (imagen + prompt deben caber)
- No soporta `response_format: json_object` (se pide JSON explícitamente en el prompt)
- Temperatura baja (0.1) para respuestas deterministas
- Máximo 1024 tokens de respuesta

---

## 2. Conexión con la App (Astro/Python)

### Arquitectura de contenedor único
```
[Usuario] → Traefik (Coolify) → Nginx (puerto 8000)
                                    ├── /api/* → Gunicorn (puerto 8001) → Django
                                    ├── /admin/* → Gunicorn (puerto 8001)
                                    ├── /assets/* → Archivos estáticos
                                    └── /* → Astro Node (puerto 4321)
```

### Frontend (Astro + TypeScript)
- **Framework**: Astro con adapter Node (SSR, modo standalone)
- **Ubicación**: `frontend/`
- **API_URL**: En producción es `/api` (ruta relativa, mismo origen que el frontend)
- **Heartbeat**: Cada 5s verifica disponibilidad de IA via `GET /api/objetos/test_ia_stress/`
- **Flujo de análisis**:
  1. Usuario toma foto con la cámara o selecciona archivo
  2. La imagen se convierte a Base64 en el cliente
  3. Se envía POST a `/api/objetos/analizar_imagen/` con `Authorization: Bearer <jwt>`
  4. El backend responde con los datos extraídos
  5. Se autocompletan los campos del formulario

### Backend (Django + DRF)
- **Framework**: Django 5.2.3 + Django REST Framework
- **Autenticación**: JWT (SimpleJWT) + Session + Basic
- **ViewSet principal**: `ObjetoViewSet` con acciones:
  - `analizar_imagen` (POST) - Analiza imagen Base64
  - `analizar_con_ia` (POST) - Analiza objeto existente
  - `test_ia_stress` (GET) - Health check de LM Studio
  - `buscar_precio_mercadolibre` (GET) - Precios de referencia
- **Permission classes**: `[IsAuthenticated, HasRolePermission]` en todo el viewset

### Service Worker (PWA)
- Cachea assets estáticos (CSS, JS, imágenes)
- Ignora explícitamente `/api/*` (línea 66 de sw.js)
- Versión actual: `estok-cache-v8`

---

## 3. PostgreSQL y Coolify

### Base de Datos
- **Motor**: PostgreSQL 17
- **Host**: `cagtcifjoy8ydxugg4bkdll1` (hostname interno de Coolify, NO el nombre visual)
- **Red**: El contenedor debe estar en la red externa "coolify" para resolver el hostname
- **Conexión**: Variables individuales `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- **NO se usa** `DATABASE_URL` (Coolify la inyecta con un hostname incorrecto)

### Modelo de datos principal
- `Objeto` (base) con herencia multi-tabla:
  - `LibroRevista` (autor, ISBN, editorial, serie, tomo)
  - `Tecnologia` (marca, modelo)
  - `MuebleArte` (artista, material)
  - `Ropa` (talla)
- `FotoObjeto` (imágenes por objeto)
- `HistorialPrecio` (valoración histórica)
- `CustomUser` (usuario personalizado)

### Coolify
- **Orquestación**: docker-compose.yml con un solo servicio
- **Proxy reverso**: Traefik (automático de Coolify)
- **Dominio**: `https://eeestok.duckdns.org`
- **Labels de Traefik**: Configurados en docker-compose.yml
- **Redeploy**: Requerido después de cualquier cambio en dominios/configuración

---

## 4. Error/Blqueo Actual

### Síntoma
El botón "Analizar con IA" en `/objetos/nuevo` se queda trabado en "Analizando..." o muestra error `"signal is aborted without reason"` casi instantáneamente.

### Lo que DESCARTAMOS
1. **Unidades de AbortController**: Verificado: `210000` ms (210s), no 210ms ✅
2. **Service Worker**: No intercepta `/api/*` ✅
3. **LM Studio caído**: Endpoint responde desde PowerShell (401 sin token) ✅
4. **Nginx/Gunicorn**: Endpoint responde desde PowerShell ✅
5. **Navegador/extensiones**: Pasa en Chrome, incógnito, y teléfono ✅

### Hipótesis principal (NO CONFIRMADA)
**CORS Preflight**: El fetch incluye `Authorization: Bearer <token>` (header "no simple"), lo que obliga al navegador a enviar un OPTIONS preflight ANTES del POST. Si el preflight falla (por ejemplo, CorsMiddleware no lo intercepta correctamente y Django devuelve 401 porque el OPTIONS no lleva token), el navegador NUNCA envía el POST real y el fetch se queda colgado.

### Evidencia a favor
- `Invoke-WebRequest` desde PowerShell funciona (no hace CORS preflight)
- El backend responde 401 inmediatamente cuando se llama sin token
- CorsMiddleware está en MIDDLEWARE pero WhiteNoiseMiddleware está antes
- `CORS_ALLOW_ALL_ORIGINS = True` debería funcionar, pero no está verificado

### Lo que falta confirmar
- Revisar logs de Django/Gunicorn para ver si llega un OPTIONS a `analizar_imagen/`
- Probar con `curl -X OPTIONS -H "Origin: https://eeestok.duckdns.org"` desde el servidor
- Desregistrar Service Worker y probar (para descartar completamente)

---

## 5. Lo que se intentó hasta ahora

### Debugging
1. Agregar console.logs antes/después del fetch para tracking
2. Verificar unidades de AbortController con `git show`
3. Leer sw.js completo (136 líneas) - confirmar que ignora /api/
4. Probar endpoint con PowerShell - funciona
5. Probar en múltiples navegadores/dispositivos - todos fallan igual
6. Analizar configuración CORS y orden de MIDDLEWARE
7. Verificar permission classes del viewset

### Soluciones propuestas (no implementadas)
1. **Nginx responda OPTIONS**: Agregar bloque `if ($request_method = OPTIONS)` en nginx-combined.conf
2. **Debuggear CorsMiddleware**: Verificar por qué no intercepta OPTIONS
3. **Eliminar Authorization header**: Si el fetch es same-origin, usar cookies de sesión en vez de JWT

### Cambios realizados (commit a610abd)
- Console.logs antes/después del fetch de IA
- clearTimeout movido inmediatamente después del fetch exitoso
