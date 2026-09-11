// =============================================================================
// NIVEL 4 - DETALLE DE LA CAJA / ESTANTE (canvas izquierdo + objetos a la derecha)
// -----------------------------------------------------------------------------
// Cierre del flujo de portales: al hacer clic sobre una caja/estante del mueble
// (Nivel 3) en modo NAVEGACIÓN, esa pieza "pasa al LADO IZQUIERDO" como canvas
// (con sus casilleros internos en formato de tiles) y el LADO DERECHO carga de
// forma asíncrona el LISTADO FINO DE OBJETOS con su ubicación exacta F·C.
//
// Persistencia/lectura multi-tenant estricta (JWT + X-Estok-Id):
//   GET /api/objetos/?contenedor={id}    → objetos DIRECTOS de la caja (Nivel 4)
//   GET /api/contenedores/?padre={id}    → sub-cajas/estantes internos DIRECTOS
//
// IMPORTANTE: el parámetro REAL de hijos directos del backend es `?padre=`
// (ver inventario/api/viewsets/organizacion.py → get_queryset). Un `?parent_contenedor=`
// es ignorado por DRF y devuelve TODO el padrón de contenedores del Estok: eso era
// lo que multiplicaba las tarjetas falsas en la Escena 4. El mapeo se hace igualmente
// ESTRICTO en el cliente por ID primario + relación jerárquica directa, con dedupe.
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
  fila: number | null;
  col: number | null;
}

/** Sub-caja/estante DIRECTO de la caja activa, con los objetos que aloja dentro. */
interface CajaInterna {
  id: string;
  nombre: string;
  fila: number | null;
  col: number | null;
  objetos: ItemFino[];
}

const IMG_OBJETO = '/fluffy_plush_ball.jpg';

let actual: CajaSeleccionada | null = null;
let raizIzq: HTMLElement | null = null;
let raizDer: HTMLElement | null = null;
/** Sub-cajas internas DIRECTAS (Nivel 4): relación estricta por `parent_contenedor`. */
let subcajas: CajaInterna[] = [];
/** Objetos alojados DIRECTAMENTE en la caja activa (no dentro de una sub-caja). */
let objetosSueltos: ItemFino[] = [];

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

/** Entero o null: descarta NaN/'' sin inventar coordenadas fantasma. */
function enteroONull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function etiquetaFC(fila: number | null, col: number | null): string {
  return fila != null && col != null ? `F${fila}·C${col}` : 'sin casillero';
}

/**
 * Mapeo ESTRICTO de las sub-cajas internas del Nivel 4 (sin cruces con la tabla
 * de Objetos):
 *   - Solo la relación jerárquica DIRECTA (`parent_contenedor === caja.id`).
 *   - Deduplicado por ID PRIMARIO único: nunca dos tarjetas para el mismo registro.
 */
function mapearSubcajas(raw: Record<string, unknown>[], padreId: string): CajaInterna[] {
  const vistos = new Set<string>();
  const items: CajaInterna[] = [];
  for (const c of raw) {
    if (c.deleted_at) continue;
    if (c.parent_contenedor == null || String(c.parent_contenedor) !== padreId) continue;
    const id = String(c.id ?? '');
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    items.push({
      id,
      nombre: String(c.nombre || 'Caja'),
      fila: enteroONull(c.parent_grid_row),
      col: enteroONull(c.parent_grid_col),
      objetos: [],
    });
  }
  return items.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Objetos DIRECTOS de una caja: relación estricta (`contenedor === cajaId`) + ID único. */
function mapearObjetos(raw: Record<string, unknown>[], cajaId: string): ItemFino[] {
  const vistos = new Set<string>();
  const items: ItemFino[] = [];
  for (const o of raw) {
    if (o.deleted_at) continue;
    if (String(o.contenedor ?? '') !== cajaId) continue;
    const id = String(o.id ?? '');
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    items.push({
      id,
      nombre: String(o.nombre || 'Objeto'),
      fila: enteroONull(o.parent_grid_row),
      col: enteroONull(o.parent_grid_col),
    });
  }
  return items.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
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
  const caja = actual;

  // 1) Sub-cajas internas DIRECTAS: `?padre=` es el parámetro REAL del backend.
  //    (El antiguo `?parent_contenedor=` era ignorado por DRF y devolvía TODO el
  //    padrón de contenedores: de ahí las tarjetas falsas multiplicadas.)
  const contsRaw = await fetchTodos(`${API_BASE_URL}/contenedores/?padre=${caja.id}&page_size=1000`);
  subcajas = mapearSubcajas(contsRaw, caja.id);

  // 2) Objetos por relación DIRECTA: la caja activa + cada sub-caja interna,
  //    en una única pasada por contenedor (sin cruzar IDs entre tablas).
  const ids = [caja.id, ...subcajas.map((c) => c.id)];
  const listas = await Promise.all(
    ids.map((id) => fetchTodos(`${API_BASE_URL}/objetos/?contenedor=${id}&page_size=1000`)),
  );
  const porCaja = new Map<string, ItemFino[]>();
  ids.forEach((id, i) => porCaja.set(id, mapearObjetos(listas[i], id)));
  subcajas.forEach((c) => {
    c.objetos = porCaja.get(c.id) ?? [];
  });
  objetosSueltos = porCaja.get(caja.id) ?? [];

  renderCanvas();
  renderLista();
}

/** Canvas del Nivel 4 (izquierda): la caja activa con sus casilleros internos en tiles. */
function renderCanvas(): void {
  if (!raizIzq || !actual) return;
  const piezas = [
    ...subcajas.map((c) => ({ tipo: 'contenedor' as const, nombre: c.nombre, fila: c.fila, col: c.col })),
    ...objetosSueltos.map((o) => ({ tipo: 'objeto' as const, nombre: o.nombre, fila: o.fila, col: o.col })),
  ];
  const tiles = piezas
    .map(
      (p) => `<span class="caja-tile" title="${escapeHtml(p.nombre)} · ${etiquetaFC(p.fila, p.col)}">
      ${
        p.tipo === 'objeto'
          ? `<img src="${IMG_OBJETO}" alt="" style="width:18px;height:18px;border-radius:999px;object-fit:cover" />`
          : `<span class="caja-tile-ico" aria-hidden="true">📦</span>`
      }
      <span class="caja-tile-nombre">${escapeHtml(p.nombre)}</span>
    </span>`,
    )
    .join('');

  raizIzq.innerHTML = `
    <div class="caja-detalle">
      <div class="caja-detalle-cab">
        <span class="caja-detalle-ico" aria-hidden="true">📦</span>
        <div>
          <div class="caja-detalle-nombre">${escapeHtml(actual.nombre)}</div>
          <div class="caja-detalle-meta">${subcajas.length} caja(s) interna(s) · ${objetosSueltos.length} objeto(s) · ${
            actual.fila != null && actual.col != null ? `origen F${actual.fila}·C${actual.col}` : 'pieza libre'
          }</div>
        </div>
      </div>
      <div class="caja-detalle-lienzo">
        ${
          piezas.length
            ? `<div class="caja-detalle-tiles">${tiles}</div>`
            : '<div class="caja-vacio">Caja vacía: todavía no tiene objetos ni cajas internas.</div>'
        }
      </div>
    </div>`;
}

/** Viñeta de un objeto individual dentro del árbol viñetado del listado fino. */
function objetoVinetaHtml(o: ItemFino): string {
  return `<li class="caja-arbol-item">
    <span class="caja-arbol-vineta" aria-hidden="true">•</span>
    <img src="${IMG_OBJETO}" alt="" class="caja-arbol-img" />
    <span class="caja-arbol-nombre">${escapeHtml(o.nombre)}</span>
    <span class="caja-nodo-fc">${etiquetaFC(o.fila, o.col)}</span>
  </li>`;
}

/** Nodo COLAPSABLE (<details> cerrado por defecto) de una caja/estante interno. */
function cajaNodoHtml(c: CajaInterna): string {
  const total = c.objetos.length;
  const cuerpo = total
    ? `<ul class="caja-arbol-hijo">${c.objetos.map(objetoVinetaHtml).join('')}</ul>`
    : '<ul class="caja-arbol-hijo"><li class="caja-arbol-item caja-arbol-item-vacio">Caja vacía: todavía no tiene objetos.</li></ul>';
  return `<li class="caja-nodo">
    <details>
      <summary class="caja-nodo-cab" title="${escapeHtml(c.nombre)} · ${total} objeto(s)">
        <span class="caja-nodo-ico" aria-hidden="true">📦</span>
        <span class="caja-nodo-nombre">${escapeHtml(c.nombre)}</span>
        <span class="caja-nodo-chip">${total}</span>
        <span class="caja-nodo-fc">${etiquetaFC(c.fila, c.col)}</span>
        <span class="caja-nodo-chev" aria-hidden="true">▸</span>
      </summary>
      ${cuerpo}
    </details>
  </li>`;
}

/**
 * Listado fino de objetos (derecha) en ÁRBOL COLAPSABLE: las cajas reales del
 * interior se muestran compactas con <details>/<summary> cerrados por defecto y,
 * al desplegar una, se ve el árbol viñetado de los objetos que aloja.
 */
function renderLista(): void {
  if (!raizDer) return;
  const nodos = subcajas.map(cajaNodoHtml).join('');
  const sueltos = objetosSueltos.map(objetoVinetaHtml).join('');
  const arbol = nodos + sueltos;
  raizDer.innerHTML = `<div class="caja-arbol-lista">
    ${
      arbol
        ? `<ul class="caja-arbol">${arbol}</ul>`
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

