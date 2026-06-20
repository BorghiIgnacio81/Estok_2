# Resumen de Problemas - Últimos 3 Días (17-20 Junio 2026)

## Contexto del Proyecto
Estok es un sistema de inventario con Django backend + Astro frontend + PostgreSQL, desplegado en Coolify con Traefik como proxy inverso. Tiene integración con IA local (LM Studio + qwen2.5-vl-7b-instruct en GPU AMD Radeon RX 9060 XT 8GB VRAM) para catalogación automática de objetos.

---

## 🔴 PROBLEMA 1: INFRAESTRUCTURA / DESPLIEGUE EN COOLIFY
**Duración: 3 días completos (17-20 Junio)**
**Commits relacionados: ~40 commits de fix**

### Síntoma
La app no cargaba en producción. Errores 502, 503, conexiones fallando, assets rotos.

### Causa Raíz
**Arquitectura multi-contenedor vs. limitaciones de Coolify.** Originalmente teníamos 3 contenedores (backend, frontend, nginx) y Coolify no resolvía bien los DNS internos entre servicios. Pasamos por:

1. **3 contenedores separados** → DNS entre contenedores no funcionaba (backend no resolvía "frontend" o "nginx")
2. **Contenedor único (Dockerfile.combined)** → Solucionó DNS pero creó problemas de puertos
3. **Guerra de puertos** (19 commits solo de puertos):
   - Puerto 80 vs 8000 vs 4321 vs 8001
   - Traefik esperaba un puerto, Nginx escuchaba en otro
   - Coolify tiene `Exposed Ports: 8000` pero Traefik enrutaba a 80
   - Solución actual: variable `ESTOK_PORT` con default 8000, consistente en Dockerfile, nginx, docker-compose y labels de Traefik

4. **Astro 6.x cambió API**:
   - `output: 'hybrid'` fue eliminado en Astro 6.x → cambiamos a `output: 'server'`
   - Los assets estáticos ahora están en `dist/client/` no en `dist/`
   - Hubo que agregar `@astrojs/node` adapter con mode `standalone`

5. **Entrypoint frágil**:
   - Originalmente era `echo` inline en Dockerfile → errores de sintaxis bash
   - Se movió a `entrypoint.sh` separado
   - Problemas con permisos, rutas de Astro server entry

### Estado Actual
✅ Funcionando. Contenedor único con Nginx (puerto ESTOK_PORT) → Gunicorn (8001) + Astro (4321). Pero la solución es frágil.

---

## 🔴 PROBLEMA 2: IA - RECONOCIMIENTO DE OBJETOS (especialmente LIBROS)
**Duración: 3 días (17-20 Junio)**
**Commits relacionados: ~15 commits**

### Síntoma
La IA no reconocía bien los objetos, especialmente libros. Devolvía datos incompletos, inventaba información, o fallaba con timeout.

### Causa Raíz
**Límite de contexto de 4096 tokens del modelo qwen2.5-vl-7b-instruct.** Esto es MUY poco para visión + lenguaje. Causó una cascada de problemas:

1. **Imágenes demasiado grandes** → excedían el contexto de 4096 tokens
   - Solución: compresión agresiva (calidad 30%, resolución 640px)
   - Pero la compresión hace que la IA no pueda leer texto pequeño (ISBN, autores)

2. **Prompt demasiado largo** → competía con la imagen por los tokens
   - Solución: prompt reducido al mínimo, sin ejemplos, sin RAG extenso

3. **RAG (contexto de objetos similares)** → agregaba más tokens, empeoraba el problema
   - Se implementó pero a veces causaba que la IA ignorara la imagen actual

4. **Timeouts** → la GPU AMD tarda ~30-120s por imagen
   - Timeout original 120s, se extendió a 180s/240s para alta resolución

5. **Formato de respuesta** → el modelo NO soporta `response_format: json_object`
   - Solución: pedir JSON en el prompt + regex fallback para extraer JSON de texto libre

6. **Detección de libros**:
   - No lee bien ISBN de contrafrases (letra muy pequeña)
   - Se implementó "segunda foto para ISBN" pero es torpe
   - El prompt tiene reglas para libros pero el modelo las ignora frecuentemente

### Estado Actual
⚠️ Funciona a medias. Objetos genéricos los reconoce aceptablemente. Libros: reconoce título y autor si la portada tiene texto grande, pero ISBN, editorial, edición casi nunca los captura bien.

---

## 🔴 PROBLEMA 3: SERIALIZADORES - ERROR "UNEXPECTED TOKEN" AL CREAR OBJETOS
**Duración: 1 día (17 Junio)**
**Commits relacionados: 4 commits**

### Síntoma
Al guardar un objeto nuevo, el frontend recibía error "unexpected token" del backend.

### Causa Raíz
`ObjetoCreateSerializer` extendía de `Serializer` (no de `ModelSerializer`), lo que causaba que la respuesta de create no incluyera todos los campos esperados por el frontend. Se cambió a `ModelSerializer` y se agregó `write_only` para campos específicos.

### Estado Actual
✅ Resuelto.

---

## 🔴 PROBLEMA 4: TOKEN AUTH - MISMATCH ENTRE FRONTEND Y BACKEND
**Duración: 1 día (17 Junio)**
**Commits relacionados: 2 commits**

### Síntoma
El frontend enviaba tokens que el backend rechazaba (401 Unauthorized).

### Causa Raíz
El frontend usaba `token` como clave en localStorage pero el backend esperaba `access_token`. También había problemas de CORS en las verificaciones de IA.

### Estado Actual
✅ Resuelto.

---

## 🔴 PROBLEMA 5: IMAGE EDITOR - RECORTE DE FOTOS
**Duración: 1 día (17 Junio)**
**Commits relacionados: 2 commits**

### Síntoma
El editor de recorte de imágenes no funcionaba correctamente (no se podía seleccionar área libre).

### Causa Raíz
El ImageEditor.astro tenía bugs en la lógica de Canvas para el recorte libre. Se reescribió parcialmente.

### Estado Actual
✅ Resuelto (recorte libre funcional con handles y drag).

---

## 🔴 PROBLEMA 6: OBJETOS HUÉRFANOS (SIN MODELO HIJO)
**Duración: 1 día (17 Junio)**
**Commits relacionados: 4 commits**

### Síntoma
Objetos creados sin modelo hijo (LibroRevista, Tecnologia, etc.) causaban errores al intentar acceder a sus campos específicos.

### Causa Raíz
El modelo usa herencia multi-tabla (Objeto → LibroRevista/Tecnologia/etc.) y a veces los objetos se creaban sin el registro hijo correspondiente.

### Solución
Script `reparar_objetos.py` que detecta y repara objetos huérfanos insertando registros hijo con `ON CONFLICT DO NOTHING`.

### Estado Actual
✅ Resuelto (pero la causa raíz persiste: el serializador debería garantizar la creación del hijo).

---

## 🔴 PROBLEMA 7: MERCADOLIBRE - BÚSQUEDA DE PRECIOS DE REFERENCIA
**Duración: 1 día (17 Junio)**
**Commits relacionados: 2 commits**

### Síntoma
El botón "Buscar precio de referencia" no funcionaba en la página de editar objeto.

### Causa Raíz
El botón era un anchor `<a>` con href en vez de un `<button>` con event listener JavaScript. La navegación de tarjetas también usaba `onclick` inline que interfería.

### Estado Actual
✅ Resuelto.

---

## 📊 ESTADO ACTUAL DEL SISTEMA

| Componente | Estado | Notas |
|-----------|--------|-------|
| Despliegue Coolify | ✅ Funciona | Contenedor único, puerto 8000 |
| Frontend Astro | ✅ Funciona | Server mode, SSR |
| Backend Django | ✅ Funciona | Gunicorn en 8001 |
| Nginx | ✅ Funciona | Proxy a backend + frontend |
| IA - Objetos genéricos | ⚠️ Regular | Reconoce bien objetos comunes |
| IA - Libros | ❌ Malo | No lee ISBN, editorial, edición |
| IA - Conexión LM Studio | ✅ Funciona | Timeout 180s, compresión 30% |
| Image Editor | ✅ Funciona | Recorte libre con handles |
| Serializadores | ✅ Funciona | ModelSerializer ahora |
| Auth JWT | ✅ Funciona | Token key consistente |
| Precios MercadoLibre | ✅ Funciona | Botón en editar objeto |
| PWA | ⚠️ Regular | Service worker, manifest, banner actualización |

---

## 🎯 PROBLEMAS PENDIENTES (NO RESUELTOS)

1. **IA no reconoce bien libros** - El modelo qwen2.5-vl-7b-instruct tiene contexto muy limitado (4096 tokens). No puede procesar imágenes de calidad + prompt detallado. Soluciones posibles:
   - Cambiar a un modelo con más contexto (ej: llama-3.2-vision-11b, qwen2.5-vl-72b)
   - Usar OCR tradicional (Tesseract) para ISBN y texto, y IA solo para clasificación
   - Enviar la imagen en múltiples pasos (una para clasificación, otra para OCR)

2. **Arquitectura de contenedor único es frágil** - Si Astro SSR falla, Nginx hace fallback a estáticos pero no es ideal. Separar frontend/backend en Coolify con redes bien configuradas sería más robusto.

3. **Código muerto sin limpiar** - `views.py`, `tests.py`, `aiHeartbeat.ts`, `Card.astro` están sin usar.

4. **Viewsets de 1121 líneas** - Refactor pendiente (ya separado en módulos pero no probado en producción).

5. **No hay tests automatizados** - `tests.py` está vacío. Cualquier cambio puede romper algo sin que nos demos cuenta.

---

## 📝 LECCIÓN PRINCIPAL

El problema dominante estos 3 días fue **la infraestructura de despliegue**, no la lógica de negocio. ~40 commits de fix vs ~15 de features. La decisión de migrar a contenedor único resolvió los DNS pero creó una guerra de puertos que nos tuvo 2 días dando vueltas. La lección: **probar cambios de infraestructura en un entorno de staging antes de production**, y **documentar la configuración de puertos de Coolify** (Exposed Ports, Traefik, y puertos internos deben coincidir).
