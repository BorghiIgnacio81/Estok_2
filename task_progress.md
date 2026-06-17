# Estok 2 - Estado del Proyecto

## 📋 Resumen General

**Estok** es un sistema de inventario familiar con planificación sucesoria, diseñado para gestionar objetos personales con valor sentimental o económico. La app permite catalogar objetos, asignar dueños originales y beneficiarios, escanear códigos QR, y usar IA local (LM Studio + Qwen2-VL-7B) para reconocimiento automático de objetos.

---

## ✅ LO QUE ESTÁ HECHO

### Backend (Django + DRF)

#### Modelos (`inventario/models.py`)
- ✅ **Role** - Roles con permisos booleanos (can_read, can_write, can_edit, can_delete)
- ✅ **CustomUser** - Usuario extendido con relación a Role
- ✅ **Ubicacion** - Lugares físicos (ej: "Casa", "Departamento")
- ✅ **Contenedor** - Cajas, muebles, etc. con QR code
- ✅ **Objeto** - Modelo principal con herencia multi-tabla:
  - Campos: nombre, descripción, tipo, estado_conservación, color, valor_estimado
  - Soft delete (deleted_at), estado_carga, campos_pendientes
  - Dueño original y beneficiario (para planificación sucesoria)
- ✅ **LibroRevista** - Autor, año, ISBN/ISSN, edición, serie, tomo, editorial, idioma
- ✅ **Tecnologia** - Marca, modelo, número de serie, peso
- ✅ **MuebleArte** - Material, artista/fabricante, dimensiones (largo, ancho, alto)
- ✅ **Ropa** - Talle/tamaño
- ✅ **FotoObjeto** - Múltiples fotos por objeto, es_principal
- ✅ **HistorialPrecio** - Trazabilidad de cambios de valor
- ✅ **AlertaStock** - Alertas de reposición

#### API REST (`inventario/api/`)
- ✅ **ViewSets completos** para todos los modelos
- ✅ **Permisos basados en roles** (HasRolePermission)
- ✅ **Filtros**: por tipo, ubicación, contenedor, estado, búsqueda textual
- ✅ **Endpoints especializados**:
  - `analizar_con_ia` - Analiza objeto existente con IA
  - `analizar_imagen` - Crea objeto desde imagen Base64 + IA
  - `generar_anuncios` - Copys para Facebook, Instagram, MercadoLibre
  - `publicar_en` / `estado_publicacion` - Gestión de publicaciones
  - `actualizar_precio` / `historial_precios` / `plusvalia` - Valoración
  - `crear_alerta_stock` - Alertas de inventario
  - `subir_foto` - Upload con verificación de integridad
  - `soft_delete` / `restaurar` - Eliminación lógica
  - `exportar_csv` - Exportación del inventario
  - `test_ia_stress` - Test de conectividad con LM Studio
  - `estadisticas` - Dashboard con valor_por_tipo para gráficos
- ✅ **Serializers** con validación y campos anidados

#### Servicios (`inventario/services/`)
- ✅ **AIVisionService** - Conexión con LM Studio local
  - Cliente OpenAI apuntando a http://localhost:1234/v1
  - Modelo: Qwen2-VL-7B
  - Timeout dinámico según resolución de imagen
  - Compresión de imágenes para GPU (Pillow, max 5MB para GPU)
  - Detección de campos pendientes por confianza
  - Creación automática de objetos desde visión
  - Registro en HistorialPrecio
- ✅ **QRService** - Generación y decodificación de QR
- ✅ **MarketingService** - Generación de copys publicitarios con IA
- ✅ **StockValuationService** - Valoración, plusvalía, alertas de stock

#### Management Commands
- ✅ `seed_data.py` - Datos de prueba
- ✅ `seed_ignacio.py` - Datos específicos
- ✅ `seed_ygumy.py` - Datos específicos

### Frontend (Astro + Tailwind CSS)

#### Páginas
- ✅ **Login** (`/login`) - Autenticación JWT
- ✅ **Register** (`/register`) - Registro de usuarios
- ✅ **Dashboard** (`/`) - Estadísticas, gráficos, últimos objetos
- ✅ **Objetos** (`/objetos`) - Listado con filtros y búsqueda
- ✅ **Objeto Detalle** (`/objetos/[id]`) - Vista completa con fotos, QR, historial
- ✅ **Objeto Editar** (`/objetos/[id]/editar`) - Edición de objeto
- ✅ **Objeto Nuevo** (`/objetos/nuevo`) - **Carga manual completa**:
  - Captura de foto (cámara + galería)
  - Editor de imagen (rotar, recortar, brillo)
  - Botón "Autocompletar con IA" (después de guardar)
  - Campos por categoría (libro, tecnología, mueble, ropa)
  - Estimación de precio basada en objetos similares
  - Dueño original y beneficiario
  - Heartbeat de IA (verifica LM Studio cada 30s)
- ✅ **Ubicaciones** (`/ubicaciones`) - CRUD de ubicaciones
- ✅ **Ubicación Detalle** (`/ubicaciones/[id]`) - Objetos en ubicación
- ✅ **Contenedores** (`/contenedores`) - CRUD con QR
- ✅ **Contenedor Detalle** (`/contenedores/[id]`) - Objetos en contenedor
- ✅ **Escanear QR** (`/escanear`) - Escaneo con cámara

#### Componentes
- ✅ **BaseLayout** - Layout principal con navegación responsive
- ✅ **AuthLayout** - Layout para login/register
- ✅ **AuthGuard** - Protección de rutas
- ✅ **Card** - Componente de tarjeta para objetos
- ✅ **Toast** - Notificaciones toast
- ✅ **CategoryFields** - Campos dinámicos por categoría
- ✅ **ImageEditor** - Editor de imagen (modal con cropper, rotación, brillo)

#### Servicios Frontend
- ✅ `api.ts` - Cliente HTTP con JWT
- ✅ `auth.ts` - Manejo de autenticación
- ✅ `aiHeartbeat.ts` - Heartbeat para verificar IA

### Infraestructura
- ✅ **Docker Compose** - Backend + Frontend + Nginx + PostgreSQL
- ✅ **Dockerfile.backend** - Python/Django
- ✅ **Dockerfile.frontend** - Node/Astro
- ✅ **nginx.conf** - Proxy inverso
- ✅ **PWA** - Service Worker + Manifest (instalable como app)

---

## ❌ LO QUE FALTA / PENDIENTE

### Funcionalidades Críticas
- [ ] **Escaneo QR desde la app móvil** - La página `/escanear` existe pero el flujo completo de escanear un QR de contenedor y listar sus objetos necesita pruebas en dispositivo real
- [ ] **Subida de foto desde el formulario de nuevo objeto** - El flujo Base64 -> Blob -> multipart upload necesita pruebas de integración
- [ ] **Autocompletar con IA** - El endpoint `analizar_con_ia` está implementado pero requiere LM Studio corriendo localmente con el modelo Qwen2-VL-7B cargado

### Mejoras Pendientes
- [ ] **Pruebas unitarias** - No hay tests escritos para los servicios ni endpoints
- [ ] **Manejo de errores en frontend** - Algunos catch blocks son genéricos, falta feedback visual más específico
- [ ] **Paginación en listados** - La página de objetos no tiene paginación visual (aunque la API sí la soporta)
- [ ] **Modo offline** - Aunque hay Service Worker, no hay estrategia de caché implementada
- [ ] **Internacionalización** - Todo está en español, no hay soporte multi-idioma
- [ ] **Notificaciones push** - El Service Worker está configurado pero no hay lógica de push

### Bugs Conocidos
- [ ] **TypeScript errors en frontend** - Archivos `.astro` tienen errores de tipo por uso de `document.getElementById` sin type assertions (no afectan runtime)
- [ ] **Doble llamado a openEditor** - En `nuevo.astro` se llama a `openEditor()` con setTimeout después de seleccionar foto, lo que puede causar que el editor se abra inesperadamente

### Deuda Técnica
- [ ] **Refactorizar payload del formulario** - El objeto `payload` en `nuevo.astro` se construye con asignaciones dinámicas que TypeScript no puede tipar correctamente
- [ ] **Centralizar configuración de IA** - Las URLs de LM Studio están hardcodeadas tanto en backend (settings) como en frontend (import.meta.env)
- [ ] **Migraciones pendientes** - Verificar que todas las migraciones estén al día

---

## 📊 Estado por Área

| Área | Estado | Notas |
|------|--------|-------|
| **Modelos** | ✅ 100% | Todos los modelos con herencia multi-tabla |
| **API REST** | ✅ 95% | Todos los endpoints CRUD + acciones especializadas |
| **Servicios** | ✅ 90% | IA, QR, Marketing, Stock - falta test coverage |
| **Frontend Páginas** | ✅ 85% | Faltan pulir detalles de UX/UI |
| **Frontend Componentes** | ✅ 80% | ImageEditor funcional, CategoryFields dinámico |
| **Autenticación** | ✅ 100% | JWT + Roles + Permisos |
| **IA Local** | ✅ 85% | Integración con LM Studio, compresión GPU, falta testing real |
| **QR** | ✅ 80% | Generación funciona, escaneo necesita pruebas |
| **Marketing** | ✅ 75% | Generación de copys, falta integración real con APIs |
| **Infraestructura** | ✅ 90% | Docker, Nginx, PWA configurados |
| **Tests** | ❌ 0% | No hay tests automatizados |
| **Documentación** | ⚠️ 50% | Este README + comentarios en código |

---

## 🚀 Próximos Pasos Recomendados

1. **Escribir tests** para servicios (especialmente AIVisionService y StockValuationService)
2. **Probar el flujo completo** de carga manual + foto + IA en dispositivo real
3. **Agregar paginación visual** en el listado de objetos
4. **Implementar modo offline** con estrategia de caché en Service Worker
5. **Corregir TypeScript errors** en archivos .astro
6. **Agregar documentación de API** con drf-spectacular o similar
