// =============================================================================
// TABLERO DE ALMACENAMIENTO - Drag & Drop nativo (HTML5 API)
// -----------------------------------------------------------------------------
// Unifica "Ubicaciones" y "Contenedores" en una única vista de dos columnas:
//   - Columna izquierda : Ubicaciones raíz como zonas de caída (drop zones)
//     que listan internamente sus contenedores y sub-contenedores.
//   - Columna derecha   : Paleta de contenedores raíz (draggable="true").
//
// Operaciones visuales:
//   1. Arrastrar un contenedor dentro de una tarjeta de Ubicación.
//   2. Arrastrar un contenedor dentro de OTRO contenedor (sub-nivel).
//
// Persistencia: al soltar, se dispara PUT /api/contenedores/{id}/ con
// { ubicacion, parent_contenedor }. HTTP 200 => re-render del árbol en vivo.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';

// =============================================================================
// TIPOS
// =============================================================================

export interface ContenedorDnD {
  id: string;
  nombre: string;
  descripcion: string;
  ubicacion: string;
  ubicacion_nombre: string;
  parent_contenedor: string | null;
  parent_contenedor_nombre: string | null;
  objetos_count: number;
  qr_code_url: string | null;
  hijos: ContenedorDnD[];
}

export interface UbicacionDnD {
  id: string;
  nombre: string;
  descripcion: string;
  objetos_count: number;
  contenedores_count: number;
  raices: ContenedorDnD[];
}

// =============================================================================
// HELPERS
// =============================================================================

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ICONO_OJO =
  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>';

const ICONO_PAPELERA =
  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>';

const ICONO_CAJA =
  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>';

const ICONO_UBICACION =
  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>';

const ICONO_LAPIZ =
  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>';

// =============================================================================
// CLASE PRINCIPAL DEL TABLERO
// =============================================================================

export class AlmacenamientoBoard {
  private ubicaciones: UbicacionDnD[] = [];
  private contenedores: ContenedorDnD[] = [];
  private contenedoresPorId = new Map<string, ContenedorDnD>();
  private dragId: string | null = null;

  // ---------------------------------------------------------------------------
  // INICIO
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    this.enlazarBotonesHeader();
    this.enlazarModales();
    document.getElementById('retryBtn')?.addEventListener('click', () => { void this.cargar(); });
    await this.cargar();
  }

  // ---------------------------------------------------------------------------
  // CARGA DE DATOS (con paginación robusta)
  // ---------------------------------------------------------------------------

  private async fetchTodos(url: string): Promise<any[]> {
    const todos: any[] = [];
    let nextUrl: string | null = url;
    while (nextUrl) {
      const res = await fetch(nextUrl, { headers: getAuthHeaders() });
      if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('Sesión expirada');
      }
      if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
      const data = await res.json();
      todos.push(...(data.results || data));
      nextUrl = data.next;
    }
    return todos;
  }

  async cargar(): Promise<void> {
    this.mostrarCargando();
    try {
      const [ubiData, contData] = await Promise.all([
        this.fetchTodos(`${API_BASE_URL}/ubicaciones/?page_size=1000`),
        this.fetchTodos(`${API_BASE_URL}/contenedores/?page_size=1000`),
      ]);

      this.ubicaciones = ubiData.map((u) => ({ ...u, raices: [] }));
      this.contenedores = contData.map((c) => ({ ...c, hijos: [] }));
      this.construirArbol();

      this.ocultarCargando();
      this.ocultarError();
      this.render();
    } catch (e: any) {
      this.ocultarCargando();
      this.mostrarError(e?.message || 'Error de conexión. Verificá que el servidor esté corriendo.');
    }
  }

  /** Construye la jerarquía in-memory y agrupa raíces por ubicación. */
  private construirArbol(): void {
    this.contenedoresPorId = new Map(this.contenedores.map((c) => [c.id, c]));
    for (const c of this.contenedores) c.hijos = [];
    for (const c of this.contenedores) {
      if (c.parent_contenedor && this.contenedoresPorId.has(c.parent_contenedor)) {
        this.contenedoresPorId.get(c.parent_contenedor)!.hijos.push(c);
      }
    }
    const raices = this.contenedores.filter(
      (c) => !c.parent_contenedor || !this.contenedoresPorId.has(c.parent_contenedor),
    );
    for (const u of this.ubicaciones) {
      u.raices = raices.filter((c) => c.ubicacion === u.id);
    }
  }

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  private render(): void {
    const colUbicaciones = document.getElementById('columnaUbicaciones');
    const colContenedores = document.getElementById('columnaContenedores');
    if (!colUbicaciones || !colContenedores) return;

    const contUbi = document.getElementById('contadorUbicaciones');
    const contCon = document.getElementById('contadorContenedores');
    if (contUbi) contUbi.textContent = `${this.ubicaciones.length}`;
    if (contCon) contCon.textContent = `${this.contenedores.length}`;

    const raices = this.contenedores.filter(
      (c) => !c.parent_contenedor || !this.contenedoresPorId.has(c.parent_contenedor),
    );

    if (this.ubicaciones.length === 0) {
      colUbicaciones.innerHTML = `<div class="bg-white rounded-2xl border-2 border-dashed border-gray-300 p-10 text-center">
        <div class="text-5xl mb-3">📍</div>
        <p class="text-gray-400 font-medium mb-4">No hay ubicaciones todavía</p>
        <button id="emptyUbicacionBtn" class="inline-flex items-center px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 transition-base">+ Crear Ubicación</button>
      </div>`;
      document.getElementById('emptyUbicacionBtn')?.addEventListener('click', () => this.abrirModal('ubicacion'));
    } else {
      colUbicaciones.innerHTML = this.ubicaciones.map((u) => this.ubicacionHtml(u)).join('');
    }

    if (raices.length === 0) {
      colContenedores.innerHTML = `<div class="bg-white rounded-2xl border-2 border-dashed border-gray-300 p-10 text-center">
        <div class="text-5xl mb-3">📦</div>
        <p class="text-gray-400 font-medium mb-4">No hay contenedores disponibles</p>
        <button id="emptyContenedorBtn" class="inline-flex items-center px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 transition-base">+ Crear Contenedor</button>
      </div>`;
      document.getElementById('emptyContenedorBtn')?.addEventListener('click', () => this.abrirModal('contenedor'));
    } else {
      colContenedores.innerHTML = raices.map((c) => this.contenedorPaletaHtml(c)).join('');
    }

    this.enlazarDnD();
    this.enlazarEliminar();
    this.enlazarEditar();
  }

  // -- Tarjeta de Ubicación (drop zone) -------------------------------------

  private ubicacionHtml(u: UbicacionDnD): string {
    const raicesHtml = u.raices.map((c) => this.contenedorHtml(c, 0)).join('');
    return `
    <article class="dnd-ubicacion bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border-2 border-dashed border-gray-300 transition-base p-5" data-id="${u.id}">
      <div class="flex items-start gap-3 mb-3">
        <div class="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <svg class="w-5 h-5 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_UBICACION}</svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="font-semibold text-gray-900" data-nombre-ubicacion="${u.id}">${escapeHtml(u.nombre)}</h3>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">${u.contenedores_count || 0} contenedores</span>
          </div>
          <div data-desc-ubicacion-slot="${u.id}">
            ${u.descripcion ? `<p class="text-sm text-gray-500 mt-0.5 line-clamp-2">${escapeHtml(u.descripcion)}</p>` : ''}
          </div>
          <p class="text-xs text-gray-400 mt-0.5">📦 ${u.objetos_count || 0} objetos</p>
        </div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" class="dnd-editar-ubicacion text-slate-400 hover:text-blue-600 transition-colors cursor-pointer p-1" data-id="${u.id}" title="Editar ubicación">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_LAPIZ}</svg>
          </button>
          <a href="/ubicaciones/${u.id}" draggable="false" class="text-gray-400 hover:text-blue-700 p-1 transition-base" title="Ver ubicación">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_OJO}</svg>
          </a>
          <button type="button" class="dnd-eliminar-ubicacion text-red-300 hover:text-red-600 p-1 transition-base" data-id="${u.id}" data-nombre="${escapeHtml(u.nombre)}" title="Eliminar ubicación">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_PAPELERA}</svg>
          </button>
        </div>
      </div>
      <div class="dnd-hijos space-y-2 min-h-[44px]">
        ${raicesHtml || `<p class="text-xs text-center text-gray-400 border border-dashed border-gray-200 rounded-lg py-3">📥 Soltá contenedores acá</p>`}
      </div>
    </article>`;
  }

  // -- Tarjeta de Contenedor (recursiva: muestra sub-contenedores) ----------

  private contenedorHtml(c: ContenedorDnD, profundidad: number): string {
    const subHtml = c.hijos.length
      ? `<div class="mt-2.5 pl-3 border-l-2 border-green-100 space-y-2">${c.hijos.map((h) => this.contenedorHtml(h, profundidad + 1)).join('')}</div>`
      : '';
    return `
    <div class="dnd-contenedor bg-white rounded-xl border border-gray-200 shadow-sm p-3.5 transition-base cursor-grab active:cursor-grabbing hover:shadow-md hover:border-blue-200" data-id="${c.id}" draggable="true" title="Arrastrá para mover">
      <div class="flex items-start gap-2.5">
        <div class="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <svg class="w-5 h-5 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_CAJA}</svg>
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="font-semibold text-gray-900 text-sm truncate" data-nombre-contenedor="${c.id}">${escapeHtml(c.nombre)}</h4>
          <div data-desc-contenedor-slot="${c.id}">
            ${c.descripcion ? `<p class="text-xs text-gray-500 line-clamp-1">${escapeHtml(c.descripcion)}</p>` : ''}
          </div>
          <p class="text-[11px] text-gray-400 mt-0.5">📦 ${c.objetos_count || 0} objetos${c.hijos.length ? ` · 🗂 ${c.hijos.length} sub-contenedor${c.hijos.length > 1 ? 'es' : ''}` : ''}</p>
        </div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" class="dnd-editar-contenedor text-slate-400 hover:text-blue-600 transition-colors cursor-pointer p-1" data-id="${c.id}" title="Editar contenedor">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_LAPIZ}</svg>
          </button>
          <a href="/contenedores/${c.id}" draggable="false" class="text-gray-400 hover:text-blue-700 p-1 transition-base" title="Ver contenedor">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_OJO}</svg>
          </a>
          <button type="button" class="dnd-eliminar-contenedor text-red-300 hover:text-red-600 p-1 transition-base" data-id="${c.id}" data-nombre="${escapeHtml(c.nombre)}" title="Eliminar contenedor">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_PAPELERA}</svg>
          </button>
        </div>
      </div>
      ${subHtml}
    </div>`;
  }

  // -- Tarjeta de Contenedor en la paleta (sin anidados) --------------------

  private contenedorPaletaHtml(c: ContenedorDnD): string {
    return `
    <div class="dnd-contenedor bg-white rounded-xl border border-gray-200 shadow-sm p-3.5 transition-base cursor-grab active:cursor-grabbing hover:shadow-md hover:border-blue-200" data-id="${c.id}" draggable="true" title="Arrastrá a una ubicación o dentro de otro contenedor">
      <div class="flex items-start gap-2.5">
        <div class="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <svg class="w-5 h-5 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_CAJA}</svg>
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="font-semibold text-gray-900 text-sm truncate" data-nombre-contenedor="${c.id}">${escapeHtml(c.nombre)}</h4>
          <div data-desc-contenedor-slot="${c.id}">
            ${c.descripcion ? `<p class="text-xs text-gray-500 line-clamp-1">${escapeHtml(c.descripcion)}</p>` : ''}
          </div>
          <p class="text-[11px] text-gray-400 mt-0.5">📍 ${escapeHtml(c.ubicacion_nombre || 'Sin ubicación')} · 📦 ${c.objetos_count || 0}${c.hijos.length ? ` · 🗂 ${c.hijos.length}` : ''}</p>
        </div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" class="dnd-editar-contenedor text-slate-400 hover:text-blue-600 transition-colors cursor-pointer p-1" data-id="${c.id}" title="Editar contenedor">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_LAPIZ}</svg>
          </button>
          <a href="/contenedores/${c.id}" draggable="false" class="text-gray-400 hover:text-blue-700 p-1 transition-base" title="Ver contenedor">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_OJO}</svg>
          </a>
          <button type="button" class="dnd-eliminar-contenedor text-red-300 hover:text-red-600 p-1 transition-base" data-id="${c.id}" data-nombre="${escapeHtml(c.nombre)}" title="Eliminar contenedor">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_PAPELERA}</svg>
          </button>
        </div>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // ESTADOS (loading / error)
  // ---------------------------------------------------------------------------

  private mostrarCargando(): void {
    document.getElementById('loadingState')?.classList.remove('hidden');
    document.getElementById('errorState')?.classList.add('hidden');
  }

  private ocultarCargando(): void {
    document.getElementById('loadingState')?.classList.add('hidden');
  }

  private mostrarError(msg: string): void {
    document.getElementById('errorState')?.classList.remove('hidden');
    const msgEl = document.getElementById('errorMessage');
    if (msgEl) msgEl.textContent = msg;
  }

  private ocultarError(): void {
    document.getElementById('errorState')?.classList.add('hidden');
  }

  // ---------------------------------------------------------------------------
  // DRAG & DROP (HTML5 API)
  // ---------------------------------------------------------------------------

  private enlazarDnD(): void {
    // Tarjetas de contenedor: origen arrastrable + zona de caída para sub-niveles
    document.querySelectorAll<HTMLElement>('.dnd-contenedor').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        const id = card.dataset.id;
        if (!id) return;
        this.dragId = id;
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', id);
          e.dataTransfer.setData('application/x-estok-contenedor', id);
          e.dataTransfer.effectAllowed = 'move';
        }
        card.classList.add('opacity-50');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('opacity-50');
        this.limpiarFeedback();
        this.dragId = null;
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        this.marcarActivo(card, true);
      });

      card.addEventListener('dragleave', (e) => {
        if (e.relatedTarget && card.contains(e.relatedTarget as Node)) return;
        this.marcarActivo(card, false);
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.marcarActivo(card, false);
        void this.procesarDropEnContenedor(e, card.dataset.id);
      });
    });

    // Tarjetas de ubicación: zonas de caída para asignar contenedores
    document.querySelectorAll<HTMLElement>('.dnd-ubicacion').forEach((zona) => {
      zona.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        this.marcarActivo(zona, true);
      });

      zona.addEventListener('dragleave', (e) => {
        if (e.relatedTarget && zona.contains(e.relatedTarget as Node)) return;
        this.marcarActivo(zona, false);
      });

      zona.addEventListener('drop', (e) => {
        e.preventDefault();
        this.marcarActivo(zona, false);
        void this.procesarDropEnUbicacion(e, zona.dataset.id);
      });
    });
  }

  private obtenerIdDrag(e: DragEvent): string | null {
    if (this.dragId) return this.dragId;
    return (
      e.dataTransfer?.getData('application/x-estok-contenedor') ||
      e.dataTransfer?.getData('text/plain') ||
      null
    );
  }

  private async procesarDropEnContenedor(e: DragEvent, targetId?: string): Promise<void> {
    const id = this.obtenerIdDrag(e);
    if (!id || !targetId) return;
    if (id === targetId) {
      this.toast('⚠️ No podés soltar un contenedor dentro de sí mismo.');
      return;
    }
    const padre = this.contenedoresPorId.get(targetId);
    if (!padre) return;
    if (this.esAncestro(id, targetId)) {
      this.toast('⚠️ No podés soltar un contenedor dentro de sus propios sub-contenedores.');
      return;
    }
    await this.moverContenedor(id, { ubicacion: padre.ubicacion, parent_contenedor: targetId });
  }

  private async procesarDropEnUbicacion(e: DragEvent, locId?: string): Promise<void> {
    const id = this.obtenerIdDrag(e);
    if (!id || !locId) return;
    await this.moverContenedor(id, { ubicacion: locId, parent_contenedor: null });
  }

  /** True si `posibleDescendienteId` está dentro del subárbol de `padreId`. */
  private esAncestro(padreId: string, posibleDescendienteId: string): boolean {
    let cursor = this.contenedoresPorId.get(posibleDescendienteId);
    const vistos = new Set<string>();
    while (cursor?.parent_contenedor) {
      if (vistos.has(cursor.parent_contenedor)) return false;
      vistos.add(cursor.parent_contenedor);
      if (cursor.parent_contenedor === padreId) return true;
      cursor = this.contenedoresPorId.get(cursor.parent_contenedor);
    }
    return false;
  }

  private marcarActivo(el: HTMLElement, activo: boolean): void {
    el.classList.toggle('dnd-drop-activo', activo);
  }

  private limpiarFeedback(): void {
    document.querySelectorAll('.dnd-drop-activo').forEach((el) => el.classList.remove('dnd-drop-activo'));
    document.querySelectorAll('.dnd-contenedor').forEach((el) => el.classList.remove('opacity-50'));
  }

  // ---------------------------------------------------------------------------
  // PERSISTENCIA: PUT /api/contenedores/{id}/ (HTTP 200 => árbol en vivo)
  // ---------------------------------------------------------------------------

  private async moverContenedor(id: string, payload: { ubicacion: string; parent_contenedor: string | null }): Promise<void> {
    const contenedor = this.contenedoresPorId.get(id);
    if (!contenedor) return;

    // No-op si ya está exactamente en el mismo lugar
    const parentActual = contenedor.parent_contenedor || null;
    if (contenedor.ubicacion === payload.ubicacion && parentActual === payload.parent_contenedor) {
      this.toast('ℹ️ Ese contenedor ya está en ese lugar.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/contenedores/${id}/`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (res.ok) {
        this.toast(`✅ «${contenedor.nombre}» movido correctamente.`);
        await this.cargar();
      } else {
        const err = await res.json().catch(() => ({}));
        this.toast('❌ ' + this.extraerError(err));
      }
    } catch {
      this.toast('❌ Error de conexión al mover el contenedor.');
    }
  }

  // ---------------------------------------------------------------------------
  // ELIMINAR (evita regresión de funcionalidad de las listas anteriores)
  // ---------------------------------------------------------------------------

  private enlazarEliminar(): void {
    document.querySelectorAll<HTMLElement>('.dnd-eliminar-contenedor').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const nombre = btn.dataset.nombre;
        if (!id || !confirm(`¿Eliminar el contenedor "${nombre}"?\nSus sub-contenedores pasarán a nivel raíz.`)) return;
        try {
          const res = await fetch(`${API_BASE_URL}/contenedores/${id}/`, { method: 'DELETE', headers: getAuthHeaders() });
          if (res.ok || res.status === 204) {
            this.toast('🗑 Contenedor eliminado.');
            await this.cargar();
          } else {
            const err = await res.json().catch(() => ({}));
            this.toast('❌ ' + this.extraerError(err));
          }
        } catch {
          this.toast('❌ Error de conexión al eliminar.');
        }
      });
    });

    document.querySelectorAll<HTMLElement>('.dnd-eliminar-ubicacion').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const nombre = btn.dataset.nombre;
        if (!id || !confirm(`¿Eliminar la ubicación "${nombre}"?\n⚠️ Sus contenedores y sub-contenedores se eliminarán en cascada.`)) return;
        try {
          const res = await fetch(`${API_BASE_URL}/ubicaciones/${id}/`, { method: 'DELETE', headers: getAuthHeaders() });
          if (res.ok || res.status === 204) {
            this.toast('🗑 Ubicación eliminada.');
            await this.cargar();
          } else {
            const err = await res.json().catch(() => ({}));
            this.toast('❌ ' + this.extraerError(err));
          }
        } catch {
          this.toast('❌ Error de conexión al eliminar.');
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // EDICIÓN EN CALIENTE (PUT /api/{ubicaciones|contenedores}/{id}/ sin reload)
  // ---------------------------------------------------------------------------

  private enlazarEditar(): void {
    document.querySelectorAll<HTMLElement>('.dnd-editar-ubicacion').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (!id) return;
        const u = this.ubicaciones.find((x) => x.id === id);
        if (u) this.abrirModalEditar('ubicacion', u.id, u.nombre, u.descripcion);
      });
    });

    document.querySelectorAll<HTMLElement>('.dnd-editar-contenedor').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (!id) return;
        const c = this.contenedoresPorId.get(id);
        if (c) this.abrirModalEditar('contenedor', c.id, c.nombre, c.descripcion);
      });
    });
  }

  private abrirModalEditar(tipo: 'ubicacion' | 'contenedor', id: string, nombre: string, descripcion: string): void {
    const modal = document.getElementById('modalEditar');
    if (!modal) return;
    (document.getElementById('editarTitulo') as HTMLElement).textContent =
      tipo === 'ubicacion' ? '✏️ Editar Ubicación' : '✏️ Editar Contenedor';
    (document.getElementById('editarTipo') as HTMLInputElement).value = tipo;
    (document.getElementById('editarId') as HTMLInputElement).value = id;
    (document.getElementById('editarNombre') as HTMLInputElement).value = nombre;
    (document.getElementById('editarDescripcion') as HTMLTextAreaElement).value = descripcion || '';
    const err = modal.querySelector('[data-form-error]');
    if (err) err.classList.add('hidden');
    modal.classList.remove('hidden');
    (document.getElementById('editarNombre') as HTMLInputElement).focus();
  }

  private async enviarFormEditar(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const tipo = (document.getElementById('editarTipo') as HTMLInputElement).value as 'ubicacion' | 'contenedor';
    const id = (document.getElementById('editarId') as HTMLInputElement).value;
    const nombre = (document.getElementById('editarNombre') as HTMLInputElement).value.trim();
    const descripcion = (document.getElementById('editarDescripcion') as HTMLTextAreaElement).value.trim();
    if (!id || !nombre) {
      this.formError('editarFormError', 'El nombre es obligatorio.');
      return;
    }
    const recurso = tipo === 'ubicacion' ? 'ubicaciones' : 'contenedores';
    this.setGuardando('editar', true);
    try {
      const res = await fetch(`${API_BASE_URL}/${recurso}/${id}/`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, descripcion }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (res.ok) {
        // Modelo en memoria: mantiene el Drag & Drop coherente tras el rename.
        if (tipo === 'ubicacion') {
          const u = this.ubicaciones.find((x) => x.id === id);
          if (u) {
            u.nombre = nombre;
            u.descripcion = descripcion;
          }
        } else {
          const c = this.contenedoresPorId.get(id);
          if (c) {
            c.nombre = nombre;
            c.descripcion = descripcion;
          }
        }
        this.cerrarModal('editar');
        form.reset();
        this.toast(`✏️ «${nombre}» actualizado.`);
        this.actualizarDomTrasEdicion(tipo, id, nombre, descripcion);
      } else {
        const err = await res.json().catch(() => ({}));
        this.formError('editarFormError', this.extraerError(err));
      }
    } catch {
      this.formError('editarFormError', 'Error de conexión.');
    } finally {
      this.setGuardando('editar', false);
    }
  }

  /** Actualiza el texto del árbol en vivo (sin recargar la página). */
  private actualizarDomTrasEdicion(
    tipo: 'ubicacion' | 'contenedor',
    id: string,
    nombre: string,
    descripcion: string,
  ): void {
    if (tipo === 'ubicacion') {
      document.querySelectorAll<HTMLElement>(`[data-nombre-ubicacion="${id}"]`).forEach((el) => {
        el.textContent = nombre;
      });
      document.querySelectorAll<HTMLElement>(`[data-desc-ubicacion-slot="${id}"]`).forEach((slot) => {
        slot.innerHTML = descripcion
          ? `<p class="text-sm text-gray-500 mt-0.5 line-clamp-2">${escapeHtml(descripcion)}</p>`
          : '';
      });
    } else {
      document.querySelectorAll<HTMLElement>(`[data-nombre-contenedor="${id}"]`).forEach((el) => {
        el.textContent = nombre;
      });
      document.querySelectorAll<HTMLElement>(`[data-desc-contenedor-slot="${id}"]`).forEach((slot) => {
        slot.innerHTML = descripcion
          ? `<p class="text-xs text-gray-500 line-clamp-1">${escapeHtml(descripcion)}</p>`
          : '';
      });
    }
    // Mantener el nombre nuevo en los botones de eliminar (confirm del navegador).
    document.querySelectorAll<HTMLElement>(`[data-id="${id}"] [data-nombre]`).forEach((el) => {
      el.setAttribute('data-nombre', nombre);
    });
  }

  // ---------------------------------------------------------------------------
  // TOAST
  // ---------------------------------------------------------------------------

  private toast(mensaje: string): void {
    let cont = document.getElementById('dnd-toast');
    if (!cont) {
      cont = document.createElement('div');
      cont.id = 'dnd-toast';
      cont.className = 'fixed bottom-6 right-6 z-[100] space-y-2 max-w-sm';
      document.body.appendChild(cont);
    }
    const el = document.createElement('div');
    el.className = 'dnd-toast bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg border border-gray-700';
    el.textContent = mensaje;
    cont.appendChild(el);
    setTimeout(() => {
      el.classList.add('opacity-0', 'transition-opacity', 'duration-300');
      setTimeout(() => el.remove(), 350);
    }, 2600);
  }

  // ---------------------------------------------------------------------------
  // MODALES DE CREACIÓN
  // ---------------------------------------------------------------------------

  private enlazarBotonesHeader(): void {
    document.getElementById('nuevaUbicacionBtn')?.addEventListener('click', () => this.abrirModal('ubicacion'));
    document.getElementById('nuevoContenedorBtn')?.addEventListener('click', () => this.abrirModal('contenedor'));
  }

  private abrirModal(tipo: 'ubicacion' | 'contenedor'): void {
    const id = tipo === 'ubicacion' ? 'modalUbicacion' : 'modalContenedor';
    const modal = document.getElementById(id);
    modal?.classList.remove('hidden');
    const form = modal?.querySelector('form');
    form?.reset();
    const err = modal?.querySelector('[data-form-error]');
    if (err) err.classList.add('hidden');
    if (tipo === 'contenedor') this.llenarSelectUbicaciones();
  }

  private cerrarModal(tipo: 'ubicacion' | 'contenedor' | 'editar'): void {
    const id = tipo === 'ubicacion' ? 'modalUbicacion' : tipo === 'contenedor' ? 'modalContenedor' : 'modalEditar';
    document.getElementById(id)?.classList.add('hidden');
  }

  private enlazarModales(): void {
    document.querySelectorAll<HTMLElement>('[data-cerrar-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tipo = btn.getAttribute('data-cerrar-modal') as 'ubicacion' | 'contenedor' | 'editar' | null;
        if (tipo) this.cerrarModal(tipo);
      });
    });

    (['modalUbicacion', 'modalContenedor', 'modalEditar'] as const).forEach((idModal) => {
      document.getElementById(idModal)?.addEventListener('click', (e) => {
        if (e.target === document.getElementById(idModal)) {
          document.getElementById(idModal)?.classList.add('hidden');
        }
      });
    });

    (document.getElementById('ubiForm') as HTMLFormElement | null)?.addEventListener('submit', (e) => this.enviarFormUbicacion(e));
    (document.getElementById('conForm') as HTMLFormElement | null)?.addEventListener('submit', (e) => this.enviarFormContenedor(e));
    (document.getElementById('editarForm') as HTMLFormElement | null)?.addEventListener('submit', (e) => this.enviarFormEditar(e));

    this.enlazarInputFoto('ubiFotoInput', 'ubiFotoLabel');
    this.enlazarInputFoto('conFotoInput', 'conFotoLabel');
  }

  private enlazarInputFoto(inputId: string, labelId: string): void {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const label = document.getElementById(labelId);
    input?.addEventListener('change', () => {
      const archivo = input.files?.[0];
      if (label) label.textContent = archivo ? archivo.name : 'Seleccionar foto';
    });
  }

  private llenarSelectUbicaciones(): void {
    const select = document.getElementById('conUbicacion') as HTMLSelectElement | null;
    if (!select) return;
    select.innerHTML = '<option value="">Seleccionar ubicación...</option>';
    for (const u of this.ubicaciones) {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.nombre;
      select.appendChild(opt);
    }
  }

  private async enviarFormUbicacion(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const nombre = (document.getElementById('ubiNombre') as HTMLInputElement).value.trim();
    const descripcion = (document.getElementById('ubiDescripcion') as HTMLTextAreaElement).value.trim();
    if (!nombre) {
      this.formError('ubiFormError', 'El nombre es obligatorio.');
      return;
    }
    this.setGuardando('ubi', true);
    try {
      const formData = new FormData();
      formData.append('nombre', nombre);
      formData.append('descripcion', descripcion);
      const largo = (document.getElementById('ubiLargo') as HTMLInputElement).value;
      const ancho = (document.getElementById('ubiAncho') as HTMLInputElement).value;
      const alto = (document.getElementById('ubiAlto') as HTMLInputElement).value;
      if (largo) formData.append('largo', largo);
      if (ancho) formData.append('ancho', ancho);
      if (alto) formData.append('alto', alto);
      const foto = (document.getElementById('ubiFotoInput') as HTMLInputElement).files?.[0];
      if (foto) formData.append('foto', foto);

      const res = await fetch(`${API_BASE_URL}/ubicaciones/`, { method: 'POST', headers: getAuthHeaders(), body: formData });
      if (res.ok) {
        this.cerrarModal('ubicacion');
        form.reset();
        this.toast('✅ Ubicación creada.');
        await this.cargar();
      } else {
        const err = await res.json().catch(() => ({}));
        this.formError('ubiFormError', this.extraerError(err));
      }
    } catch {
      this.formError('ubiFormError', 'Error de conexión.');
    } finally {
      this.setGuardando('ubi', false);
    }
  }

  private async enviarFormContenedor(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const nombre = (document.getElementById('conNombre') as HTMLInputElement).value.trim();
    const descripcion = (document.getElementById('conDescripcion') as HTMLTextAreaElement).value.trim();
    const ubicacion = (document.getElementById('conUbicacion') as HTMLSelectElement).value;
    if (!nombre || !ubicacion) {
      this.formError('conFormError', 'Nombre y ubicación son obligatorios.');
      return;
    }
    this.setGuardando('con', true);
    try {
      const formData = new FormData();
      formData.append('nombre', nombre);
      formData.append('descripcion', descripcion);
      formData.append('ubicacion', ubicacion);
      const largo = (document.getElementById('conLargo') as HTMLInputElement).value;
      const ancho = (document.getElementById('conAncho') as HTMLInputElement).value;
      const alto = (document.getElementById('conAlto') as HTMLInputElement).value;
      if (largo) formData.append('largo', largo);
      if (ancho) formData.append('ancho', ancho);
      if (alto) formData.append('alto', alto);
      const foto = (document.getElementById('conFotoInput') as HTMLInputElement).files?.[0];
      if (foto) formData.append('foto', foto);

      const res = await fetch(`${API_BASE_URL}/contenedores/`, { method: 'POST', headers: getAuthHeaders(), body: formData });
      if (res.ok) {
        this.cerrarModal('contenedor');
        form.reset();
        this.toast('✅ Contenedor creado.');
        await this.cargar();
      } else {
        const err = await res.json().catch(() => ({}));
        this.formError('conFormError', this.extraerError(err));
      }
    } catch {
      this.formError('conFormError', 'Error de conexión.');
    } finally {
      this.setGuardando('con', false);
    }
  }

  private setGuardando(prefix: 'ubi' | 'con' | 'editar', guardando: boolean): void {
    const btn = document.getElementById(`${prefix}SaveBtn`) as HTMLButtonElement | null;
    const text = document.getElementById(`${prefix}SaveText`);
    const spinner = document.getElementById(`${prefix}SaveSpinner`);
    if (btn) btn.disabled = guardando;
    text?.classList.toggle('hidden', guardando);
    spinner?.classList.toggle('hidden', !guardando);
  }

  private formError(id: string, msg: string): void {
    const err = document.getElementById(id);
    if (!err) return;
    err.textContent = msg;
    err.classList.remove('hidden');
  }

  private extraerError(err: any): string {
    if (!err) return 'Error desconocido.';
    if (typeof err === 'string') return err;
    if (err.detail) return String(err.detail);
    if (err.non_field_errors) return String(Array.isArray(err.non_field_errors) ? err.non_field_errors[0] : err.non_field_errors);
    if (err.error) return String(err.error);
    const claves = Object.keys(err);
    if (claves.length) {
      return claves
        .map((k) => {
          const v = err[k];
          if (Array.isArray(v)) return `${k}: ${v[0]}`;
          return `${k}: ${String(v)}`;
        })
        .join(', ');
    }
    return 'Error desconocido.';
  }
}








