// =============================================================================
// EDICIÓN DE OBJETO · SWITCH «¿ES UNA CAJA O CONTENEDOR?»
// -----------------------------------------------------------------------------
// Comportamiento del control ClasificacionContenedorEdicion.astro, que
// rectifica `Objeto.es_contenedor` desde /objetos/[id]/editar.
//
// Vive fuera de lib/editarObjetoForm.ts por la regla de modularización (<400
// líneas por archivo de UI): el orquestador sólo hidrata, lee y avisa.
//
// CAJA LLENA / LOTE EN FOTO: el bloque condicional del componente (checkbox +
// cantidad estimada) se gobierna acá. Sin `es_contenedor=True` no existe, y la
// cantidad sólo se muestra con el tilde activo.
//
// El backend es la AUTORIDAD FINAL: una categoría explícitamente contenedora
// («Cajas y Contenedores», «Cajas», «Baúles»…) o un rótulo que EMPIEZA por
// «Caja» conserva el flag aunque el switch se apague. Por eso el aviso posterior
// compara lo pedido contra el `es_contenedor` REALMENTE persistido.
// =============================================================================

import { refOpcional } from '../dom';

let checkbox: HTMLInputElement | null = null;
let estadoEl: HTMLElement | null = null;
// CAJA LLENA / LOTE EN FOTO: controles condicionales del formulario.
let filaCajaLlena: HTMLElement | null = null;
let estaLlenaCheck: HTMLInputElement | null = null;
let filaCantidadLote: HTMLElement | null = null;
let cantidadLoteInput: HTMLInputElement | null = null;

/** Muestra la cantidad estimada sólo con el tilde «Caja llena» activo. */
function sincronizarCantidadLote(): void {
  const llena = estaLlenaCheck?.checked === true;
  filaCantidadLote?.classList.toggle('hidden', !llena);
  if (!llena && cantidadLoteInput) cantidadLoteInput.value = '';
}

/** Refleja en el texto de ayuda la intención elegida con el switch. */
function pintarEstado(): void {
  if (!checkbox || !estadoEl) return;
  const esCaja = checkbox.checked;
  estadoEl.textContent = esCaja
    ? '📦 Se guardará como caja/contenedor: puede alojar otros objetos dentro.'
    : '🧸 Se guardará como objeto simple: dejará de listarse en «Cajas e Inventario Interno».';
  estadoEl.className = esCaja
    ? 'mt-3 text-xs font-medium text-orange-700'
    : 'mt-3 text-xs font-medium text-gray-500';
  // CAJA LLENA: el bloque sólo existe para cajas/contenedores. Al apagar el
  // switch se oculta y se descarta la declaración de lote.
  filaCajaLlena?.classList.toggle('hidden', !esCaja);
  if (!esCaja) {
    if (estaLlenaCheck) estaLlenaCheck.checked = false;
    sincronizarCantidadLote();
  }
}

/** Resuelve el control y conecta su feedback visual (idempotente). */
export function iniciarSwitchContenedor(): void {
  checkbox = refOpcional<HTMLInputElement>('es_contenedor');
  estadoEl = refOpcional<HTMLElement>('esContenedorEstado');
  filaCajaLlena = refOpcional<HTMLElement>('editarCajaLlenaRow');
  estaLlenaCheck = refOpcional<HTMLInputElement>('editarEstaLlena');
  filaCantidadLote = refOpcional<HTMLElement>('editarCantidadLoteRow');
  cantidadLoteInput = refOpcional<HTMLInputElement>('editarCantidadLote');
  if (!checkbox) return;
  if (checkbox.dataset.contenedorActivo !== 'true') {
    checkbox.dataset.contenedorActivo = 'true';
    checkbox.addEventListener('change', pintarEstado);
  }
  if (estaLlenaCheck && estaLlenaCheck.dataset.loteActivo !== 'true') {
    estaLlenaCheck.dataset.loteActivo = 'true';
    estaLlenaCheck.addEventListener('change', sincronizarCantidadLote);
  }
  pintarEstado();
}

/** Precarga el estado REAL que devolvió la API al abrir la edición. */
export function hidratarSwitchContenedor(
  esContenedor: unknown,
  estaLlena?: unknown,
  cantidadLote?: unknown,
): void {
  if (!checkbox) return;
  checkbox.checked = esContenedor === true;
  if (estaLlenaCheck) estaLlenaCheck.checked = estaLlena === true;
  if (cantidadLoteInput) {
    const cantidad = Number(cantidadLote);
    cantidadLoteInput.value =
      Number.isFinite(cantidad) && cantidad > 0 ? String(Math.floor(cantidad)) : '';
  }
  pintarEstado();
  sincronizarCantidadLote();
}

/** Clasificación elegida AHORA por el operador (se lee del DOM, sin estado duplicado). */
export function contenedorSeleccionado(): boolean {
  return checkbox?.checked === true;
}

/** «Caja llena» vigente: exige que el objeto siga declarado como contenedor. */
export function cajaLlenaSeleccionada(): boolean {
  return contenedorSeleccionado() && estaLlenaCheck?.checked === true;
}

/** Cantidad estimada del lote (null = sin lote declarado o campo vacío). */
export function cantidadLoteSeleccionada(): number | null {
  if (!cajaLlenaSeleccionada()) return null;
  const valor = Number((cantidadLoteInput?.value ?? '').trim());
  return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : null;
}

/**
 * Aviso para el toast según el valor persistido por el backend.
 *
 * Cadena VACÍA cuando lo pedido coincide con lo guardado (caso normal). Si el
 * backend conservó el flag por categoría/rótulo, lo informa explícitamente para
 * que la tarjeta no "desaparezca" de una sección sin explicación.
 */
export function avisoClasificacionPersistida(
  guardado: Record<string, any> | null | undefined,
): string {
  const solicitado = contenedorSeleccionado();
  const persistido = guardado?.['es_contenedor'] === true;
  if (solicitado === persistido) return '';
  return persistido
    ? ' · 📦 se conserva como contenedor por su categoría/rótulo'
    : ' · 🧸 quedó como objeto simple';
}
