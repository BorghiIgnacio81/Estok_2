// =============================================================================
// ACCIONES OPERATIVAS DE LAS TARJETAS DE CONTENEDOR (SECCIÓN 1 y SECCIÓN 3)
// -----------------------------------------------------------------------------
// Sumario por categoría + fila de acciones fuera del <details>: Mover (azul),
// Editar (ficha técnica total con dimensiones + FOTO vía PUT multipart) y
// Eliminar (cartel unificado + DELETE: el backend libera el subárbol a la
// bandeja de huérfanos). Persistencia multi-tenant vía lib/api.ts.
// =============================================================================

import { apiPut, apiDelete, fetchAllPages } from './api';
import type { ApiError } from './api';
import { escapeHtml } from './mapaJerarquico';
import { confirmarEliminacionEstructura } from './confirmacionEliminar';
import {
  abrirOverlay,
  botonesModal,
  campoFoto,
  campoNumero,
  campoTexto,
  cerrarOverlay,
  CLASE_CONTROL,
  enlazarGuardado,
} from './cajaOperativaModal';

// ---------------------------------- TIPOS ------------------------------------
/** Metadatos mínimos de una caja/mueble (nodo del payload) para las acciones. */
export interface CajaOperable {
  id: string;
  nombre: string;
  descripcion?: string | null;
  material?: string | null;
  ubicacion?: string | null;
  parent_contenedor?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  /** Dimensiones físicas (cm) para la ficha técnica del modal «Editar». */
  largo?: number | string | null;
  ancho?: number | string | null;
  alto?: number | string | null;
  /** URL absoluta de la foto física actual (previsualización en el modal). */
  foto?: string | null;
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

/** Opciones de la fila de acciones: `mostrarMover:false` la reduce a Editar/Eliminar. */
export interface AccionesCajaOpts {
  mostrarMover?: boolean;
}

// ------------ 2. FILA DE ACCIONES (siempre visible, fuera del <details>) -----
/** Fila "Mover"/"Editar"/"Eliminar": los metadatos viajan como `data-*`. */
export function filaAccionesCajaHtml(caja: CajaOperable, opts: AccionesCajaOpts = {}): string {
  const mostrarMover = opts.mostrarMover !== false;
  const attrs = [
    'data-id="' + escapeHtml(caja.id) + '"',
    'data-nombre="' + escapeHtml(caja.nombre) + '"',
    'data-descripcion="' + escapeHtml(caja.descripcion || '') + '"',
    'data-material="' + escapeHtml(caja.material || '') + '"',
    'data-ubicacion="' + escapeHtml(caja.ubicacion || '') + '"',
    'data-parent="' + escapeHtml(caja.parent_contenedor || '') + '"',
    'data-fila="' + escapeHtml(caja.parent_grid_row ?? '') + '"',
    'data-col="' + escapeHtml(caja.parent_grid_col ?? '') + '"',
    'data-largo="' + escapeHtml(caja.largo ?? '') + '"',
    'data-ancho="' + escapeHtml(caja.ancho ?? '') + '"',
    'data-alto="' + escapeHtml(caja.alto ?? '') + '"',
    'data-foto="' + escapeHtml(caja.foto || '') + '"',
  ].join(' ');
  const base =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-base cursor-pointer';

  return '<div class="mt-auto flex items-center gap-2 border-t border-gray-100 px-4 py-3">'
    + (mostrarMover
      ? '<button type="button" class="js-mover-caja ' + base + ' bg-blue-600 hover:bg-blue-700" ' + attrs + '>📦 Mover</button>'
      : '')
    + '<button type="button" class="js-editar-caja ' + base + ' bg-slate-700 hover:bg-slate-800" ' + attrs + '>✏️ Editar</button>'
    + '<button type="button" class="js-eliminar-caja ' + base + ' bg-red-600 hover:bg-red-700 ml-auto" ' + attrs + '>🗑️ Eliminar</button>'
    + '</div>';
}

// ----------------------------- 3. HELPERS DE DOMINIO -------------------------
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
    largo: d.largo || null,
    ancho: d.ancho || null,
    alto: d.alto || null,
    foto: d.foto || null,
  };
}

// ------------- 4. MICRO-MODAL · EDITAR (ficha técnica total) -----------------
/**
 * Ficha técnica TOTAL del contenedor (caja o mueble): nombre, dimensiones
 * físicas (largo/ancho/alto), material, descripción y FOTOGRAFÍA. Persiste en
 * un único PUT multipart (FormData) con la auth multi-tenant centralizada.
 */
export function abrirModalEditarCaja(caja: CajaOperable): void {
  const { overlay, form } = abrirOverlay('Editar ficha técnica · ' + caja.nombre);
  const materialActual = String(caja.material || '');
  const opcionesMaterial = '<option value="">— Sin definir —</option>'
    + MATERIALES.map(([valor, etiqueta]) =>
      '<option value="' + valor + '"' + (valor === materialActual ? ' selected' : '') + '>' + etiqueta + '</option>',
    ).join('');

  form.innerHTML =
    campoTexto('Nombre del contenedor', 'nombre', { value: caja.nombre, required: true })
    + '<div class="grid grid-cols-3 gap-2">'
    + campoNumero('Largo (cm)', 'largo', String(caja.largo ?? ''))
    + campoNumero('Ancho (cm)', 'ancho', String(caja.ancho ?? ''))
    + campoNumero('Alto (cm)', 'alto', String(caja.alto ?? ''))
    + '</div>'
    + '<label class="block"><span class="block text-xs font-semibold text-gray-600 mb-1">Material</span>'
    + '<select name="material" class="' + CLASE_CONTROL + ' cursor-pointer">' + opcionesMaterial + '</select></label>'
    + '<label class="block"><span class="block text-xs font-semibold text-gray-600 mb-1">Descripción</span>'
    + '<textarea name="descripcion" rows="2" class="' + CLASE_CONTROL + ' resize-none">'
    + escapeHtml(caja.descripcion || '') + '</textarea></label>'
    + campoFoto(String(caja.foto || ''))
    + botonesModal('Guardar cambios');

  // Miniatura en vivo al elegir un archivo nuevo (antes de subirlo al backend).
  const inputFoto = form.querySelector<HTMLInputElement>('.js-foto-input');
  const preview = form.querySelector<HTMLElement>('.js-foto-preview');
  inputFoto?.addEventListener('change', () => {
    const archivo = inputFoto.files?.[0];
    if (!archivo || !preview) return;
    preview.innerHTML = '<img src="' + URL.createObjectURL(archivo) + '" alt="Nueva foto" class="h-20 w-20 rounded-xl object-cover border border-gray-200 bg-slate-50" />';
  });

  form.querySelector<HTMLInputElement>('[name="nombre"]')?.focus();

  enlazarGuardado(overlay, form, async () => {
    const nombre = (form.querySelector<HTMLInputElement>('[name="nombre"]')?.value || '').trim();
    if (!nombre) throw new Error('El nombre no puede quedar vacío.');
    const material = form.querySelector<HTMLSelectElement>('[name="material"]')?.value || '';
    const descripcion = form.querySelector<HTMLTextAreaElement>('[name="descripcion"]')?.value || '';

    // Ficha técnica total empaquetada MULTIPART: los strings y el binario de la
    // foto viajan juntos en un único FormData y se persisten en PostgreSQL en
    // caliente (apiPut con isFormData=true inyecta getAuthHeaders()).
    const datos = new FormData();
    datos.append('nombre', nombre);
    datos.append('descripcion', descripcion);
    datos.append('material', material);
    for (const campo of ['largo', 'ancho', 'alto']) {
      const valor = form.querySelector<HTMLInputElement>('[name="' + campo + '"]')?.value || '';
      if (valor !== '') datos.append(campo, valor);
    }
    const archivo = form.querySelector<HTMLInputElement>('[name="foto"]')?.files?.[0];
    if (archivo) datos.append('foto', archivo);

    await apiPut('/contenedores/' + encodeURIComponent(caja.id) + '/', datos, true);
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

// --------- 5bis. ELIMINACIÓN DE CONTENEDOR (resguardo de stock) --------------
/**
 * DELETE físico del contenedor tras el cartel unificado de protección de stock.
 * La tarjeta se remueve del DOM de forma inmediata (remoción optimista) y el
 * backend desancIa RECURSIVAMENTE su inventario hacia la bandeja de huérfanos
 * sin borrar los ítems físicos. Si la API falla, onRefrescar() re-sincroniza.
 */
async function eliminarCaja(caja: CajaOperable, btn: HTMLElement): Promise<void> {
  if (!caja.id) return;

  // Cartel obligatorio de advertencia (texto único compartido del proyecto).
  if (!confirmarEliminacionEstructura()) return;

  // Remoción visual instantánea: la tarjeta desaparece del DOM al confirmar.
  btn.closest('article')?.remove();

  const win = window as any;
  try {
    const exito = await apiDelete('/contenedores/' + encodeURIComponent(caja.id) + '/');
    if (!exito) {
      if (win.showError) win.showError('No se pudo eliminar «' + caja.nombre + '».');
    } else if (win.showSuccess) {
      win.showSuccess('🗑 «' + caja.nombre + '» eliminado. Su contenido quedó en la bandeja de «por ubicar».');
    }
  } catch {
    if (win.showError) win.showError('Error de conexión al eliminar el contenedor.');
  } finally {
    // Re-sincroniza con PostgreSQL: restaura la tarjeta si el DELETE falló.
    onRefrescar();
  }
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
      return;
    }

    const btnEliminar = target.closest('.js-eliminar-caja') as HTMLElement | null;
    if (btnEliminar) {
      evento.preventDefault();
      evento.stopPropagation();
      const caja = cajaDesdeBoton(btnEliminar);
      if (caja.id) void eliminarCaja(caja, btnEliminar);
    }
  });
}

