// =============================================================================
// NIVEL 4 - DETALLE DE LA CAJA / ESTANTE (canvas izquierdo + objetos a la derecha)
// -----------------------------------------------------------------------------
// Cierre del flujo de portales: al hacer clic sobre una caja/estante del mueble
// (Nivel 3) en modo NAVEGACIÓN, esa pieza "pasa al LADO IZQUIERDO" como canvas
// (con sus casilleros internos en formato de tiles) y el LADO DERECHO carga de
// forma asíncrona el LISTADO FINO DE OBJETOS con su ubicación exacta F·C.
//
// Persistencia/lectura multi-tenant estricta (JWT + X-Estok-Id):
//   GET /api/objetos/?contenedor={id}             → objetos guardados en la caja
//   GET /api/contenedores/?parent_contenedor={id} → sub-cajas/bolsas internas
// =============================================================================

import { getAuthHeaders, API_BASE_URL, normalizarUrlApi } from '../services/auth';
import { escapeHtml } from './mapaJerarquico';

export interface CajaSeleccionada {
  id: string;
  nombre: string;
  fila?: number | null;
  col?: number | null;
}

interface ItemFino {
  id: string;
  nombre: string;
  tipo: 'objeto' | 'contenedor';
  fila: number | null;
  col: number | null;
}

const IMG_OBJETO = '/fluffy_plush_ball.jpg';
const IMG_CAJA = '/Nuevo Contenedor.png';

let actual: CajaSeleccionada | null = null;
let raizIzq: HTMLElement | null = null;
let raizDer: HTMLElement | null = null;

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
    nextUrl = normalizarUrlApi(data.next);
  }
  return todos;
}

function etiquetaFC(item: ItemFino): string {
  return item.fila && item.col ? `F${item.fila}·C${item.col}` : 'sin casillero';
}

function renderVacio(): void {
  if (raizIzq) {
    raizIzq.innerHTML = '<div class="caja-vacio">📦 Seleccioná una caja o estante del mueble para inspeccionarla.</div>';
  }
  if (raizDer) {
    raizDer.innerHTML = '<div class="caja-vacio">El listado fino de objetos aparecerá acá.</div>';
  }
}

async function cargar(): Promise<void> {
  if (!actual) {
    renderVacio();
    return;
  }
  const [objsData, contsData] = await Promise.all([
    fetchTodos(`${API_BASE_URL}/objetos/?contenedor=${actual.id}&page_size=1000`),
    fetchTodos(`${API_BASE_URL}/contenedores/?parent_contenedor=${actual.id}&page_size=1000`),
  ]);

  const items: ItemFino[] = [
    ...objsData
      .filter((o) => !o.deleted_at)
      .map((o) => ({
        id: String(o.id),
        nombre: String(o.nombre || 'Objeto'),
        tipo: 'objeto' as const,
        fila: o.parent_grid_row != null ? Number(o.parent_grid_row) : null,
        col: o.parent_grid_col != null ? Number(o.parent_grid_col) : null,
      })),
    ...contsData
      .filter((c) => !c.deleted_at)
      .map((c) => ({
        id: String(c.id),
        nombre: String(c.nombre || 'Caja'),
        tipo: 'contenedor' as const,
        fila: c.parent_grid_row != null ? Number(c.parent_grid_row) : null,
        col: c.parent_grid_col != null ? Number(c.parent_grid_col) : null,
      })),
  ];

  const objetos = items.filter((i) => i.tipo === 'objeto');
  const subcajas = items.filter((i) => i.tipo === 'contenedor');
  renderCanvas(items, objetos.length, subcajas.length);
  renderLista(items);
}

/** Canvas del Nivel 4 (izquierda): la caja activa con sus casilleros internos. */
function renderCanvas(items: ItemFino[], objetos: number, subcajas: number): void {
  if (!raizIzq || !actual) return;
  const tiles = items
    .map(
      (it) => `<span class="caja-tile" title="${escapeHtml(it.nombre)} · ${etiquetaFC(it)}">
      ${
        it.tipo === 'objeto'
          ? `<img src="${IMG_OBJETO}" alt="" style="width:18px;height:18px;border-radius:999px;object-fit:cover" />`
          : `<span class="caja-tile-ico" aria-hidden="true">📦</span>`
      }
      <span class="caja-tile-nombre">${escapeHtml(it.nombre)}</span>
    </span>`,
    )
    .join('');

  raizIzq.innerHTML = `
    <div class="caja-detalle">
      <div class="caja-detalle-cab">
        <span class="caja-detalle-ico" aria-hidden="true">📦</span>
        <div>
          <div class="caja-detalle-nombre">${escapeHtml(actual.nombre)}</div>
          <div class="caja-detalle-meta">${subcajas} caja(s) interna(s) · ${objetos} objeto(s) · ${
            actual.fila && actual.col ? `origen F${actual.fila}·C${actual.col}` : 'pieza libre'
          }</div>
        </div>
      </div>
      <div class="caja-detalle-lienzo">
        ${
          items.length
            ? `<div class="caja-detalle-tiles">${tiles}</div>`
            : '<div class="caja-vacio">Caja vacía: todavía no tiene objetos ni cajas internas.</div>'
        }
      </div>
    </div>`;
}

/** Listado fino de objetos (derecha) con su ubicación F·C exacta. */
function renderLista(items: ItemFino[]): void {
  if (!raizDer) return;
  raizDer.innerHTML = `
    <div class="caja-objetos-lista">
      ${
        items.length
          ? items
              .map(
                (it) => `<div class="caja-objeto-fila">
          <img src="${it.tipo === 'objeto' ? IMG_OBJETO : IMG_CAJA}" alt="" />
          <span class="caja-objeto-nombre">${escapeHtml(it.nombre)}</span>
          <span class="caja-detalle-meta" style="margin-left:auto">${etiquetaFC(it)}</span>
        </div>`,
              )
              .join('')
          : '<div class="caja-vacio">Sin objetos en esta caja.</div>'
      }
    </div>`;
}

/** Entrada del Nivel 4: escucha la selección en caliente de una caja/estante. */
export function initCajaDetalle(opts: { canvas?: HTMLElement | null; lista?: HTMLElement | null }): void {
  raizIzq = opts.canvas ?? null;
  raizDer = opts.lista ?? null;
  window.addEventListener('estok:caja-seleccionada', (e) => {
    actual = (e as CustomEvent<CajaSeleccionada>).detail ?? null;
    void cargar();
  });
  window.addEventListener('estok:espacios-cambiados', () => {
    if (actual) void cargar();
  });
  renderVacio();
}

