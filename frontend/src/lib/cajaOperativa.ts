// =============================================================================
// ACCIONES OPERATIVAS DE LAS TARJETAS DE CONTENEDOR (SECCIÓN 1 y SECCIÓN 3)
// -----------------------------------------------------------------------------
// Sumario por categoría + fila de acciones fuera del <details>: Mover (azul),
// Editar (ficha técnica total con dimensiones + FOTO vía PUT multipart) y
// Eliminar (cartel unificado + DELETE: el backend libera el subárbol a la
// bandeja de huérfanos). Persistencia multi-tenant vía lib/api.ts.
// =============================================================================

import { apiPut, apiDelete } from './api';
import { escapeHtml } from './mapaJerarquico';
import { confirmarEliminacionEstructura } from './confirmacionEliminar';
// Asistente de movimiento por minimapas en cascada (modal «Mover»): el recorrido
// del plano, el PUT atómico y su render viven en módulos propios.
import { abrirMoverCajaMinimapas } from './moverContenedorMinimapas';
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
  /** Caja llena: contenido fotografiado como lote, no admite más objetos. */
  esta_llena?: boolean | null;
  /** Cantidad estimada de piezas del lote (opcional, sólo si está llena). */
  cantidad_objetos_lote?: number | string | null;
}

/** Materiales admitidos por el modelo Contenedor (valor, etiqueta). */
const MATERIALES: Array<[string, string]> = [
  ['madera', 'Madera'], ['metal', 'Metal'], ['plastico', 'Plástico'],
  ['vidrio', 'Vidrio'], ['tela', 'Tela'], ['otro', 'Otro'],
];

type Refrescar = () => void;

let onRefrescar: Refrescar = () => {};
let listenersListos = false;


// El SUMARIO de la caja (badge de estado + desglose por categoría) vive en
// lib/cajaEstadoBadge.ts (`sumarioCajaHtml`): fuente ÚNICA compartida con el
// canvas de Almacenamiento. Acá sólo quedan las acciones operativas.

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
    'data-esta-llena="' + (caja.esta_llena ? '1' : '0') + '"',
    'data-cantidad-lote="' + escapeHtml(caja.cantidad_objetos_lote ?? '') + '"',
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
    esta_llena: d.estaLlena === '1',
    // Cantidad del lote: 0/'' equivale a «sin cantidad» (no se fuerza a 1 como
    // en las coordenadas de casillero, donde el mínimo real es 1).
    cantidad_objetos_lote: d.cantidadLote && d.cantidadLote !== '0'
      ? Number(d.cantidadLote)
      : null,
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
    // CAJA LLENA / LOTE EN FOTO: el campo numérico sólo se despliega cuando el
    // operador declara la caja llena (contenido fotografiado, sin desglosar).
    + '<label class="flex items-start gap-2 p-2.5 rounded-lg border border-orange-200 bg-orange-50 cursor-pointer">'
    + '<input type="checkbox" name="esta_llena" class="js-caja-llena mt-0.5 w-4 h-4 text-orange-600 focus:ring-orange-500 rounded"'
    + (caja.esta_llena ? ' checked' : '') + ' />'
    + '<span class="text-xs font-medium text-gray-700">Caja llena <span class="font-normal">(contenido en foto / no admite más objetos)</span></span>'
    + '</label>'
    + '<label class="js-lote-campo block hidden"><span class="block text-xs font-semibold text-gray-600 mb-1">Cantidad estimada de objetos en el lote</span>'
    + '<input type="number" min="1" step="1" name="cantidad_objetos_lote" value="'
    + escapeHtml(caja.cantidad_objetos_lote ?? '')
    + '" placeholder="Ej: 40" class="' + CLASE_CONTROL + '" /></label>'
    + campoFoto(String(caja.foto || ''))
    + botonesModal('Guardar cambios');

  // Visibilidad CONDICIONAL del campo del lote: sólo con «Caja llena» activo.
  const checkLlena = form.querySelector<HTMLInputElement>('[name="esta_llena"]');
  const campoLote = form.querySelector<HTMLElement>('.js-lote-campo');
  const inputLote = form.querySelector<HTMLInputElement>('[name="cantidad_objetos_lote"]');
  const sincronizarLote = (): void => {
    const llena = Boolean(checkLlena?.checked);
    if (campoLote) campoLote.classList.toggle('hidden', !llena);
    if (!llena && inputLote) inputLote.value = '';
  };
  checkLlena?.addEventListener('change', sincronizarLote);
  sincronizarLote();

  // Miniatura en vivo al elegir un archivo nuevo (antes de subirlo al backend).
  const inputFoto = form.querySelector<HTMLInputElement>('.js-foto-input');
  const preview = form.querySelector<HTMLElement>('.js-foto-preview');
  inputFoto?.addEventListener('change', () => {
    const archivo = inputFoto.files?.[0];
    if (!archivo || !preview) return;
    preview.innerHTML = '<img src="' + URL.createObjectURL(archivo) + '" alt="Nueva foto" class="h-20 w-20 rounded-xl object-cover border border-gray-200 bg-slate-50" />';
  });

  // preventScroll: abrir la ficha no desplaza el lienzo bajo el dedo (iOS).
  form.querySelector<HTMLInputElement>('[name="nombre"]')?.focus({ preventScroll: true });

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

    // CAJA LLENA / LOTE: se envía SIEMPRE la bandera; la cantidad viaja como 0
    // cuando el operador dejó el campo vacío (el badge la ignora: sólo cuenta
    // cantidades > 0). Al destildar, el backend limpia la cantidad a null.
    const estaLlena = Boolean(form.querySelector<HTMLInputElement>('[name="esta_llena"]')?.checked);
    const cantidadLote = (form.querySelector<HTMLInputElement>('[name="cantidad_objetos_lote"]')?.value || '').trim();
    datos.append('esta_llena', estaLlena ? 'true' : 'false');
    datos.append('cantidad_objetos_lote', estaLlena && cantidadLote !== '' ? cantidadLote : '0');

    await apiPut('/contenedores/' + encodeURIComponent(caja.id) + '/', datos, true);
    cerrarOverlay();
    onRefrescar();
  });
}

// ------------- 5. MOVER (asistente de minimapas en cascada) -----------------

/**
 * Abre el ASISTENTE DE MOVIMIENTO POR MINIMAPAS en cascada del contenedor: el
 * usuario navega el plano elástico real del Estok activo (ambientes → muebles →
 * cajas) y el traslado se persiste con el PUT atómico de
 * lib/moverContenedorMinimapas.ts. Reemplaza por completo al viejo modal de
 * selectores de texto + coordenadas de casillero.
 */
export async function abrirModalMoverCaja(
  caja: CajaOperable,
  alRefrescar: Refrescar = onRefrescar,
): Promise<void> {
  await abrirMoverCajaMinimapas(
    { id: caja.id, nombre: caja.nombre, ubicacion: caja.ubicacion ?? null },
    alRefrescar,
  );
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

