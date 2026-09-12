// =============================================================================
// ACCIONES OPERATIVAS DE LA CAJA (SECCIÓN 1 · Cajas e Inventario Interno)
// -----------------------------------------------------------------------------
// 1. SUMARIO DINÁMICO: agrupa los objetos directos por `categoria_nombre` y
//    resume el stock ("7 artesanías, 2 coleccionables"); vacío → "Contenedor vacío".
// 2. Botones "Mover" (azul) y "Editar" (gris) SIEMPRE visibles fuera del <details>;
//    abren micro-modales que hacen PUT /api/contenedores/{id}/ (JWT + X-Estok-Id)
//    reutilizando lib/api.ts (apiPut + fetchAllPages). Auth centralizada en auth.
// =============================================================================

import { apiPut, fetchAllPages } from './api';
import type { ApiError } from './api';
import { escapeHtml } from './mapaJerarquico';

// ---------------------------------- TIPOS ------------------------------------
/** Metadatos mínimos de una caja (NodoCaja del payload) para las acciones. */
export interface CajaOperable {
  id: string;
  nombre: string;
  descripcion?: string | null;
  material?: string | null;
  ubicacion?: string | null;
  parent_contenedor?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
}

interface UbicacionApi {
  id: string;
  nombre: string;
}

interface ContenedorApi {
  id: string;
  nombre: string;
  tipo?: string;
  parent_contenedor?: string | null;
}

/** Materiales admitidos por el modelo Contenedor (valor, etiqueta). */
const MATERIALES: Array<[string, string]> = [
  ['madera', 'Madera'], ['metal', 'Metal'], ['plastico', 'Plástico'],
  ['vidrio', 'Vidrio'], ['tela', 'Tela'], ['otro', 'Otro'],
];

const ID_OVERLAY = 'cajaOperativaOverlay';

const CLASE_CONTROL = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-100 disabled:text-gray-400';

type Refrescar = () => void;

let onRefrescar: Refrescar = () => {};
let listenersListos = false;

// --------------------- 1. SUMARIO DINÁMICO POR CATEGORÍA ---------------------
/** Agrupa los objetos directos por categoría y resume el stock de la caja. */
export function sumarioCategoriasHtml(contenido: unknown): string {
  const items = Array.isArray(contenido) ? contenido : [];
  const conteo = new Map<string, number>();
  let total = 0;

  for (const item of items) {
    const obj = item as Record<string, unknown> | null;
    if (!obj || obj.tipo !== 'objeto') continue;
    const categoria = String(obj.categoria_nombre || '').trim() || 'sin categoría';
    conteo.set(categoria, (conteo.get(categoria) || 0) + 1);
    total += 1;
  }

  const base = 'block text-[11px] text-gray-400 mt-1 leading-snug';
  if (total === 0) {
    return '<span class="' + base + ' italic">Contenedor vacío</span>';
  }

  const partes = Array.from(conteo.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'es'))
    .map(([nombre, cantidad]) => cantidad + ' ' + nombre.toLowerCase());

  return '<span class="' + base + '">' + escapeHtml(partes.join(', ')) + '</span>';
}

// ------------ 2. FILA DE ACCIONES (siempre visible, fuera del <details>) -----
/** Fila "Mover"/"Editar": los metadatos viajan como `data-*` (sin estado global). */
export function filaAccionesCajaHtml(caja: CajaOperable): string {
  const attrs = [
    'data-id="' + escapeHtml(caja.id) + '"',
    'data-nombre="' + escapeHtml(caja.nombre) + '"',
    'data-descripcion="' + escapeHtml(caja.descripcion || '') + '"',
    'data-material="' + escapeHtml(caja.material || '') + '"',
    'data-ubicacion="' + escapeHtml(caja.ubicacion || '') + '"',
    'data-parent="' + escapeHtml(caja.parent_contenedor || '') + '"',
    'data-fila="' + escapeHtml(caja.parent_grid_row ?? '') + '"',
    'data-col="' + escapeHtml(caja.parent_grid_col ?? '') + '"',
  ].join(' ');
  const base =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-base cursor-pointer';

  return '<div class="mt-auto flex items-center gap-2 border-t border-gray-100 px-4 py-3">'
    + '<button type="button" class="js-mover-caja ' + base + ' bg-blue-600 hover:bg-blue-700" ' + attrs + '>📦 Mover</button>'
    + '<button type="button" class="js-editar-caja ' + base + ' bg-slate-700 hover:bg-slate-800" ' + attrs + '>✏️ Editar</button>'
    + '</div>';
}

// ----------------------------- 3. UTILIDADES DE MODAL ------------------------
function enteroONull(valor: string): number | null {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : null;
}

function cajaDesdeBoton(btn: HTMLElement): CajaOperable {
  const d = btn.dataset;
  return {
    id: d.id || '',
    nombre: d.nombre || 'esta caja',
    descripcion: d.descripcion || '',
    material: d.material || '',
    ubicacion: d.ubicacion || null,
    parent_contenedor: d.parent || null,
    parent_grid_row: enteroONull(d.fila || ''),
    parent_grid_col: enteroONull(d.col || ''),
  };
}

function alPresionarEscape(evento: KeyboardEvent): void {
  if (evento.key === 'Escape') cerrarOverlay();
}

function cerrarOverlay(): void {
  document.getElementById(ID_OVERLAY)?.remove();
  document.removeEventListener('keydown', alPresionarEscape);
}

/** Crea el overlay + el <form> y devuelve ambos nodos listos para hidratar. */
function abrirOverlay(titulo: string): { overlay: HTMLElement; form: HTMLFormElement } {
  cerrarOverlay();

  const overlay = document.createElement('div');
  overlay.id = ID_OVERLAY;
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50';
  overlay.innerHTML =
    '<div class="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">'
    + '<div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">'
    + '<h3 class="text-sm font-bold text-gray-900">' + escapeHtml(titulo) + '</h3>'
    + '<button type="button" class="js-cerrar-overlay text-gray-400 hover:text-gray-700 cursor-pointer" aria-label="Cerrar">✕</button>'
    + '</div>'
    + '<p class="js-overlay-error hidden mx-4 mt-3 text-xs font-medium text-red-600"></p>'
    + '<form class="js-overlay-form p-4 pt-3 space-y-3" novalidate></form>'
    + '</div>';

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (evento) => {
    const target = evento.target as HTMLElement | null;
    if (evento.target === overlay || (target && target.closest && target.closest('.js-cerrar-overlay'))) {
      cerrarOverlay();
    }
  });
  document.addEventListener('keydown', alPresionarEscape);

  return {
    overlay,
    form: overlay.querySelector('.js-overlay-form') as HTMLFormElement,
  };
}

function mostrarErrorOverlay(overlay: HTMLElement, mensaje: string): void {
  const el = overlay.querySelector('.js-overlay-error') as HTMLElement | null;
  if (!el) return;
  el.textContent = mensaje;
  el.classList.remove('hidden');
}

function limpiarErrorOverlay(overlay: HTMLElement): void {
  const el = overlay.querySelector('.js-overlay-error') as HTMLElement | null;
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

function botonesModal(textoGuardar: string): string {
  return '<div class="flex items-center justify-end gap-2 pt-1">'
    + '<button type="button" class="js-cerrar-overlay px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 cursor-pointer">Cancelar</button>'
    + '<button type="submit" class="js-guardar px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 cursor-pointer">'
    + escapeHtml(textoGuardar) + '</button>'
    + '</div>';
}

function campoTexto(
  label: string,
  nombre: string,
  opts: { value?: string; required?: boolean; placeholder?: string } = {},
): string {
  return '<label class="block"><span class="block text-xs font-semibold text-gray-600 mb-1">' + escapeHtml(label) + '</span>'
    + '<input type="text" name="' + nombre + '" value="' + escapeHtml(opts.value || '') + '"'
    + (opts.required ? ' required' : '')
    + (opts.placeholder ? ' placeholder="' + escapeHtml(opts.placeholder) + '"' : '')
    + ' class="' + CLASE_CONTROL + '" /></label>';
}

/** Enlaza el submit con bloqueo del botón, feedback de error y cierre al éxito. */
function enlazarGuardado(
  overlay: HTMLElement,
  form: HTMLFormElement,
  guardar: () => Promise<void>,
): void {
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limpiarErrorOverlay(overlay);
    const btn = form.querySelector('.js-guardar') as HTMLButtonElement | null;
    const original = btn ? btn.textContent || 'Guardar' : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Guardando…';
    }
    guardar().catch((err: unknown) => {
      const apiErr = err as ApiError;
      const mensaje = apiErr && apiErr.error ? apiErr.error : 'No se pudo guardar. Reintentá.';
      mostrarErrorOverlay(overlay, '⚠️ ' + mensaje);
      if (btn) {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  });
}

// ------------- 4. MICRO-MODAL · EDITAR (ficha técnica del contenedor) --------
/** Abre la ficha técnica del contenedor para renombrarlo (y editar material/desc.). */
export function abrirModalEditarCaja(caja: CajaOperable): void {
  const { overlay, form } = abrirOverlay('Editar ficha técnica · ' + caja.nombre);
  const materialActual = String(caja.material || '');
  const opcionesMaterial = '<option value="">— Sin definir —</option>'
    + MATERIALES.map(([valor, etiqueta]) =>
      '<option value="' + valor + '"' + (valor === materialActual ? ' selected' : '') + '>' + etiqueta + '</option>',
    ).join('');

  form.innerHTML =
    campoTexto('Nombre del contenedor', 'nombre', { value: caja.nombre, required: true })
    + '<label class="block"><span class="block text-xs font-semibold text-gray-600 mb-1">Material</span>'
    + '<select name="material" class="' + CLASE_CONTROL + ' cursor-pointer">' + opcionesMaterial + '</select></label>'
    + '<label class="block"><span class="block text-xs font-semibold text-gray-600 mb-1">Descripción</span>'
    + '<textarea name="descripcion" rows="3" class="' + CLASE_CONTROL + ' resize-none">'
    + escapeHtml(caja.descripcion || '') + '</textarea></label>'
    + botonesModal('Guardar cambios');

  form.querySelector<HTMLInputElement>('[name="nombre"]')?.focus();

  enlazarGuardado(overlay, form, async () => {
    const datos = new FormData(form);
    const nombre = String(datos.get('nombre') || '').trim();
    if (!nombre) throw new Error('El nombre no puede quedar vacío.');
    const material = String(datos.get('material') || '');
    await apiPut('/contenedores/' + encodeURIComponent(caja.id) + '/', {
      nombre,
      descripcion: String(datos.get('descripcion') || ''),
      material: material || null,
    });
    cerrarOverlay();
    onRefrescar();
  });
}

// -------- 5. MICRO-MODAL · MOVER (habitación o mueble/estante destino) -------
/** Un contenedor sólo puede colgar de sus ancestros-hermanos, nunca de un hijo. */
function esDescendiente(
  candidatoId: string,
  ancestroId: string,
  padrePorId: Map<string, string | null>,
): boolean {
  const visitados = new Set<string>();
  let actual = padrePorId.get(candidatoId) ?? null;
  while (actual && !visitados.has(actual)) {
    if (actual === ancestroId) return true;
    visitados.add(actual);
    actual = padrePorId.get(actual) ?? null;
  }
  return false;
}

/** Abre el micro-modal para mover la caja a otra habitación o a un mueble/estante. */
export async function abrirModalMoverCaja(caja: CajaOperable): Promise<void> {
  const { overlay, form } = abrirOverlay('Mover caja · ' + caja.nombre);
  form.innerHTML = '<p class="text-sm text-gray-500">⏳ Cargando destinos…</p>';

  let ubicaciones: UbicacionApi[] = [];
  let muebles: ContenedorApi[] = [];
  try {
    const [ubi, contenedores] = await Promise.all([
      fetchAllPages<UbicacionApi>('/ubicaciones/', { page_size: '1000' }),
      fetchAllPages<ContenedorApi>('/contenedores/', { page_size: '1000' }),
    ]);
    ubicaciones = ubi;
    const padrePorId = new Map<string, string | null>();
    for (const c of contenedores) padrePorId.set(c.id, c.parent_contenedor ?? null);
    muebles = contenedores.filter((c) =>
      c.tipo === 'MUEBLE' && c.id !== caja.id && !esDescendiente(c.id, caja.id, padrePorId),
    );
  } catch (err) {
    const apiErr = err as ApiError;
    const detalle = apiErr && apiErr.error ? ' ' + apiErr.error : '';
    form.innerHTML = '<p class="text-sm text-red-600">No se pudieron cargar los destinos.' + escapeHtml(detalle) + '</p>'
      + '<div class="flex justify-end"><button type="button" class="js-cerrar-overlay px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 cursor-pointer">Cerrar</button></div>';
    return;
  }

  const opcionesUbicacion = '<option value="">— Seleccioná una habitación —</option>'
    + ubicaciones.map((u) =>
      '<option value="' + escapeHtml(u.id) + '"' + (u.id === caja.ubicacion ? ' selected' : '') + '>' + escapeHtml(u.nombre) + '</option>',
    ).join('');
  const opcionesMueble = '<option value="">— Ninguno (nivel raíz de la habitación) —</option>'
    + muebles.map((m) =>
      '<option value="' + escapeHtml(m.id) + '"' + (m.id === caja.parent_contenedor ? ' selected' : '') + '>' + escapeHtml(m.nombre) + '</option>',
    ).join('');
  const valorFila = caja.parent_grid_row != null ? String(caja.parent_grid_row) : '';
  const valorCol = caja.parent_grid_col != null ? String(caja.parent_grid_col) : '';

  form.innerHTML =
    '<label class="block"><span class="block text-xs font-semibold text-gray-600 mb-1">Habitación / espacio</span>'
    + '<select name="ubicacion" class="' + CLASE_CONTROL + ' cursor-pointer">' + opcionesUbicacion + '</select></label>'
    + '<label class="block"><span class="block text-xs font-semibold text-gray-600 mb-1">Mueble / estante que la contiene</span>'
    + '<select name="parent_contenedor" class="' + CLASE_CONTROL + ' cursor-pointer">' + opcionesMueble + '</select></label>'
    + '<div class="grid grid-cols-2 gap-3">'
    + '<label class="block"><span class="block text-xs font-semibold text-gray-600 mb-1">Fila (casillero)</span>'
    + '<input type="number" min="1" name="parent_grid_row" value="' + escapeHtml(valorFila) + '" class="' + CLASE_CONTROL + '" /></label>'
    + '<label class="block"><span class="block text-xs font-semibold text-gray-600 mb-1">Columna (casillero)</span>'
    + '<input type="number" min="1" name="parent_grid_col" value="' + escapeHtml(valorCol) + '" class="' + CLASE_CONTROL + '" /></label>'
    + '</div>'
    + '<p class="text-[11px] text-gray-400">Si elegís un mueble, la caja hereda su habitación; si no, se ubica a nivel raíz de la habitación elegida.</p>'
    + botonesModal('Mover caja');

  const selUbicacion = form.querySelector<HTMLSelectElement>('[name="ubicacion"]');
  const selParent = form.querySelector<HTMLSelectElement>('[name="parent_contenedor"]');
  const inputFila = form.querySelector<HTMLInputElement>('[name="parent_grid_row"]');
  const inputCol = form.querySelector<HTMLInputElement>('[name="parent_grid_col"]');

  const sincronizarCoords = (): void => {
    const dentroDeMueble = Boolean(selParent && selParent.value);
    if (inputFila) inputFila.disabled = !dentroDeMueble;
    if (inputCol) inputCol.disabled = !dentroDeMueble;
    if (selUbicacion) selUbicacion.disabled = dentroDeMueble;
  };
  selParent?.addEventListener('change', sincronizarCoords);
  sincronizarCoords();

  enlazarGuardado(overlay, form, async () => {
    const parentId = selParent ? selParent.value : '';
    const payload: Record<string, unknown> = {};

    if (parentId) {
      payload.parent_contenedor = parentId;
      payload.parent_grid_row = enteroONull(inputFila ? inputFila.value : '');
      payload.parent_grid_col = enteroONull(inputCol ? inputCol.value : '');
    } else {
      const ubicacionId = selUbicacion ? selUbicacion.value : '';
      if (!ubicacionId) throw new Error('Seleccioná una habitación o un mueble destino.');
      payload.parent_contenedor = null;
      payload.parent_grid_row = null;
      payload.parent_grid_col = null;
      payload.ubicacion = ubicacionId;
    }

    await apiPut('/contenedores/' + encodeURIComponent(caja.id) + '/', payload);
    cerrarOverlay();
    onRefrescar();
  });
}

// ------------------ 6. ENTRADA PÚBLICA · DELEGACIÓN DE EVENTOS ---------------
/** Delegación de clic de "Mover"/"Editar"; `refrescar` re-pinta tras el PUT. */
export function initCajaOperativa(refrescar: Refrescar): void {
  onRefrescar = refrescar;
  if (listenersListos) return;
  listenersListos = true;

  document.addEventListener('click', (evento) => {
    const target = evento.target as HTMLElement | null;
    if (!target || !target.closest) return;

    const btnMover = target.closest('.js-mover-caja') as HTMLElement | null;
    if (btnMover) {
      evento.preventDefault();
      evento.stopPropagation();
      const caja = cajaDesdeBoton(btnMover);
      if (caja.id) void abrirModalMoverCaja(caja);
      return;
    }

    const btnEditar = target.closest('.js-editar-caja') as HTMLElement | null;
    if (btnEditar) {
      evento.preventDefault();
      evento.stopPropagation();
      const caja = cajaDesdeBoton(btnEditar);
      if (caja.id) abrirModalEditarCaja(caja);
    }
  });
}

