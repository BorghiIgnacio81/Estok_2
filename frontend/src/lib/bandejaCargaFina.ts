// =============================================================================
// BANDEJA DE CARGA FINA (ESCENA 4 - Organización Interna de Muebles)
// -----------------------------------------------------------------------------
// Panel DERECHO de la pantalla dividida reactiva que se abre con
// «📦 Organizar Contenido» en almacenamiento.astro:
//
//   1. BLOQUE SUPERIOR «A primera vista · sin ubicación» con JERARQUÍA estricta:
//      GRUPO 1 = Cajas sin ubicación (Contenedores Pequeños /Nuevo Contenedor.png
//      huérfanos o sin casillero) en la cima, y GRUPO 2 = Objetos individuales
//      sin ubicación (/fluffy_plush_ball.jpg) inmediatamente debajo (misma regla
//      hermética de bandejaSinUbicar). Todos los chips son draggable=true y emiten
//      los MIME types estándar (application/x-estok-contenedor /
//      application/x-estok-objeto) que las Drop Zones del Visor Contenedor Grande
//      interpretan para calcular la fila·columna del mueble y persistir con PUT
//      multi-tenant.
//
//   2. BLOQUE INFERIOR «Cambiar Contenedor»: acordeón que lista de forma
//      asincrónica los contenedores con ubicación que ya contienen elementos
//      internos; al seleccionar uno despliega su contenido respetando el MISMO
//      orden jerárquico (primero sus Cajas internas, segundo sus Objetos sueltos)
//      en chips compactos para tomarlos y mudarlos hacia la grilla del mueble.
//      NUNCA define headers de auth propios: usa getAuthHeaders()/API_BASE_URL
//      desde src/services/auth (centralizado).
//
// Persistencia multi-tenant estricta (JWT + X-Estok-Id) delegada a
// src/lib/visorContenedorGrande.ts (asignarObjetoAMueble / asignarSubContenedor)
// que se dispara al SOLTAR en un casillero [data-mueble-celda].
// La construcción del marcado jerárquico vive en src/lib/bandejaCargaFinaHtml.ts.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import type { UbicacionPlano } from './mapaJerarquico';
import {
  contenedoresFuenteDeContenidoDe,
  renderBandejaCargaFinaHtml,
} from './bandejaCargaFinaHtml';
import type { ContenedorCarga, ObjetoCarga } from './bandejaCargaFinaHtml';


let rootEl: HTMLElement | null = null;
let contenedores: ContenedorCarga[] = [];
let objetos: ObjetoCarga[] = [];
let dataCargado = false;
let acordeonAbierto = false;
let contenedorSeleccionadoId: string | null = null;
/** Habitación activa del flujo (acota el acordeón al contexto real). */
let roomId: string | null = null;
let roomNombre: string | null = null;

// =============================================================================
// HELPERS
// =============================================================================

async function fetchTodos(url: string): Promise<Record<string, unknown>[]> {
  const todos: Record<string, unknown>[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return todos;
    }
    if (!res.ok) return todos;
    const data = await res.json();
    todos.push(...(data.results || data));
    nextUrl = data.next;
  }
  return todos;
}

function numero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizarContenedor(c: Record<string, unknown>): ContenedorCarga {
  return {
    id: String(c.id),
    nombre: String(c.nombre || 'Contenedor'),
    es_inmueble: Boolean(c.es_inmueble),
    subcontenedores_count: numero(c.subcontenedores_count),
    parent_contenedor: c.parent_contenedor != null ? String(c.parent_contenedor) : null,
    parent_grid_row: c.parent_grid_row != null ? numero(c.parent_grid_row) : null,
    parent_grid_col: c.parent_grid_col != null ? numero(c.parent_grid_col) : null,
    ubicacion: c.ubicacion != null ? String(c.ubicacion) : null,
    ubicacion_nombre: c.ubicacion_nombre != null ? String(c.ubicacion_nombre) : null,
    objetos_count: numero(c.objetos_count),
  };
}

function normalizarObjeto(o: Record<string, unknown>): ObjetoCarga {
  return {
    id: String(o.id),
    nombre: String(o.nombre || 'Objeto'),
    contenedor: o.contenedor != null ? String(o.contenedor) : null,
    ubicacion: o.ubicacion != null ? String(o.ubicacion) : null,
    parent_grid_row: o.parent_grid_row != null ? numero(o.parent_grid_row) : null,
    parent_grid_col: o.parent_grid_col != null ? numero(o.parent_grid_col) : null,
    deleted_at: o.deleted_at != null ? String(o.deleted_at) : null,
  };
}

// =============================================================================
// CARGA ASINCRÓNICA (multi-tenant: JWT + X-Estok-Id vía getAuthHeaders)
// =============================================================================

async function cargar(): Promise<void> {
  if (!rootEl) return;
  dataCargado = false;
  render();
  try {
    const [contData, objData] = await Promise.all([
      fetchTodos(`${API_BASE_URL}/contenedores/?page_size=1000`),
      fetchTodos(`${API_BASE_URL}/objetos/?page_size=1000`),
    ]);
    contenedores = (contData as Record<string, unknown>[]).map(normalizarContenedor);
    objetos = (objData as Record<string, unknown>[]).map(normalizarObjeto);
  } catch {
    contenedores = [];
    objetos = [];
  }
  dataCargado = true;
  render();
}

// =============================================================================
// RENDER (delega el marcado a bandejaCargaFinaHtml.ts; selectores globales CSS)
// =============================================================================

function render(): void {
  if (!rootEl) return;
  if (
    contenedorSeleccionadoId &&
    !contenedoresFuenteDeContenidoDe(contenedores, objetos, roomId).some(
      (c) => c.id === contenedorSeleccionadoId,
    )
  ) {
    contenedorSeleccionadoId = null;
  }
  rootEl.innerHTML = renderBandejaCargaFinaHtml({
    contenedores,
    objetos,
    roomId,
    roomNombre,
    dataCargado,
    acordeonAbierto,
    contenedorSeleccionadoId,
  });
  enlazar();
}

// =============================================================================
// EVENTOS
// =============================================================================

function enlazar(): void {
  if (!rootEl) return;

  // Origen de arrastre: chips de los grupos sin ubicar (bloque superior) y de los
  // elementos internos del acordeón (cajas y objetos). Emiten los MIME types que
  // las Drop Zones del mueble consumen para persistir con PUT multi-tenant.
  rootEl.querySelectorAll<HTMLElement>('[data-cf-dnd]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      const de = e as DragEvent;
      const id = el.dataset.cfDnd;
      const tipo = el.dataset.cfTipo;
      if (!id || !tipo) {
        de.preventDefault();
        return;
      }
      const mime = tipo === 'contenedor' ? 'application/x-estok-contenedor' : 'application/x-estok-objeto';
      de.dataTransfer?.setData(mime, id);
      de.dataTransfer?.setData('text/plain', id);
      if (de.dataTransfer) de.dataTransfer.effectAllowed = 'move';
      el.classList.add('bandeja-chip-arrastrando');
    });
    el.addEventListener('dragend', () => el.classList.remove('bandeja-chip-arrastrando'));
  });

  // Acordeón «Cambiar Contenedor»: la carga del listado es asincrónica.
  rootEl.querySelector<HTMLElement>('[data-cf-toggle-accordeon]')?.addEventListener('click', () => {
    acordeonAbierto = !acordeonAbierto;
    if (acordeonAbierto && !dataCargado) void cargar();
    render();
  });

  // Selección de un contenedor origen: despliega su contenido jerárquico (primero
  // sus cajas internas, después sus objetos sueltos) en chips compactos.
  rootEl.querySelectorAll<HTMLElement>('[data-cf-cont-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.cfContToggle ?? null;
      contenedorSeleccionadoId = contenedorSeleccionadoId === id ? null : id;
      render();
    });
  });
}

// =============================================================================
// ENTRADA
// =============================================================================

export function initBandejaCargaFina(opts: { contenedor?: HTMLElement | null }): void {
  rootEl = opts.contenedor ?? null;
  if (!rootEl) return;
  rootEl.innerHTML = '<div class="cf-vacio">⏳ Cargando bandeja de carga fina…</div>';

  window.addEventListener('estok:habitacion-seleccionada', (e) => {
    const room = (e as CustomEvent<{ room: UbicacionPlano | null }>).detail?.room ?? null;
    roomId = room?.id ?? null;
    roomNombre = room?.nombre ?? null;
    contenedorSeleccionadoId = null;
    if (roomId) void cargar();
  });

  window.addEventListener('estok:espacios-cambiados', () => {
    void cargar();
  });

  void cargar();
}




