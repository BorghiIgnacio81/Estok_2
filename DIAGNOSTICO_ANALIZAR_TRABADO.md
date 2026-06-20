# Diagnóstico: "Analizando..." se traba sin error

## Síntoma
En móvil (y posiblemente en PC), al hacer click en "Analizar con IA", la barra de progreso llega a ~90% y se queda ahí para siempre. No hay error en consola, no hay timeout visible, simplemente nunca termina.

---

## Punto A: Código del botón "Analizar con IA"

**Archivo:** `frontend/src/pages/objetos/nuevo.astro`, líneas 706-887

Flujo:
1. Click en `analizarIaBtn` (línea 706)
2. Muestra barra de progreso con `setInterval` que simula progreso hasta 90% (líneas 725-739)
3. Hace `fetch` a `${API_URL}/objetos/analizar_imagen/` con POST (línea 743)
4. Cuando el fetch termina, limpia el intervalo y muestra resultado

---

## Punto B: ¿Tiene timeout del frontend? → **NO**

```javascript
// Línea 743 - NO tiene AbortController, NO tiene signal, NO tiene timeout
const response = await fetch(`${API_URL}/objetos/analizar_imagen/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ imagen_base64: base64Image, solo_analisis: true }),
});
```

**No hay `AbortController` ni `signal`.** El navegador esperará indefinidamente.

**Contraste:** el heartbeat de IA en la misma página (línea 363) **SÍ tiene** `AbortController` con timeout de 5s. Pero el fetch real de análisis no.

**Esto explica perfectamente el síntoma:** la barra de progreso se queda en 90% (porque el setInterval simula hasta 90%) y nunca avanza, sin error en consola. El navegador simplemente espera la respuesta del servidor que nunca llega (o tarda demasiado).

---

## Punto C: Endpoint del backend y sus timeouts

**Endpoint:** `ObjetoViewSet.analizar_imagen()` en `inventario/api/viewsets/objetos.py` (líneas 181-286)

**Timeouts del backend hacia LM Studio:**

| Variable | Valor default | Dónde se usa |
|----------|--------------|-------------|
| `AI_API_TIMEOUT` | 120s | `LMStudioClient.__init__` timeout general |
| `AI_HIGH_RES_TIMEOUT` | 180s | Timeout si detecta imagen >5MB estimado |

**Problema:** Si LM Studio tarda más de 120s (GPU ocupada, imagen grande, modelo cargando), el backend lanza timeout. Pero como el frontend no tiene AbortController, el navegador nunca se entera del error y sigue esperando.

---

## Punto D: Timeout de Nginx

```nginx
# nginx-combined.conf, location /api/
proxy_read_timeout 180s;   # ← 180 segundos
proxy_connect_timeout 30s;
```

**Nginx NO es el problema** — su timeout (180s) es mayor que los timeouts del backend.

**Pero Gunicorn SÍ es un problema:**

```bash
# entrypoint.sh línea 17
gunicorn config.wsgi:application --bind 0.0.0.0:8001 --workers 4 --timeout 120
```

**Gunicorn timeout = 120s.** Si la IA tarda más de 120s, Gunicorn mata el worker silenciosamente. Django nunca responde. El frontend se queda esperando para siempre.

**Cadena de timeouts:**
```
Frontend (sin timeout) ← Nginx (180s) ← Gunicorn (120s) ← Backend/Django (120-180s) ← LM Studio (variable)
```

El eslabón más débil es **Gunicorn con 120s**. Si LM Studio tarda 130s, Gunicorn mata el worker a los 120s, y el frontend nunca recibe respuesta.

---

## Punto E: Pérdida de foto al refrescar → **CONFIRMADO**

La foto se guarda **SOLO** en:
- `imagenBase64.value` (un `<input type="hidden">`, línea 101 del HTML)
- `photoImage.src` (un `<img>`, línea 71 del HTML)

**No hay `sessionStorage`, no hay `localStorage`.** Si el usuario refresca la página (F5):
- `imagenBase64.value` → vacío
- `photoImage.src` → vacío
- Todos los campos autocompletados por IA → perdidos

---

## Resumen de causas raíz

| # | Problema | Causa | Severidad |
|---|----------|-------|-----------|
| 1 | "Analizando..." se traba sin error | **Frontend sin AbortController/timeout** en el fetch de `analizar_imagen` | 🔴 **ALTA** |
| 2 | Timeout inconsistente | Gunicorn timeout (120s) puede ser menor que lo que tarda LM Studio | 🟡 **MEDIA** |
| 3 | Foto perdida al refrescar | Solo en memoria (hidden input + img src), sin `sessionStorage` | 🟡 **MEDIA** |
| 4 | Barra de progreso engañosa | El `setInterval` simula hasta 90% aunque el fetch no haya respondido | 🟢 **BAJA** |

---

## Soluciones propuestas

### 1. (ALTA) Agregar AbortController al fetch de analizar_imagen
En `nuevo.astro`, alrededor de la línea 743, cambiar:
```javascript
// ANTES (sin timeout):
const response = await fetch(`${API_URL}/objetos/analizar_imagen/`, { ... });

// DESPUÉS (con timeout de 200s):
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 200000); // 200s
try {
  const response = await fetch(`${API_URL}/objetos/analizar_imagen/`, {
    ...,
    signal: controller.signal,
  });
  clearTimeout(timeoutId);
  // ... resto del código
} catch (err) {
  clearTimeout(timeoutId);
  if (err.name === 'AbortError') {
    throw new Error('La IA está tardando demasiado. Intenta con una imagen más pequeña o verifica que LM Studio esté funcionando.');
  }
  throw err;
}
```

### 2. (MEDIA) Aumentar Gunicorn timeout a 240s
En `entrypoint.sh`, cambiar:
```bash
gunicorn config.wsgi:application --bind 0.0.0.0:8001 --workers 4 --timeout 240
```

### 3. (MEDIA) Persistir foto en sessionStorage
En `nuevo.astro`, en `handleFileSelected`, agregar:
```javascript
sessionStorage.setItem('nuevo_objeto_foto', result);
```
Y al cargar la página, restaurar desde sessionStorage.

### 4. (BAJA) Mejorar la barra de progreso
No simular progreso. Usar un spinner indeterminado o mostrar "Tiempo transcurrido: Xs" en lugar de una barra que se traba en 90%.
