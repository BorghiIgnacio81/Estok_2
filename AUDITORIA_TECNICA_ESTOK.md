# AUDITORÍA TÉCNICA VERIFICADA — ESTOK

> **Documento de referencia único (fuente única de verdad).**
> Generado por inspección **directa del código fuente** del repositorio local
> `c:\Users\USER\Desktop\Estok_2`. Todo dato de este informe está respaldado por
> el archivo + línea citado. Lo que no pudo comprobarse se marca explícitamente
> como **NO VERIFICADO** (no se asume nada).

## 0. Contexto de la auditoría (evidencia de método)

| Ítem | Valor verificado |
| --- | --- |
| Commit HEAD (local) | `a7caf4389c40efbd4fc07dfd8bb1c020e67eb3ec` |
| Fecha del commit | `2026-10-15 14:04:53 -0300` |
| Mensaje | `fix(mudanza): implementar disyuntor estricto unificado para liberar el stock interno y calcular raices derivadas sin romper FKs` |
| Rama remota | `main` → `origin/main` en el mismo commit (`git log -1 --oneline`, `git status`) |
| Working tree | 1 archivo rastreado modificado, con nombre corrupto (ver §5.3) |
| Verificación ejecutada | `python manage.py check` → `System check identified no issues (0 silenced).` ✅ |
| Verificaciones NO ejecutadas | build de Astro (`npm run build`), acceso SSH al VPS, prueba HTTP a `https://eeestok.duckdns.org` |

**Regla de lectura de este documento:** "verificado" = leído en el archivo citado
o comando ejecutado con output real. "NO VERIFICADO" = no se probó en runtime ni
en producción. Nada se marca como ✅ funcional sin haberse ejecutado.

---

## 1. Base de datos real y persistencia

### 1.1 Motor: PostgreSQL (no SQLite)

- `config/settings.py:124-139` — bloque `DATABASES`:

```python
DATABASES = {
    'default': {
        'ENGINE': os.environ.get('DB_ENGINE', 'django.db.backends.postgresql'),
        'NAME': os.environ.get('DB_NAME', 'postgres'),
        'USER': os.environ.get('DB_USER', 'postgres'),
        'PASSWORD': os.environ.get('DB_PASSWORD', ''),
        'HOST': os.environ.get('DB_HOST', 't2oy5kwg9wdtdrf448lpmiz1'),
        'PORT': os.environ.get('DB_PORT', '5432'),
    }
}
```

- `docker-compose.yml:41-46` fuerza el engine y la red interna:

```yaml
- DB_ENGINE=django.db.backends.postgresql
- DB_NAME=${DB_NAME:-postgres}
- DB_USER=${DB_USER:-postgres}
- DB_HOST=${DB_HOST:-t2oy5kwg9wdtdrf448lpmiz1}
- DB_PORT=${DB_PORT:-5432}
```

- `requirements.txt:4` → `psycopg2-binary>=2.9,<3.0` (driver Postgres).
- `.env.example:17-22` → mismas 6 variables `DB_*`, con el hostname real
  `t2oy5kwg9wdtdrf448lpmiz1` (coincide con `.clinerules`: SIN prefijo
  `postgresql-database-`).

### 1.2 Cumplimiento de la regla anti-`DATABASE_URL` ✅

Ejecutado: `Select-String -Path 'inventario\**\*.py' -Pattern 'dj_database_url|DATABASE_URL'`
→ **0 resultados**. No hay `import dj_database_url` ni lectura de `DATABASE_URL`
en el backend. La regla del proyecto se cumple.

Ejecutado: `Select-String 'config\settings.py','inventario\**\*.py' -Pattern 'sqlite'`
→ **0 resultados**. No existe rama SQLite en el código.

### 1.3 Artefactos históricos (deuda, no afecta runtime)

| Archivo | Tamaño | Estado | Evidencia |
| --- | --- | --- | --- |
| `db.sqlite3` (raíz) | 249.856 B | Ignorado por git (`.gitignore:16`), **no referenciado por ningún módulo** | `git ls-files` no lo lista |
| `backups/`, `path/to/`, `media/qrcodes/` | — | Directorios locales presentes en el árbol de trabajo | listado de raíz |

### 1.4 Persistencia de archivos (media/static)

- `config/settings.py:203-218`: `STATIC_URL=/static/`, `STATIC_ROOT=BASE_DIR/staticfiles`,
  `STATICFILES_STORAGE = whitenoise.storage.CompressedManifestStaticFilesStorage`,
  `WHITENOISE_ROOT = BASE_DIR/staticfiles` (sirve `manifest.json`/`sw.js` en la raíz).
- `config/settings.py:222-227`: `MEDIA_URL=/media/`, `MEDIA_ROOT=/app/media` (inyectado
  por `docker-compose.yml:58-59`), `SITE_URL=https://eeestok.duckdns.org`.
- `docker-compose.yml:68-76`: volúmenes nombrados `media_data:/app/media` y
  `static_data:/app/staticfiles` → **la persistencia real de media sobrevive al
  redeploy**.
- `nginx-combined.conf:108-112`: `/media/` se sirve con `alias /app/media/`
  (no pasa por Django en producción, correcto con `DEBUG=False`).

### 1.5 Migraciones

27 migraciones en `inventario/migrations/` (`0001_initial` → `0027_declarado_movible_default_false`),
es decir el esquema está **completamente versionado**; la última migración es de
negocio, no de esquema puro (`0027` agrega `declarado_movible` con default `False`
y hace `RunPython(reset_declarado_movible)`).

`entrypoint.sh:39-40` corre `python manage.py migrate --noinput` en cada arranque
del contenedor.

---

## 2. Arquitectura y stack técnico real

### 2.1 Frontend — Astro SSR

| Componente | Valor verificado | Evidencia |
| --- | --- | --- |
| Framework | **Astro `^6.4.6`** | `frontend/package.json:19` |
| Modo de render | **`output: 'server'`** (SSR) | `frontend/astro.config.mjs:14` |
| Adapter | `@astrojs/node` `^10.1.4`, `mode: 'standalone'` | `frontend/astro.config.mjs:9,15-17` |
| CSS | TailwindCSS `^4.3.0` vía plugin Vite `@tailwindcss/vite` | `frontend/package.json:18,21` y `astro.config.mjs:8,23` |
| Librerías extra activas | `cropperjs ^2.1.1` (recorte de fotos), `typescript ^6.0.3`, `@astrojs/check ^0.9.9` | `frontend/package.json:20,22,15` |
| Node requerido | `>=22.12.0` (`engines`) y `node:22-alpine` en build | `frontend/package.json:5-7`, `Dockerfile.combined:13` |
| Scripts | `dev`, `build` (`astro build`), `preview` | `frontend/package.json:8-13` |
| Sitio | `site: process.env.PUBLIC_SITE_URL \|\| 'https://eeestok.duckdns.org'` | `frontend/astro.config.mjs:13` |

**Salida del build:** `dist/client/` (assets con hash) + `dist/server/entry.mjs`
(el server Node SSR se levanta en el puerto 4321 — `entrypoint.sh:72-75`).

**Páginas activas** (`frontend/src/pages/`):

| Ruta | Archivo | Líneas |
| --- | --- | --- |
| `/` (dashboard/almacén general) | `index.astro` | 1037 ⚠️ |
| `/almacenamiento` | `almacenamiento.astro` | 372 |
| `/objetos` | `objetos.astro` | 224 |
| `/objetos/:id` | `objetos/[id]/index.astro` | 666 ⚠️ |
| `/objetos/:id/editar` | `objetos/[id]/editar/index.astro` | 268 |
| `/objetos/nuevo` | `objetos/nuevo.astro` | 76 |
| `/alertas-stock` (= pestaña **Decisiones**) | `alertas-stock/index.astro` | 204 |
| `/contenedores/:id` | `contenedores/[id]/index.astro` | 343 |
| `/mudanza` | `mudanza.astro` | 369 |
| `/login` / `/register` | `login.astro` / `register.astro` | 345 / 247 |
| `/ubicaciones/:id` / `/ubicaciones/:id/editar` | — | 210 / 282 |
| `/estoks`, `/escanear`, `/perfil`, `/diagnostico-ia`, `/dashboard` | — | &lt; 400 c/u |

**Componentes Astro activos** (`frontend/src/components/`): `AuthGuard`, `BaseLayout`
(1080 líneas ⚠️, layout global y su nav), `ChatModal`, `ImageEditor`,
`CategoriaCreator`, `MinimapaRuta`, `MinimapaModuloUnificado`, `MobileNavBars`,
`ModalDescarteGracia`, `ModalNotificarDueno`, `PublicarObjetoModal`,
**`VotacionesPendientes`** (host de votaciones), `LoadingState`, `ErrorState`,
`EmptyState`, `OnboardingBienvenida`, `OnboardingCodigoInvitacion`, subcarpetas
`objetos/`, `onboarding/`, `ui/`.

**Módulos JS/TS de la app** (`frontend/src/lib/`, ~60 archivos): motor de
almacenamiento (`almacenamientoBoard.ts` 1664 líneas ⚠️, `visorHabitacion.ts` 794 ⚠️,
`visorContenedorGrande.ts` 954 ⚠️), mapa/portales (`lib/mapa/`, `lib/mapaCasita/`),
canasta (`bandejaSinUbicar.ts` + `bandejaSinUbicarDatos.ts` + `bandejaCargaFina*.ts`),
decisiones (`decisionesPendientes.ts`, `decisionesGrupos.ts`, `decisionesTarjeta.ts`,
`votacionesDecisiones.ts`, `descarteModales.ts`, `descarteGracia.ts`) y taxonomía
compartida (`taxonomiaContenedor.ts`, `espacioUnico.ts`, `muebleMovil.ts`).

**Auth centralizada (regla del proyecto)** — verificado con grep de definiciones:

```
frontend/src/services/auth/session.ts:58   export function getAuthHeaders()
frontend/src/services/auth/tokens.ts:20    export function getToken()
```

Son las **únicas definiciones** del proyecto; `frontend/src/services/auth/index.ts:19-41`
las re-exporta, así que los consumidores siguen usando `from '../services/auth'`.
✅ No hay duplicación de headers/token en páginas ni servicios.
(Nota de forma: `.clinerules` nombra `frontend/src/services/auth.ts`; hoy es el
**paquete** `frontend/src/services/auth/` — misma garantía de fuente única,
archivo partido por modularización.)

### 2.2 Backend — Django REST Framework

| Ítem | Valor | Evidencia |
| --- | --- | --- |
| Django | `>=5.2,<6.0` | `requirements.txt:1` |
| DRF | `>=3.15,<4.0` | `requirements.txt:2` |
| JWT | `djangorestframework-simplejwt>=5.5,<6.0` | `requirements.txt:3` |
| Servidor | Gunicorn 23.x, `--workers 4 --timeout 240`, bind `0.0.0.0:8001` | `requirements.txt:9`, `entrypoint.sh:52` |
| App única | `inventario` | `config/settings.py:80-91` |
| Usuario | `AUTH_USER_MODEL = 'inventario.CustomUser'` | `config/settings.py:145` |
| Paginación | `PageNumberPagination`, `PAGE_SIZE=25` | `config/settings.py:175-176` |
| Permiso por defecto | `IsAuthenticated` | `config/settings.py:172-174` |
| CORS | `CORS_ALLOW_ALL_ORIGINS` default `True` + lista explícita; `CORS_ALLOW_CREDENTIALS=True` | `config/settings.py:49-75` |
| Zona/i18n | `es-ar`, `America/Argentina/Buenos_Aires`, `USE_TZ=True` | `config/settings.py:195-198` |

**Middlewares** (`config/settings.py:93-103`, en orden): `SecurityMiddleware` →
`WhiteNoiseMiddleware` → `SessionMiddleware` → **`corsheaders.middleware.CorsMiddleware`**
→ `CommonMiddleware` → `CsrfViewMiddleware` → `AuthenticationMiddleware` →
`MessageMiddleware` → `XFrameOptionsMiddleware`. Todos de Django/WhiteNoise/CORS:
**no existe middleware propio de la app**.

**Autenticación DRF** (`config/settings.py:166-190`): JWT primero, luego
`SessionAuthentication` y `BasicAuthentication`; `ACCESS_TOKEN_LIFETIME=3600 s` (env),
`REFRESH=604800 s`, `ROTATE_REFRESH_TOKENS=True`, `BLACKLIST_AFTER_ROTATION=True`,
`AUTH_HEADER_TYPES=('Bearer',)`.

> ⚠️ **Hallazgo (deuda de seguridad, verificado por lectura):**
> `INSTALLED_APPS` (`config/settings.py:80-91`) **no incluye**
> `rest_framework_simplejwt.token_blacklist`, por lo que `BLACKLIST_AFTER_ROTATION=True`
> no tiene efecto real (SimpleJWT ignora la ausencia de la app). Consecuencia: al
> rotar un refresh token, el anterior **no queda invalidado**. No probado en runtime;
> es una observación de configuración.

**Modularización del backend** (paquetes, no monolito):

```
inventario/
├── models/          11 módulos (base, usuarios, nucleo, clasificacion, espacios,
│                    ubicaciones, productos, multimedia, notificaciones,
│                    integraciones, chat, decisiones) + fachada __init__.py
├── api/
│   ├── urls.py      DefaultRouter con 16 ViewSets + rutas manuales
│   ├── serializers/ 12 módulos
│   └── viewsets/    auth, base, categorias, chat, decisiones, decisiones_publicas,
│                    estok, fusion_espacial, historial, ia, mercadolibre_views,
│                    mudanza, mudanza_masiva, multimedia, super_admin, version
│                    (+ subpaquetes organizacion/ [5 módulos] y objetos/ [9 módulos])
├── services/        ~40 servicios de dominio
├── management/commands/  (forzar_usuario_ygumy, seed_data, cargar_categorias_meli, ...)
├── admin.py · apps.py · signals.py · migrations/ (27)
```

**Rutas raíz** (`inventario/api/urls.py:42-87`): con `DefaultRouter` quedan expuestos
roles, usuarios, ubicaciones, **contenedores**, **objetos**, fotos, historial-precios,
alertas-stock, **decisiones**, estoks, codigos-invitacion, cambiar-estok-activo,
mensajes, version, categorias, mercadolibre, `admin/usuarios`, `admin/estoks`; más
`ai/models/`, `inventario/mudanza/`, `inventario/mudanza/todo/`,
`public/objeto-remoto-decision/` y `api-auth/`.

`config/urls.py:42-68`: `admin/` (Django), `api/` (app), `api/token/`,
`api/token/refresh/`, `api/token/verify/`, `ml-callback/`, favicons servidos por
`FileResponse` y una última regla `re_path` que sirve el HTML de Astro desde
`STATIC_ROOT` como fallback SPA.

### 2.3 Despliegue y contenedores

**Contenedor único (regla del proyecto cumplida):** sólo `Dockerfile.combined`
(`docker-compose.yml:18`) con 3 etapas:

1. `node:22-alpine` → `npm ci` + `npm run build` (`Dockerfile.combined:13-25`).
2. `python:3.12-slim` → `pip install -r requirements.txt` (`:30-44`).
3. Imagen final: Python 3.12-slim + **Node.js 22 (NodeSource)** + **Nginx**, copia
   backend y `frontend/dist` (`:47-118`). Incluye 2 mitigaciones anti-OOM
   documentadas en el propio archivo: dependencia secuencial forzada entre etapas
   (`:34-40`, `:56-67`) y capas `RUN` fragmentadas (`:69-100`).

**Arranque** (`entrypoint.sh`, `ENTRYPOINT` del contenedor):

| Paso | Línea | Acción |
| --- | --- | --- |
| 1 | `:22-37` | genera `/app/version.json` (commit + timestamp) |
| 2 | `:40` | `migrate --noinput` |
| 3 | `:43` | `forzar_usuario_ygumy` (superuser + Estok Principal) |
| 4 | `:46` | `seed_data` |
| 5 | `:49` | `cargar_categorias_meli` (categorías ML, limpieza destructiva) |
| 6 | `:52-69` | Gunicorn `:8001` + espera real contra `/api/` |
| 7 | `:72-99` | Astro `node entry.mjs` `:4321` + espera real |
| 8 | `:102-108` | Nginx en foreground escuchando `${ESTOK_PORT:-8000}` |

**Nginx** (`nginx-combined.conf` → `/etc/nginx/sites-enabled/default`):

| Location | Destino | Evidencia |
| --- | --- | --- |
| `/api/` | proxy → `127.0.0.1:8001` + **preflight OPTIONS resuelto en Nginx** con `map $http_origin $cors_origin` | `:13-60` |
| `/ml-callback/` | proxy → 8001 | `:63-71` |
| `/admin/usuarios`, `/admin/estoks` (match exacto) | proxy → Astro 4321 (prioridad sobre `/admin/`) | `:76-94` |
| `/admin/` | proxy → 8001 | `:97-103` |
| `/media/` | `alias /app/media/` + cache 30d | `:108-112` |
| `/static/` | proxy → 8001 (WhiteNoise) + cache 1y | `:115-119` |
| `/assets/`, `/icons/`, `/_astro/`, `/manifest.json`, `/sw.js` | disco `dist/client` con fallback `@astro` | `:122-162` |
| `/` | proxy → Astro 4321; `@astro` = HTML estático de fallback | `:166-185` |

**Docker Compose / Coolify / Traefik** (`docker-compose.yml`): un servicio `app`,
`restart: unless-stopped`, puerto `${ESTOK_PORT:-8000}`, labels Traefik
``Host(`eeestok.duckdns.org`)`` + `entrypoints=websecure` + `tls=true` (`:24-28`),
redes `default` + `coolify` (externa, `:65-80`), coherente con `.clinerules`.

> Nota operativa (según `.clinerules`, **no re-verificado** en esta sesión): el
> campo *Domains* de Coolify debe incluir el esquema `https://` o Traefik genera
> `Host()` vacío y responde 503; el Redeploy lo dispara siempre el usuario.

**Infra Hetzner:** la IP `178.156.224.212` y las llaves `Hetzner/llavehezner[.pub]`
están declaradas en `.clinerules`; **NO VERIFICADO** en esta auditoría (no se abrió
sesión SSH ni se ejecutó `docker ps`/`docker inspect` en el servidor).

---

## 3. Modelo de datos y reglas de negocio

### 3.1 Jerarquía real de entidades (16 modelos en 11 módulos)

`inventario/models/__init__.py:6-18` re-exporta la fachada completa:
`Role, CustomUser, Membresia, CodigoInvitacion, Estok, Categoria, Ubicacion,
Contenedor, Objeto, HistorialPrecio, FotoObjeto, AlertaStock, MercadoLibreToken,
Mensaje, DecisionVotacion, VotoDecision`.

```
Planta            → NO es un modelo independiente:
                    · Estok.cantidad_pisos (+ tipo_layout CASA_2_PISOS / VISTA_PLANTA_UNICA)
                      nucleo.py:19-33
                    · Ubicacion.piso (PRIMER_PISO / PLANTA_BAJA)  ubicaciones.py:33-42
Habitación / zona → Ubicacion (FK estok, self-FK parent_ubicacion,
                    parent_grid_row/col, grid_filas/columnas, espacio_unico,
                    ui_left/top/width/height)  ubicaciones.py
Mueble / Caja /
Espacio           → Contenedor (FK ubicacion, self-FK parent_contenedor,
                    tipo taxonómico, espacio_unico, declarado_movible,
                    es_inmueble, en_transito_interno, grilla + ui_*)  espacios.py
Objeto (stock)    → Objeto (FK contenedor, FK ubicacion, coordenadas finas
                    parent_grid_row/col, en_transito_interno, owner_action,
                    período de gracia del descarte)  productos.py
```

La recursión **Mueble → Caja → sub-caja → Objeto** se sostiene con
`Contenedor.parent_contenedor` (self-FK, `espacios.py:28-36`) y las coordenadas
`parent_grid_row/parent_grid_col` (`espacios.py:37-48`); la grilla interna puede ser
asimétrica (`grid_filas_config`, `espacios.py:59-64`).

**Tipos de `Contenedor`** — 5 tipos obligatorios, definidos en
`inventario/services/taxonomia_contenedor.py:38-55`:
`CONJUNTO` (estructura interna: estante/cajón), `MUEBLE_INMUEBLE` (fijo, fuerza
`es_inmueble=True`), `MUEBLE_MOVIL`, `CAJA`, `OBJETO`; con la clasificación física
`TIPOS_ANCLADOS=(CONJUNTO, MUEBLE_INMUEBLE)` vs `TIPOS_MOVILES=(CAJA, OBJETO, MUEBLE_MOVIL)`
y `TIPOS_TRANSITO_INTERNO=(CAJA, OBJETO)`.
El tipo se **infiere automáticamente en `Contenedor.save()`**
(`models/espacios.py:243-291`: inferencia de tipo, `es_inmueble` forzado para
`MUEBLE_INMUEBLE`, promoción del anfitrión a `MUEBLE_MOVIL` cuando recibe
sub-divisiones, y generación del QR).

### 3.2 Ubicación exacta de la lógica de "stock móvil" y reglas de mudanza

| Regla | Módulo (fuente única) | Qué controla |
| --- | --- | --- |
| **Taxonomía física de 5 tipos** | `inventario/services/taxonomia_contenedor.py` | qué es anclado y qué es móvil; acepta/valida `tipo` |
| **Disyuntor estricto de stock mudable (Lote 30)** | `inventario/services/stock_mudable.py:38-80` | `qe_estructura_del_espacio()` (`raíz` + `declarado_movible=False`) y `qe_stock_mudable()` = *cajas terminales* (`tipo=CAJA`, `es_inmueble=False`, sin sub-divisiones, no-arquitectura) **∪** *estructuras declaradas* (`declarado_movible=True` + (`MUEBLE_MOVIL` o con sub-divisiones) |
| **Mudanza inter-Estok** | `inventario/services/mudanza_service.py` (+ `NOMBRE_LIMBO_LEGACY = 'Zona de Mudanza'`, `:51-55`) | traslado hermético; limbo de mudanza |
| **Mudanza masiva** | `inventario/services/mudanza_masiva_service.py` | "Mudar Todo el Stock" (bloque + purga), usa el disyuntor anterior |
| **Tránsito interno** | `inventario/services/transito_interno.py:29-60` | **el `espacio_unico` NUNCA genera "En Tránsito"** (`:37-38`); sólo CAJA/OBJETO en muebles con sub-divisiones |
| **Espejo Contenedor↔Objeto (dualidad)** | `inventario/services/espejo_contenedor.py:51-70` | excluye registros espejo (robusto a renombrados) de decisiones/objetos |
| **Canasta «Elementos por ubicar» (autoridad ORM)** | `inventario/api/viewsets/organizacion/filtros_bandeja.py:41-58` | `aplicar_filtro_bandeja()`: canal declarado `declarado_movible=True`, canal `en_transito_interno`, y **"Espacio Único"** (`parent_contenedor__espacio_unico=True` / `ubicacion__espacio_unico=True`) |
| **Catálogo de objetos (árbol)** | `inventario/services/arbol_inventario_datos.py` + `arbol_inventario_service.py` | secciones 1/3 (cajas terminales, estructuras declaradas) y rescate del limbo |
| **Reversión de tipo prohibida** | `inventario/api/serializers/organizacion.py:180-222` | una `CAJA` móvil **no puede** convertirse en mueble inmueble → HTTP 400; `CONJUNTO`/`MUEBLE_INMUEBLE` están anclados (`services.taxonomia_contenedor.es_anclado`) |

### 3.3 Reglas de negocio del tablero de Decisiones

- Votación **automática** cuando un `Objeto` tiene dueño original y **sin**
  beneficiario (`inventario/models/decisiones.py:4-9`), con 4 opciones
  (`asignar_beneficiario`, `vender`, `conservar`, `tirar`) y democracia 1-1
  garantizada por `unique_together = [('votacion','usuario')]` (`decisiones.py:186`).
- Orden por defecto del backend en las votaciones: `ordering = ['-created_at']`
  (`decisiones.py:120`) — **la más nueva primero**.
- Descartes con período de gracia: `owner_action`, `descartado_en`,
  `fecha_limite_descarte`, cálculo de `en_periodo_gracia()`,
  `descarte_listo_para_ejecutar()` y `segundos_para_descarte()`
  (`inventario/models/productos.py:291-410`) + `services/descarte_service.py`.
- Los endpoints del tablero viven en `inventario/api/viewsets/objetos/decisiones_actions.py`
  (`pendientes_decision` = Bloque 1 con exclusión de objetos en votación, y
  `panel_decisiones` = Bloques 3/4/5 + Alerta Rojo).

---

## 4. Estado del código respecto al **Lote 31** (ajustes pendientes)

> Nota de nomenclatura verificada: la cadena `Lote 31` / `LOTE 31` **no existe en
> ningún archivo del repositorio** (grep sobre 458 archivos → 0 resultados). El
> último lote citado en el código es el **Lote 30** (`stock_mudable.py:1-8`).
> Por lo tanto el "Lote 31" son los 4 ajustes enunciados por el usuario, evaluados
> uno por uno contra el código real:

| # | Ajuste pedido | Estado verificado | Evidencia |
| --- | --- | --- | --- |
| 1 | Reordenamiento visual de tarjetas en el módulo de decisiones/votaciones | ⚠️ **PENDIENTE / NO IMPLEMENTADO como tal** | ver 4.1 |
| 2 | Renombrado del botón a **"Crear Caja"** | ❌ **NO IMPLEMENTADO** (0 ocurrencias) | ver 4.2 |
| 3 | Interfaz del **Espacio Único** y canasta de bultos | ✅ **IMPLEMENTADA en código** (no verificada en producción) | ver 4.3 |
| 4 | Checkboxes de **alta rápida** para convertir objeto en caja/mueble | ❌ **NO IMPLEMENTADO** | ver 4.4 |

### 4.1 Reordenamiento visual de tarjetas en Decisiones / Votaciones

**Lo que existe hoy (verificado):**

- El ORDEN DE BLOQUES de la página está fijado en markup, no por código de
  ordenamiento: `frontend/src/pages/alertas-stock/index.astro:68-186` →
  **Bloque 1** cima: `<VotacionesPendientes />` (`:76-78`) + **Alerta Rojo** dentro
  del propio componente; **Bloque 2**: `#pendientesGrid` (`:106`);
  **Bloques 3/4/5**: `#venderSinPublicarGrid` / `#venderPublicadosGrid` (`:138-148`),
  `#tirarGrid` (`:162`) y `#conservarGrid` (`:180`).
- Comentario de contrato en `alertas-stock/index.astro:3-20`: *"ORDEN ESTRICTO DE
  BLOQUES … se lee de ARRIBA hacia ABAJO priorizando LO URGENTE primero"*.
- **Las tarjetas dentro de cada grilla no se reordenan**: el render es un `map`
  directo del array que devuelve la API:
  - Votaciones: `votacionesDecisiones.ts:263` → `host.innerHTML = estado.votaciones.map(tarjetaHtml).join('')`.
  - Pendientes: `decisionesPendientes.ts:162-...` renderiza `estado.objetos` en el
    orden recibido de `GET /api/objetos/pendientes_decision/` (sin `sort` local).
  - Grupos decididos: `decisionesGrupos.ts` pinta cada bloque en el orden del
    payload de `GET /api/objetos/panel_decisiones/`.
- El único ordenamiento explícito del backend es el de votaciones:
  `ordering = ['-created_at']` (`inventario/models/decisiones.py:120`).

**Conclusión:** no existe ningún mecanismo de reordenamiento visual (drag & drop de
tarjetas, prioridad manual, pin, orden configurable ni `sort` en el cliente). El
orden actual es **el del backend + la posición fija de los bloques**. Si el Lote 31
pide mover/tarjetas prioritarias, **falta programarlo**; y hay que definir cuál es
el criterio objetivo (urgencia por fecha de descarte, votación más antigua primero,
etc.). **PENDIENTE — requiere definición funcional.**

### 4.2 Renombrado del botón a "Crear Caja"

**Verificación ejecutada:** grep `Crear Caja|Crear caja|Nueva Caja|Nueva caja|crearCaja`
sobre los 458 archivos del proyecto → **0 resultados**. Tampoco existe en
`frontend/src/pages/*.astro` ni en `frontend/src/components/*.astro`.

**Etiquetas de creación que SÍ existen hoy** (candidatas al renombrado):

| Etiqueta real | Archivo:línea | Qué crea |
| --- | --- | --- |
| `➕ Crear Espacio` (lienzo elástico, `etiquetaCrear: 'Crear Espacio'`) | `lib/mapa/portales/editorDivisionesPortales.ts:214` | sub-división estructural dentro del cuarto/mueble |
| `➕ Crear Espacio` | `lib/visorContenedorGrandeHtml.ts:263` | ídem en el visor de contenedor grande |
| `➕ Crear Espacio` | `lib/onboarding/lienzoDivisiones.ts:109` | ídem en el onboarding |
| `Crear espacio` (texto del botón Guardar del modal) | `lib/almacenamientoBoard.ts:1328` (`#editarSaveText`) | contenedor vía modal POST |
| `➕ Crear mueble aquí` | `lib/visorHabitacionHtml.ts:89` | mueble en celda vacía (abre el modal) |
| `➕ Crear mueble aquí` | `lib/visorContenedorGrandeVacio.ts` (doc `:7,29`) | mueble raíz en habitación vacía |
| `➕ Estante` / `➕ Habitación` / `➕ Espacio` | `visorContenedorGrandeHtml.ts:190`, `mapaCasita/renderCasita.ts:110`, `visorHabitacion.ts:270` | estante / habitación / espacio |

**Conclusión:** renombrar a "Crear Caja" **es trabajo por hacer**, y es
**imprescindible acordar cuál de los 7 botones** es el que debe pasar a llamarse
"Crear Caja" (el más probable por semántica de "caja" es el de creación de
contenedor del modal — hoy `Crear espacio` — o el `➕ Crear mueble aquí` de celda
vacía). Sin esa definición, cualquier cambio es un riesgo de romper flujo.

### 4.3 Interfaz del «Espacio Único» y canasta de bultos

**Estado: IMPLEMENTADA en código** (evidencia de archivos y líneas; **NO verificada
en producción** porque no hubo deploy en esta sesión).

| Pieza | Archivo | Detalle verificado |
| --- | --- | --- |
| Checkbox canónico «Espacio Único» | `frontend/src/lib/espacioUnico.ts` | `ETIQUETA_ESPACIO_UNICO='Espacio Único'` (`:17`), `checkboxEspacioUnicoHtml()` (`:38-47`), `leerEspacioUnico()` (`:50-53`), leyenda `GUIA_ESPACIO_UNICO` (`:59-61`) |
| Disyuntor de movilidad debajo del anterior | `frontend/src/lib/muebleMovil.ts` | `lineaMuebleMovilHtml()` (`:62-68`) SIEMPRE bajo «Espacio Único»; sólo aplica a `Contenedor` |
| Bloque monolítico + zona de drop | `frontend/src/lib/mapa/portales/grillaObjetosDirectos.ts:24-50` | bloque entero con `data-portal-objetos-drop` + `data-drop-destino` (Lote 29); drop con guarda `defaultPrevented` anti-burbujeo (`:106-140`) |
| Ley 4: la canasta NO se apaga en Espacio Único | `frontend/src/lib/mapa/portales/portalesAlmacenamiento.ts:191-203` | comentario *"LEY 4 · LA CANASTA NUNCA SE APAGA EN EL ESPACIO ÚNICO (Lote 29)"* + `if (paneles.derecho === 'grillaObjetos') refrescarBandeja();` |
| Canasta de bultos (4 grupos en cascada) | `frontend/src/lib/bandejaSinUbicar.ts:135-160` | `1 · Objetos sueltos`, `2 · Cajas sueltas`, `3 · Objetos a reubicar`, `4 · Cajas a reubicar`; drag & drop bidireccional (`:206-235`) |
| Consulta + purga estructural de la canasta | `frontend/src/lib/bandejaSinUbicarDatos.ts` | normaliza `declarado_movible === true` (`:81`) y purga arquitectura |
| Autoridad ORM del canal «Espacio Único» | `inventario/api/viewsets/organizacion/filtros_bandeja.py:52-58` | `Q(parent_contenedor__espacio_unico=True) | Q(ubicacion__espacio_unico=True)` |
| Regla backend: sin «En Tránsito» en monolítico | `inventario/services/transito_interno.py:33-42` | si `espacio_unico` → `tiene_divisiones_internas()` devuelve `False` |

Soporte visual: `frontend/src/styles/planta-unica.css` (463 líneas) incluye el bloque
`MUEBLE MÓVIL DECLARADO (Lote 25)` (`:363-366`) y las clases del perímetro elástico.

**Conclusión:** este punto **ya está programado** en el código (incluido el fix del
commit `3fc7a73`: *"forzar visibilidad de la canasta en Espacio Único, inyectar zona
de drop monolítica con control de burbujeo y limpiar CSS muerto"*). Falta únicamente
validación visual en producción.

### 4.4 Checkboxes de alta rápida para convertir objeto en caja/mueble

**Estado: NO IMPLEMENTADO.** Se enumeraron **todos** los `type="checkbox"` del
frontend (grep sobre `lib/`, `pages/`, `components/`):

| Checkbox existente | Archivo:línea | Aplica a |
| --- | --- | --- |
| «Espacio Único» | `lib/espacioUnico.ts:43` | Contenedor/Ubicación |
| «🎒 Declarar como Mueble Móvil / Objeto» | `lib/muebleMovil.ts:51` | **sólo `Contenedor`** (nota `:12`: *"el modelo Ubicacion no tiene `declarado_movible`"*) |
| Fusión de siluetas | `lib/mapaPlantaUnica.ts:271,305` | Contenedores del lienzo |
| Filtros de mudanza / «Solo cajas» | `lib/mudanzaFiltros.ts:80,118` | filtros de vista |
| Selección de mudanza masiva | `lib/mudanzaMasiva.ts:59` | selección de stock |
| «Mueble Inmueble» (modal editar) | `pages/almacenamiento.astro:276` | Contenedor |
| God Mode (activo / superuser) | `pages/index.astro:386,390,481,485` | usuarios |
| Invitación (es usuario / enviar email) | `lib/invitacionModal.ts:133,150` | invitación |

**No existe ningún control sobre un `Objeto` para "ascenderlo" a `Caja`/`Mueble`.**
La única conversión implementada en el backend es en sentido inverso y automática:
`Contenedor` → `Objeto` **espejo** (dualidad) al crear un mueble/caja raíz mudable
(`inventario/api/viewsets/organizacion/helpers_organizacion.py:74-80`), y el
serializer **rechaza explícitamente** el camino inverso con HTTP 400
(`inventario/api/serializers/organizacion.py:216-222`: *"una caja movil (tipo='CAJA')
no puede convertirse en mueble inmueble… Cree un mueble nuevo si necesita un espacio
fijo del plano"*).

**Conclusión:** los "checkboxes de alta rápida para convertir objeto en
caja/mueble" **no existen en el código**; hay que diseñarlos (UI en el listado de
objetos o en la ficha del objeto) **y** crear el endpoint/regla de negocio que
transforme un `Objeto` en `Contenedor` (hoy prohibido por la taxonomía: es anclaje
de física, no un simple flag).

---

## 5. Deuda técnica detectada, higiene y límites de esta auditoría

### 5.1 Auditoría de modularidad (regla "< 400-500 líneas")

Ejecutado: conteo real de líneas de todo `frontend/src` y de todo `inventario/`
(excluyendo `__pycache__` y `migrations`).

**Frontend — archivos que EXCEDEN el límite:**

| Líneas | Archivo | Tipo |
| --- | --- | --- |
| 1664 | `frontend/src/lib/almacenamientoBoard.ts` | motor JS (deuda alta) |
| 1215 | `frontend/src/styles/mapa-espacial.css` | CSS |
| 1080 | `frontend/src/layouts/BaseLayout.astro` | layout + nav + scripts |
| 1037 | `frontend/src/pages/index.astro` | página |
| 954 | `frontend/src/lib/visorContenedorGrande.ts` | motor JS |
| 794 | `frontend/src/lib/visorHabitacion.ts` | motor JS |
| 670 | `frontend/src/components/ImageEditor.astro` | componente |
| 666 | `frontend/src/pages/objetos/[id]/index.astro` | página |
| 596 | `frontend/src/lib/godMode.ts` | JS |
| 574 | `frontend/src/styles/almacenamiento-escenas.css` | CSS |
| 501 | `frontend/src/components/ChatModal.astro` | componente |
| 463 / 419 | `styles/planta-unica.css` / `styles/mapa-casita.css` | CSS |
| 406 | `frontend/src/lib/rutaCajaMinimapas.ts` | JS |

**Backend — archivos que EXCEDEN el límite:**

| Líneas | Archivo |
| --- | --- |
| 734 | `inventario/services/ai_vision_service.py` |
| 459 | `inventario/models/productos.py` |
| 428 | `inventario/api/viewsets/objetos/utils_actions.py` |

**Lo que SÍ cumple la disciplina:** toda la lógica del Lote 29/30 (Espacio Único,
canasta, stock mudable, espejo, tránsito) está partida en módulos pequeños y con
**fuente única** (`espacioUnico.ts` 62 líneas, `muebleMovil.ts` 69,
`stock_mudable.py` 80, `espejo_contenedor.py` 70). ✅

### 5.2 Otros hallazgos técnicos (con evidencia)

1. **`BLACKLIST_AFTER_ROTATION` sin efecto** — falta
   `rest_framework_simplejwt.token_blacklist` en `INSTALLED_APPS`
   (`config/settings.py:80-91` vs `:186-189`). Los refresh tokens rotados no se
   invalidan.
2. ~~`/api/version/` podría requerir auth~~ **Corregido tras verificación:**
   `VersionViewSet` declara `permission_classes = [permissions.AllowAny]`
   (`inventario/api/viewsets/version.py:23`) → el endpoint es público, correcto para
   el banner de redeploy (`frontend/src/layouts/BaseLayout.astro:1124-1148` llama
   `fetchVersion(true)` de `services/auth/index.ts:85-88` → `GET /api/version/`).
   **No hay hallazgo aquí.** (Se deja registrado el descarte explícito para que no
   se vuelva a reportar como bug.)
3. **`config/urls.py:61-68`** sirve el fallback SPA leyendo `settings.STATIC_ROOT`;
   si `staticfiles/` no se recolectó en la imagen, la regla cae en 404 sin error
   explícito (**no verificado en runtime**).
4. **`db.sqlite3` (249 KB) en la raíz** — artefacto histórico ignorado por git;
   conviene borrarlo para evitar confusión con la BD real.
5. **CORS abierto por defecto** (`CORS_ALLOW_ALL_ORIGINS=True`): coincide con la
   decisión documentada en `config/settings.py:44-51`, pero es una superficie a
   revisar antes de exponer la API a terceros.
6. **`entrypoint.sh` ejecuta 4 comandos de datos en cada arranque**
   (`migrate`, `forzar_usuario_ygumy`, `seed_data`, `cargar_categorias_meli`): el
   quinto es **destructivo** sobre categorías ML; cualquier redeploy lo re-ejecuta
   (comportamiento intencional documentado, pero de alto impacto).

### 5.3 Higiene del repositorio

Ejecutado `git status --porcelain`:

```
M "s -ExecutionPolicy RemoteSigned) ; (& c\357\200\272UsersUSERDesktopEstok_2.venvScriptsActivate.ps1)"
```

- Hay **1 archivo rastreado con nombre corrupto** (producto de un pegado de comando
  de PowerShell en la terminal) que figura como **modificado en el working tree**:
  `s -ExecutionPolicy RemoteSigned) ; (& c…UsersUSERDesktopEstok_2.venvScriptsActivate.ps1)`
  (1.692 B, confirmado también en `git ls-files`). **Recomendación:** eliminarlo del
  índice y del disco (`git rm`) en una sesión de limpieza — no se eliminó en esta
  auditoría porque **no se pidió** modificar archivos (regla "no tocar lo que no te
  pidieron").
- No se detectaron archivos `tmp_*`, `.bat`, `.php` ni `.log` en la raíz.
- `.gitignore` cubre correctamente `db.sqlite3`, `media/`, `staticfiles/`, `.env`,
  `.venv/`, `node_modules/`, `frontend/dist/` y `tmp_*`.
- `.env.example` está versionado y **no contiene secretos reales** (placeholders).

### 5.4 Estado de verificación (honestidad de alcance)

| Afirmación | Estado |
| --- | --- |
| El código backend carga sin errores de import/sintaxis (`manage.py check`) | ✅ **VERIFICADO** (output real, 0 issues) |
| Motor PostgreSQL + variables `DB_*` + ausencia de `DATABASE_URL`/SQLite | ✅ **VERIFICADO** (grep + lectura de archivos) |
| Stack Astro 6 SSR + adapter Node + Tailwind 4 + DRF/SimpleJWT | ✅ **VERIFICADO** (package.json, astro.config, requirements) |
| Estructura de contenedor único (Dockerfile/Nginx/entrypoint/compose) | ✅ **VERIFICADO** (lectura de los 4 archivos) |
| Jerarquía de entidades y ubicación de las reglas de stock/mudanza | ✅ **VERIFICADO** (modelos + servicios + filtros ORM) |
| Lote 31 · punto 3 (Espacio Único + canasta) programado | ✅ **VERIFICADO en código**; ❌ **NO VERIFICADO en producción** |
| Lote 31 · puntos 1, 2 y 4 | ✅ **VERIFICADO que NO están implementados** (grep + lectura) |
| Funcionamiento real del sitio `https://eeestok.duckdns.org` | ❌ **NO VERIFICADO** (no se hizo request) |
| Estado del contenedor en Hetzner / labels de Traefik | ❌ **NO VERIFICADO** (no hubo SSH) |
| Build de Astro (`npm run build`) | ❌ **NO EJECUTADO** |

### 5.5 Próximos pasos sugeridos (ordenados por dependencia)

1. **Definir funcionalmente** el punto 1 (criterio de reordenamiento de tarjetas) y
   el punto 2 (**cuál** botón pasa a "Crear Caja") — sin esto, cualquier
   implementación es adivinanza.
2. Definir el modelo de datos del punto 4 (¿un `Objeto` se "promueve" a `Contenedor`
   conservando su historial/fotos? ¿se crea un `Contenedor` y se mueve el stock?).
   Ojo: `serializers/organizacion.py:216-222` hoy **bloquea** ese camino a propósito.
3. Validar el punto 3 (ya programado) en producción con una prueba real de arrastre
   de un bulto de la canasta hacia el bloque monolítico del Espacio Único.
4. Deuda de bajo riesgo y alto valor: instalar `token_blacklist` o desactivar
   `BLACKLIST_AFTER_ROTATION`; borrar `db.sqlite3` y el archivo de nombre corrupto;
   planificar el troceo de `almacenamientoBoard.ts` (1664 líneas) y `index.astro` (1037).
5. El despliegue lo dispara el usuario desde la UI de Coolify (regla del proyecto);
   este documento corresponde al commit `a7caf43` y **no está desplegado** todavía.

---

**Fin del informe.** Toda afirmación sin cita de archivo/línea u output de comando
debe considerarse no verificada y volver a comprobarse antes de usarse como verdad.








