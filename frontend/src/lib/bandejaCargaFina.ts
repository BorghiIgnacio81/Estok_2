// =============================================================================
// BANDEJA DE CARGA FINA (ESCENA 4 - Organización Interna de Muebles)
// -----------------------------------------------------------------------------
// Panel DERECHO de la pantalla dividida reactiva que se abre con
// «📦 Organizar Contenido» en almacenamiento.astro:
//
//   1. BLOQUE SUPERIOR «A primera vista · sin ubicación»: grilla compacta de
//      Objetos (/fluffy_plush_ball.jpg) y Cajas (/Nuevo Contenedor.png)
//      huérfanos o sin casillero (misma regla hermética de bandejaSinUbicar).
//      Todos los chips son draggable=true y emiten los MIME types estándar
//      (application/x-estok-contenedor / application/x-estok-objeto) que las
//      Drop Zones del Visor Contenedor Grande interpretan para calcular la
//      fila·columna del mueble y persistir con PUT multi-tenant.
//
//   2. BLOQUE INFERIOR «Cambiar Contenedor»: acordeón que lista de forma
//      asincrónica los contenedores con ubicación que ya contienen objetos
//      internos; al seleccionar uno despliega sus objetos en chips compactos
//      para tomarlos y mudarlos físicamente hacia la grilla del mueble. NUNCA
//      define headers de auth propios: usa getAuthHeaders()/API_BASE_URL desde
//      src/services/auth (centralizado).
//
// Persistencia multi-tenant estricta (JWT + X-Estok-Id) delegada a
// src/lib/visorContenedorGrande.ts (asignarObjetoAMueble / asignarSubContenedor)
// que se dispara al SOLTAR en un casillero [data-mueble-celda].
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { escapeHtml } from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';

const IMG_CONTENEDOR_GRANDE = '/archivador-login.png';
const IMG_CONTENEDOR_PEQUENO = '/Nuevo Contenedor.png';
const IMG_OBJETO = '/fluffy_plush_ball.jpg';

// =============================================================================
// TIPOS
// =============================================================================

interface ContenedorCarga {
  id: string;
  nombre: string;
  es_inmueble: boolean;
  subcontenedores_count: number;
  parent_contenedor: string | null;
  parent_grid_row: number | null;
  parent_grid_col: number | null;
  ubicacion: string | null;
  ubicacion_nombre: string | null;
  objetos_count: number;
}

interface ObjetoCarga {
  id: string;
  nombre: string;
  contenedor: string | null;
  ubicacion: string | null;
  parent_grid_row: number | null;
  parent_grid_col: number | null;
  deleted_at: string | null;
}

interface ChipCarga {
  id: string;
  nombre: string;
  tipo: 'contenedor' | 'objeto';
}

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

function sinCasillero(x: { parent_grid_row?: unknown; parent_grid_col?: unknown }): boolean {
  return x.parent_grid_row == null && x.parent_grid_col == null;
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

/**
 * Chips «por ubicar» del bloque superior: MISMA regla hermética que la bandeja
 * inferior. Cajas pequeñas (sin sub-contenedores ni es_inmueble) sin casillero
 * y objetos sin contenedor que estén sueltos (sin ubicación o sin coordenadas).
 */
function chipsSueltos(): ChipCarga[] {
  const contenedoresSueltos: ChipCarga[] = contenedores
    .filter((c) => (Number(c.subcontenedores_count) || 0) === 0)
    .filter((c) => !c.es_inmueble)
    .filter((c) => sinCasillero(c))
    .map((c) => ({ id: c.id, nombre: c.nombre, tipo: 'contenedor' as const }));

  const objetosSueltos: ChipCarga[] = objetos
    .filter((o) => !o.deleted_at)
    .filter((o) => !o.contenedor)
    .filter((o) => o.ubicacion == null || sinCasillero(o))
    .map((o) => ({ id: o.id, nombre: o.nombre, tipo: 'objeto' as const }));

  return [...contenedoresSueltos, ...objetosSueltos];
}

/**
 * Contenedores «que ya tienen ubicación» de la habitación activa y que además
 * contienen objetos internos (útil para el inspector de cambio de contenedor).
 */
function contenedoresUbicadosConObjetos(): ContenedorCarga[] {
  if (!roomId) return [];
  const conObjetos = new Set<string>();
  for (const o of objetos) {
    if (!o.deleted_at && o.contenedor) conObjetos.add(o.contenedor);
  }
  return contenedores
    .filter((c) => c.ubicacion === roomId)
    .filter((c) => conObjetos.has(c.id))
    .sort(
      (a, b) =>
        (Number(b.objetos_count) || 0) - (Number(a.objetos_count) || 0) ||
        a.nombre.localeCompare(b.nombre, 'es'),
    );
}

function objetosInternosDe(contenedorId: string): ObjetoCarga[] {
  return objetos
    .filter((o) => !o.deleted_at && o.contenedor === contenedorId)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Imagen icónica de un contenedor: archivador si es mueble/estante, caja si no. */
function imagenDeContenedor(c: ContenedorCarga): string {
  return (Number(c.subcontenedores_count) || 0) > 0 || Boolean(c.es_inmueble)
    ? IMG_CONTENEDOR_GRANDE
    : IMG_CONTENEDOR_PEQUENO;
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
// RENDER (HTML puro; selectores globales del CSS de carga fina)
// =============================================================================

function chipHtml(chip: ChipCarga): string {
  if (chip.tipo === 'contenedor') {
    return `<span class="bandeja-chip" draggable="true" data-cf-dnd="${chip.id}" data-cf-tipo="contenedor" title="Arrastrá «${escapeHtml(chip.nombre)}» a un casillero del mueble para fijar su coordenada">
      <img src="${IMG_CONTENEDOR_PEQUENO}" alt="" class="bandeja-chip-img" draggable="false" />
      <span class="bandeja-chip-nombre">${escapeHtml(chip.nombre)}</span>
    </span>`;
  }
  return `<span class="bandeja-chip" draggable="true" data-cf-dnd="${chip.id}" data-cf-tipo="objeto" title="Arrastrá «${escapeHtml(chip.nombre)}» a un casillero del mueble para fijar su coordenada">
    <img src="${IMG_OBJETO}" alt="" class="bandeja-chip-img bandeja-chip-img-objeto" draggable="false" />
    <span class="bandeja-chip-nombre">${escapeHtml(chip.nombre)}</span>
  </span>`;
}

function objetoInternoHtml(o: ObjetoCarga): string {
  return `<span class="bandeja-chip" draggable="true" data-cf-dnd="${o.id}" data-cf-tipo="objeto" title="Arrastrá «${escapeHtml(o.nombre)}» a un casillero del mueble para cambiarle el contenedor">
    <img src="${IMG_OBJETO}" alt="" class="bandeja-chip-img bandeja-chip-img-objeto" draggable="false" />
    <span class="bandeja-chip-nombre">${escapeHtml(o.nombre)}</span>
  </span>`;
}

function contenedorHtml(c: ContenedorCarga): string {
  const abierto = contenedorSeleccionadoId === c.id;
  const internos = abierto ? objetosInternosDe(c.id) : [];
  const cuerpo = abierto
    ? `<div class="cf-contenedor-cuerpo">
        <span class="cf-sub-titulo">Objetos internos — tomalos y soltalos en un estante del mueble</span>
        <div class="cf-objetos">
          ${internos.length ? internos.map(objetoInternoHtml).join('') : '<div class="cf-vacio">Este contenedor no tiene objetos internos.</div>'}
        </div>
      </div>`
    : '';
  return `<article class="cf-contenedor${abierto ? ' cf-contenedor-abierto' : ''}">
    <button type="button" class="cf-contenedor-cab" data-cf-cont-toggle="${c.id}" aria-expanded="${abierto ? 'true' : 'false'}" title="Ver los objetos internos de «${escapeHtml(c.nombre)}»">
      <img src="${imagenDeContenedor(c)}" alt="" class="cf-contenedor-img" draggable="false" />
      <span class="cf-contenedor-nombre">${escapeHtml(c.nombre)}</span>
      <span class="cf-contenedor-meta">${Number(c.objetos_count) || 0} obj</span>
      <span class="cf-chevron" aria-hidden="true">${abierto ? '▴' : '▾'}</span>
    </button>
    ${cuerpo}
  </article>`;
}

function listadoAcordeonHtml(): string {
  const ubicados = contenedoresUbicadosConObjetos();
  if (!dataCargado) {
    return '<div class="cf-vacio">⏳ Cargando contenedores con ubicación…</div>';
  }
  if (!ubicados.length) {
    return roomId
      ? '<div class="cf-vacio">📭 No hay contenedores con objetos internos en «' + escapeHtml(roomNombre || 'esta habitación') + '» todavía.</div>'
      : '<div class="cf-vacio">👈 Seleccioná una habitación para inspeccionar sus contenedores.</div>';
  }
  return ubicados.map(contenedorHtml).join('');
}

function render(): void {
  if (!rootEl) return;
  const sueltos = chipsSueltos();
  if (contenedorSeleccionadoId && !objetos.some((o) => o.contenedor === contenedorSeleccionadoId)) {
    contenedorSeleccionadoId = null;
  }

  const sueltosHtml = sueltos.length
    ? sueltos.map(chipHtml).join('')
    : '<div class="cf-vacio">✨ No hay objetos ni cajas sin ubicar. Soltá un elemento desde un casillero del mueble para extraerlo y aparecerá acá.</div>';

  const cuerpoAcordeon = acordeonAbierto ? listadoAcordeonHtml() : '';

  rootEl.innerHTML = `
  <div class="cf-panel">
    <!-- BLOQUE SUPERIOR: objetos y cajas huérfanos / sin ubicación -->
    <section class="cf-bloque">
      <div class="cf-bloque-cab">
        <span class="cf-bloque-titulo">🫳 A primera vista · por ubicar</span>
        <span class="cf-bloque-badge">${sueltos.length}</span>
      </div>
      <p class="cf-bloque-hint">Objetos 🧸 y cajas 📦 sin casillero asignado. Arrastralos hacia un estante del mueble (panel izquierdo).</p>
      <div class="cf-chips">${sueltosHtml}</div>
    </section>

    <!-- BLOQUE INFERIOR: inspector "Cambiar Contenedor" (acordeón async) -->
    <section class="cf-bloque cf-acordeon${acordeonAbierto ? ' cf-acordeon-abierto' : ''}">
      <button type="button" class="cf-acordeon-toggle" data-cf-toggle-accordeon aria-expanded="${acordeonAbierto ? 'true' : 'false'}">
        <span class="cf-bloque-titulo">🔄 Cambiar Contenedor</span>
        <span class="cf-bloque-badge">${roomId ? contenedoresUbicadosConObjetos().length : 0}</span>
        <span class="cf-chevron" aria-hidden="true">▾</span>
      </button>
      <p class="cf-bloque-hint">Contenedores con ubicación que ya tienen objetos internos. Elegí uno y tomá sus objetos para mudarlos al mueble activo.</p>
      <div class="cf-acordeon-cuerpo">${cuerpoAcordeon}</div>
    </section>
  </div>`;
  enlazar();
}

// =============================================================================
// EVENTOS
// =============================================================================

function enlazar(): void {
  if (!rootEl) return;

  // Origen de arrastre: chips sueltos (bloque superior) y objetos internos
  // (acordeón). Emiten los MIME types que las Drop Zones del mueble consumen.
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

  // Selección de un contenedor: despliega sus objetos internos en chips compactos.
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




