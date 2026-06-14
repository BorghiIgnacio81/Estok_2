# 🚀 Estok - Sistema de Inventario Inteligente

## 📊 Estado Actual: ~90% del Core Operativo

---

## ✅ LO COMPLETADO (Triángulo de Valor)

### 1. 📸 Captura (Frontend Mobile-First)
- [x] **Página `/objetos/nuevo`**: Formulario completo con captura de foto (cámara + galería)
- [x] **Input `capture="environment"`**: Prioriza cámara trasera en dispositivos móviles
- [x] **Preview en tiempo real**: Muestra la foto antes de enviar
- [x] **Sección IA contextual**: Solo aparece cuando hay foto Y LM Studio conectado
- [x] **Carga de ubicaciones/contenedores/usuarios**: Selectores poblados dinámicamente
- [x] **Validación de legado**: Dueño original y beneficiario obligatorios
- [x] **Subida de foto post-creación**: Envío multipart/form-data con verificación de integridad en disco

### 2. 🧠 IA (LM Studio + Qwen2-VL-7B)
- [x] **`AIVisionService`**: Servicio completo de visión por IA local
- [x] **Detección de patrones**: Formas rectangulares → libro, brillos metálicos → mueble/arte
- [x] **Timeout dinámico**: 120s normal, 180s para imágenes de alta resolución (>4K)
- [x] **Campos pendientes**: Determina qué campos requieren input manual del usuario
- [x] **Creación automática de objetos**: Desde análisis de imagen Base64
- [x] **Historial de precios**: Registro automático de valoración inicial por IA
- [x] **AI Heartbeat**: Verificación periódica de disponibilidad de LM Studio
- [x] **Badge de estado IA**: Indicador visual en Dashboard y formulario
- [x] **Test de estrés**: Endpoint `GET /api/objetos/test_ia_stress/` para diagnóstico

### 3. 📦 Registro (Backend + API)
- [x] **Modelo `Objeto`**: Herencia multi-tabla (LibroRevista, Tecnologia, MuebleArte, Ropa)
- [x] **Soft Delete**: `deleted_at` en lugar de borrado físico
- [x] **`FotoObjeto`**: Múltiples fotos por objeto, una principal
- [x] **`HistorialPrecio`**: Trazabilidad completa de cambios de valor
- [x] **`AlertaStock`**: Alertas de reposición con niveles mínimos
- [x] **API REST completa**: CRUD + filtros (tipo, ubicación, estado, búsqueda)
- [x] **Exportación CSV**: Inventario completo descargable
- [x] **Estadísticas**: Endpoint con KPIs, distribución, valor por tipo
- [x] **Roles y permisos**: Sistema de roles con permisos CRUD granulares

### 4. 🏠 Dashboard Pro
- [x] **KPIs en tiempo real**: Total objetos, valor total, valor promedio, ubicaciones
- [x] **Chart.js**: Gráfico de torta (distribución por categoría) + barras (valor por categoría)
- [x] **Valor de mercado real**: `valor_por_tipo` suma `valor_estimado` de cada categoría
- [x] **Barras de progreso**: Estado de conservación con porcentajes
- [x] **Últimos objetos**: Lista con valores y enlaces
- [x] **Cards de categorías**: Contadores por tipo
- [x] **AI Heartbeat**: Badge de estado de IA
- [x] **PWA Install**: Botón de instalación de app

### 5. 📱 PWA (Progressive Web App)
- [x] **`manifest.json`**: Iconos, tema, nombre, display standalone
- [x] **`sw.js`**: Service Worker con caché de assets estáticos
- [x] **Registro en `BaseLayout.astro`**: Detección de soporte y registro automático
- [x] **Botón de instalación**: En Dashboard con evento `beforeinstallprompt`
- [x] **Estados**: `estok-pwa-ready` y `estok-pwa-installed` para UI reactiva

### 6. 🔐 Autenticación
- [x] **Login/Register**: Páginas con JWT (access + refresh)
- [x] **`AuthGuard.astro`**: Componente de protección de rutas
- [x] **Token management**: `localStorage` con renovación automática
- [x] **Redirección**: 401 → `/login` en todas las páginas protegidas

### 7. 📋 Escáner QR
- [x] **Página `/escanear`**: Cámara en vivo con marco de escaneo
- [x] **jsQR**: Decodificación de QR desde el navegador
- [x] **Pre-carga de contenedores**: Caché para redirección instantánea
- [x] **Redirección instantánea**: Sin `setTimeout` cuando está en caché
- [x] **Fallback**: Endpoint `escanear/` para QR no identificados
- [x] **Timeouts**: AbortController con 3s para verificación, 5s para escaneo

### 8. 🗺️ Organización Espacial
- [x] **Ubicaciones**: CRUD completo
- [x] **Contenedores**: CRUD con filtro por ubicación
- [x] **QR por contenedor**: Generación y regeneración de códigos QR
- [x] **Páginas de detalle**: `/contenedores/[id]`, `/ubicaciones/[id]`

### 9. 📄 Páginas de Listado
- [x] **`/objetos`**: Lista con filtros y búsqueda
- [x] **`/contenedores`**: Grid de contenedores
- [x] **`/ubicaciones`**: Grid de ubicaciones
- [x] **Detalle de objeto**: `/objetos/[id]` con fotos, historial, acciones

### 10. 🧪 Servicios Auxiliares
- [x] **`MarketingService`**: Generación de copys para Facebook, Instagram, MercadoLibre
- [x] **`StockValuationService`**: Valoración, plusvalía, alertas de stock
- [x] **`QRService`**: Generación y decodificación de QR
- [x] **Seed data**: Comando `seed_data.py` para datos de prueba

---

## ❌ LO QUE FALTA (Priorizado)

### 🔴 CRÍTICO (Para sesión actual)

- [ ] **Validación de foto en móvil**: Asegurar que `capture="environment"` funciona correctamente en iOS Safari y Android Chrome
- [ ] **Test de estrés IA en RX 9060 XT**: Ejecutar `GET /api/objetos/test_ia_stress/` en el hardware real y verificar latencia
- [ ] **Verificación de integridad de fotos**: Probar que `subir_foto` guarda correctamente en disco con multipart/form-data
- [ ] **Prueba de escáner QR en móvil**: Escanear QR de un contenedor real y verificar redirección instantánea
- [ ] **Dashboard con datos reales**: Verificar que `valor_por_tipo` refleje valores correctos

### 🟡 ALTA PRIORIDAD

- [ ] **Modo offline**: Cachear formulario de nuevo objeto para funcionar sin conexión
- [ ] **Sincronización**: Cola de objetos pendientes de subir cuando se recupere la conexión
- [ ] **Compresión de imágenes**: Reducir tamaño antes de enviar a IA (ahora se envía Base64 completo)
- [ ] **Notificaciones push**: Alertar cuando un objeto necesita reposición de stock
- [ ] **Búsqueda por QR en lista de objetos**: Escanear QR para filtrar objetos

### 🟢 MEDIA PRIORIDAD

- [ ] **Tema oscuro**: Modo dark para toda la app
- [ ] **Internacionalización**: Soporte multi-idioma (ES/EN)
- [ ] **Estadísticas avanzadas**: Gráfico de evolución de valor en el tiempo
- [ ] **Comparación de objetos**: Seleccionar múltiples objetos y comparar valores
- [ ] **Importación desde CSV**: Subir inventario desde archivo
- [ ] **Auditoría completa**: Log de todas las acciones de usuarios
- [ ] **Backup automático**: Exportación programada del inventario

### 🔵 BAJA PRIORIDAD (Futuras iteraciones)

- [ ] **Realidad aumentada**: Ver objetos en su ubicación real con AR
- [ ] **Reconocimiento de voz**: Agregar objetos por comando de voz
- [ ] **Integración con MercadoLibre API**: Publicar objetos directamente
- [ ] **App nativa**: Versión React Native o Flutter
- [ ] **Blockchain**: Certificación de autenticidad de objetos valiosos
- [ ] **Multi-tenant**: Soporte para múltiples familias/organizaciones

---

## 📈 KPIs del Proyecto

| Métrica | Valor |
|---------|-------|
| **Backend** | Django REST Framework + SQLite |
| **Frontend** | Astro + TypeScript + Tailwind |
| **IA Local** | LM Studio + Qwen2-VL-7B (RX 9060 XT) |
| **PWA** | Service Worker + Manifest |
| **API Endpoints** | 30+ (CRUD + acciones especializadas) |
| **Modelos** | 12 (incluyendo herencia multi-tabla) |
| **Páginas Frontend** | 15+ (dashboard, listas, detalle, formularios) |
| **Servicios** | 4 (IA Visión, QR, Marketing, Stock) |
| **Completitud Core** | ~90% |

---

## 🎯 Próximo Hito: Validación en Hardware Real

1. Probar captura de foto en iPhone/Android
2. Ejecutar test de estrés de IA
3. Verificar integridad de subida de fotos
4. Probar escáner QR con contenedor real
5. Confirmar KPIs del Dashboard con datos cargados
