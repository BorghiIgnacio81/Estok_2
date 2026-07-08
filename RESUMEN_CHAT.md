# RESUMEN: Chat interno entre usuarios de un Estok

## Objetivo
Agregar un botón amarillo en forma de sobre en la barra superior (entre el nombre de usuario y "Cerrar Sesión") que sirva como chat interno entre los miembros de cada Estok.

## Archivos creados hasta ahora

### Backend
1. **`inventario/api/viewsets/chat.py`** - ViewSet con endpoints:
   - `GET /api/chat/mensajes/?estok_id=X` - Obtener mensajes de un Estok
   - `POST /api/chat/mensajes/` - Enviar mensaje (body: `{estok_id, contenido}`)
   - Filtra: solo miembros del Estok pueden ver/enviar mensajes

2. **`inventario/services/chat.ts`** (frontend) - Servicio con funciones:
   - `getMensajesChat(estokId)` - fetch GET
   - `enviarMensajeChat(estokId, contenido)` - fetch POST

3. **`frontend/src/components/ChatModal.astro`** - Componente:
   - Botón flotante amarillo (sobre) en esquina inferior derecha
   - Ventana de chat con header amarillo, lista de mensajes, input
   - Badge de mensajes no leídos
   - Auto-scroll a nuevo mensaje
   - Polling cada 3 segundos

### Modificaciones
4. **`frontend/src/layouts/BaseLayout.astro`** - Se agregó:
   - Import de ChatModal
   - Inserción del componente ChatModal después del nav
   - Pasa `data-estok-id` y `data-estok-nombre` desde el HTML

5. **`frontend/src/pages/index.astro`** - Se agregó:
   - Atributos `data-estok-id` y `data-estok-nombre` en el body/main
   - Script para propagar estos datos al BaseLayout

6. **`inventario/api/urls.py`** - Se agregó ruta:
   - `chat/mensajes/` → ChatViewSet

## Estado actual
- ✅ Código backend y frontend completo
- ✅ Commit hecho (b5715f5)
- ✅ Force redeploy en Coolify (2 veces)
- ❌ El sitio sigue mostrando la versión anterior (sin el botón de chat)

## Problema detectado
El contenedor nuevo se crea correctamente con el código nuevo, pero **Traefik (el proxy) no actualiza su configuración** para enrutar el tráfico al nuevo contenedor. Al hacer `docker exec coolify-proxy kill -HUP 1`, Traefik recarga y empieza a funcionar, pero el usuario reporta que desde el teléfono sigue sin verse el botón.

## Lo que hay que verificar
1. Que el HTML servido desde `https://eeestok.duckdns.org/` contenga "sobre" o "chatToggleBtn"
2. Que el endpoint `POST /api/chat/mensajes/` funcione correctamente
3. Que el endpoint `GET /api/chat/mensajes/?estok_id=X` funcione correctamente
4. Que el usuario esté viendo la página correcta (puede ser caché del navegador/PWA)
