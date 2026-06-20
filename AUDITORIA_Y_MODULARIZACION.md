# Auditoría y Plan de Modularización - Estok Inventory System

## 1. AUDITORÍA DE CÓDIGO MUERTO Y PROBLEMAS

### Backend (Django)

#### ✅ Código activo y bien:
- `models.py` (594 líneas) - Modelos bien estructurados con herencia multi-tabla
- `api/viewsets.py` (1121 líneas) - ViewSets completos con acciones personalizadas
- `api/serializers.py` (437 líneas) - Serializers con lógica de creación multi-tabla
- `api/urls.py` (42 líneas) - Rutas bien configuradas
- `services/ai_vision_service.py` (748 líneas) - Servicio de IA completo
- `services/stock_service.py` (380 líneas) - Servicio de stock y valoración
- `services/marketing_service.py` (426 líneas) - Generación de anuncios
- `services/qr_service.py` (222 líneas) - Generación de QR

#### ⚠️ Problemas detectados:

1. **`viewsets.py` (1121 líneas) - DEMASIADO GRANDE**
   - Mezcla 7 ViewSets en un solo archivo
   - Lógica de negocio mezclada con controladores
   - `ObjetoViewSet` tiene 1121 líneas solo él

2. **`serializers.py` (437 líneas) - Grande pero aceptable**
   - `ObjetoCreateSerializer` tiene lógica de creación compleja
   - Los campos específicos están hardcodeados en 3 lugares diferentes

3. **`models.py` (594 líneas) - Bien pero mejorable**
   - El `save()` de Contenedor importa QRService inline (acoplamiento)
   - Se podría separar en archivos por dominio

4. **`ai_vision_service.py` (748 líneas) - Grande pero cohesivo**
   - LMStudioClient y AIVisionService en el mismo archivo
   - Lógica de RAG mezclada con el servicio principal

5. **Código MUERTO confirmado:**
   - `inventario/views.py` - Solo tiene `from django.shortcuts import render` y un comentario. **ELIMINAR.**
   - `inventario/tests.py` - Vacío. **POBLAR o ELIMINAR.**
   - `frontend/src/services/aiHeartbeat.ts` - No se importa en ninguna página. El heartbeat está inline en index.astro y objetos/nuevo.astro. **ELIMINAR.**
   - `frontend/src/components/Card.astro` - Componente genérico de tarjeta. No se importa en ninguna página. **ELIMINAR.**

6. **Código ACTIVO confirmado:**
   - `frontend/src/components/CategoryFields.astro` - Se importa y usa en `objetos/nuevo.astro` (línea 9). **CONSERVAR.**
   - `frontend/src/components/ImageEditor.astro` - Se importa y usa en `objetos/nuevo.astro` (línea 11). Editor de imagen completo con Canvas API (781 líneas). **CONSERVAR.**

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

## 3. ORDEN DE EJECUCIÓN RECOMENDADO

1. **FASE 1** - Separar viewsets.py (prioridad máxima - 1121 líneas)
2. **FASE 4** - Crear lib/ compartido (desbloquea frontend)
3. **FASE 5** - Crear componentes reutilizables
4. **FASE 6** - Refactorizar páginas
5. **FASE 2** - Separar serializers.py
6. **FASE 3** - Extraer RAG service

---

## 4. CÓDIGO MUERTO A ELIMINAR/REVISAR (CONFIRMADO)

| Archivo | Estado | Acción |
|---------|--------|--------|
| `inventario/views.py` | ✅ MUERTO | Solo tiene `from django.shortcuts import render`. ELIMINAR. |
| `inventario/tests.py` | ✅ MUERTO | Vacío. POBLAR o ELIMINAR. |
| `frontend/src/services/aiHeartbeat.ts` | ✅ MUERTO | No se importa en ninguna página. ELIMINAR. |
| `frontend/src/components/Card.astro` | ✅ MUERTO | No se importa en ninguna página. ELIMINAR. |
| `frontend/src/components/CategoryFields.astro` | ✅ ACTIVO | Se usa en objetos/nuevo.astro. CONSERVAR. |
| `frontend/src/components/ImageEditor.astro` | ✅ ACTIVO | Se usa en objetos/nuevo.astro. CONSERVAR. |
