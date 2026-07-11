# Auditoría y Plan de Modularización - Estok Inventory System

## 1. AUDITORÍA DE CÓDIGO MUERTO Y PROBLEMAS

### Backend (Django)

#### ✅ Código activo y bien:
- `models.py` (594 líneas) - Modelos bien estructurados con herencia multi-tabla
- `api/viewsets/` (paquete) - ViewSets separados en módulos ✅
- `api/serializers/` (paquete) - Serializers separados en módulos ✅
- `api/urls.py` (42 líneas) - Rutas bien configuradas
- `services/ai_vision_service.py` (~900 líneas) - Servicio de IA completo
- `services/rag_service.py` (nuevo) - RAG extraído de ai_vision_service ✅
- `services/stock_service.py` (380 líneas) - Servicio de stock y valoración
- `services/marketing_service.py` (426 líneas) - Generación de anuncios
- `services/qr_service.py` (222 líneas) - Generación de QR

#### ⚠️ Problemas detectados:

1. ~~**`viewsets.py` (1121 líneas) - DEMASIADO GRANDE**~~ ✅ **RESUELTO** - Separado en `api/viewsets/` (7 módulos)

2. ~~**`serializers.py` (437 líneas) - Grande pero aceptable**~~ ✅ **RESUELTO** - Separado en `api/serializers/` (7 módulos)

3. **`models.py` (594 líneas) - Bien pero mejorable**
   - El `save()` de Contenedor importa QRService inline (acoplamiento)
   - Se podría separar en archivos por dominio

4. ~~**`ai_vision_service.py` (748 líneas) - Grande pero cohesivo**~~ ✅ **RESUELTO PARCIALMENTE**
   - RAG extraído a `rag_service.py` ✅
   - LMStudioClient y AIVisionService siguen en el mismo archivo (cohesivo)

5. **Código MUERTO confirmado:**
   - ~~`inventario/views.py`~~ ✅ **ELIMINADO**
   - ~~`inventario/tests.py`~~ ✅ **ELIMINADO**
   - ~~`frontend/src/services/aiHeartbeat.ts`~~ ✅ **ELIMINADO**
   - ~~`frontend/src/components/Card.astro`~~ ✅ **ELIMINADO**

6. **Código ACTIVO confirmado:**
   - `frontend/src/components/CategoryFields.astro` - Se importa y usa en `objetos/nuevo.astro`. **CONSERVAR.**
   - `frontend/src/components/ImageEditor.astro` - Se importa y usa en `objetos/nuevo.astro`. Editor de imagen completo con Canvas API (781 líneas). **CONSERVAR.**

### Frontend (Astro)

#### ⚠️ Problemas detectados:

1. **`index.astro` (626 líneas) - DEMASIADO GRANDE**
   - HTML + CSS + JS todo en un archivo
   - Lógica de PWA, Chart.js, AI Heartbeat, estadísticas TODO mezclado
   - El script tiene ~400 líneas de JS

2. **`objetos.astro` (405 líneas) - Grande**
   - Lógica de renderizado, filtros, búsqueda, export CSV todo junto

3. **`ubicaciones.astro` (356 líneas) - Grande**
   - CRUD completo inline con modal

4. **`contenedores.astro` (431 líneas) - Grande**
   - CRUD completo inline con modal

5. **Duplicación de código:**
   - `getToken()`, `getAuthHeaders()` repetido en CADA página
   - Lógica de Toast/notificaciones repetida
   - Manejo de estados (loading, error, empty) repetido

---

## 2. PLAN DE MODULARIZACIÓN

### FASE 1: Backend - Separar viewsets.py

**Crear:** `inventario/api/viewsets/` (directorio con módulos)

```
inventario/api/viewsets/
├── __init__.py          # Re-exporta todo
├── base.py              # HasRolePermission, mixins comunes
├── usuarios.py          # RoleViewSet, UserViewSet
├── organizacion.py      # UbicacionViewSet, ContenedorViewSet
├── objetos.py           # ObjetoViewSet (el más grande)
├── multimedia.py        # FotoObjetoViewSet
└── historial.py         # HistorialPrecioViewSet, AlertaStockViewSet
```

### FASE 2: Backend - Separar serializers.py

**Crear:** `inventario/api/serializers/` (directorio con módulos)

```
inventario/api/serializers/
├── __init__.py
├── usuarios.py          # RoleSerializer, UserSerializer, UserCreateSerializer
├── organizacion.py      # UbicacionSerializer, ContenedorSerializer
├── objetos.py           # ObjetoListSerializer, ObjetoDetailSerializer, ObjetoCreateSerializer
├── multimedia.py        # FotoObjetoSerializer, FotoObjetoUploadSerializer
└── historial.py         # HistorialPrecioSerializer, AlertaStockSerializer
```

### FASE 3: Backend - Separar services/

```
inventario/services/
├── __init__.py
├── ai_vision_service.py    # Ya existe - OK
├── marketing_service.py    # Ya existe - OK
├── stock_service.py        # Ya existe - OK
├── qr_service.py           # Ya existe - OK
└── (nuevo) rag_service.py  # Extraer lógica RAG de ai_vision_service.py
```

### FASE 4: Frontend - Crear hooks/utils compartidos

**Crear:** `frontend/src/lib/` (utilidades compartidas)

```
frontend/src/lib/
├── api.ts              # Funciones base getToken, getAuthHeaders, fetchWithAuth
├── toast.ts            # Sistema de notificaciones Toast
├── ui.ts               # Helpers de UI (loading, error, empty states)
└── constants.ts        # Constantes compartidas (colores, tipos, etc.)
```

### FASE 5: Frontend - Extraer componentes de las páginas

**Crear componentes:**

```
frontend/src/components/
├── AuthGuard.astro         # Ya existe
├── Toast.astro             # Ya existe
├── CategoryFields.astro    # Ya existe
├── ImageEditor.astro       # Ya existe
├── (nuevo) DashboardKPI.astro       # KPIs del dashboard
├── (nuevo) DashboardCharts.astro     # Gráficos Chart.js
├── (nuevo) ObjetoCard.astro          # Tarjeta de objeto reutilizable
├── (nuevo) UbicacionCard.astro       # Tarjeta de ubicación
├── (nuevo) ContenedorCard.astro      # Tarjeta de contenedor
├── (nuevo) CreateModal.astro         # Modal genérico de creación
├── (nuevo) SearchBar.astro           # Barra de búsqueda
├── (nuevo) FilterButtons.astro       # Botones de filtro
├── (nuevo) LoadingState.astro        # Estado de carga
├── (nuevo) EmptyState.astro          # Estado vacío
└── (nuevo) ErrorState.astro          # Estado de error
```

### FASE 6: Frontend - Refactorizar páginas

Cada página debe quedar así:
```astro
---
// Solo imports y props
import Componentes...
---
<!-- HTML mínimo con componentes -->
<Componente />
<OtroComponente />

<script>
  // Solo lógica específica de la página
  import { api } from '../lib/api';
  // ... lógica mínima
</script>
```

---

## 3. ORDEN DE EJECUCIÓN (ESTADO ACTUAL)

### ✅ COMPLETADO:
1. **FASE 1** - Separar viewsets.py ✅
2. **FASE 2** - Separar serializers.py ✅
3. **FASE 3** - Extraer RAG service ✅

### ⬜ PENDIENTE (Frontend):
4. **FASE 4** - Crear lib/ compartido (api.ts, toast.ts, ui.ts, constants.ts)
5. **FASE 5** - Crear componentes reutilizables (DashboardKPI, ObjetoCard, etc.)
6. **FASE 6** - Refactorizar páginas (index.astro, objetos.astro, etc.)

---

## 4. CÓDIGO MUERTO (ESTADO ACTUAL)

| Archivo | Estado | Acción Realizada |
|---------|--------|-----------------|
| `inventario/views.py` | ✅ ELIMINADO | Eliminado - no contenía lógica útil |
| `inventario/tests.py` | ✅ ELIMINADO | Eliminado - estaba vacío |
| `frontend/src/services/aiHeartbeat.ts` | ✅ ELIMINADO | No se importaba en ninguna página |
| `frontend/src/components/Card.astro` | ✅ ELIMINADO | No se importaba en ninguna página |
| `frontend/src/components/CategoryFields.astro` | ✅ CONSERVADO | Se usa en objetos/nuevo.astro |
| `frontend/src/components/ImageEditor.astro` | ✅ CONSERVADO | Se usa en objetos/nuevo.astro |
