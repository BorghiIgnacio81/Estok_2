// =============================================================================
// TOGGLE RÁPIDO «CAJA LLENA» EN LAS TARJETAS (sin abrir el modal de edición)
// -----------------------------------------------------------------------------
// El badge de estado (lib/cajaEstadoBadge.ts) se renderiza como BOTÓN
// `.js-toggle-caja-llena` en las tarjetas de /objetos (SECCIÓN 1) y del tablero
// de /almacenamiento. Este módulo es el ÚNICO dueño de la interacción:
//
//   1. Clic en el badge → PATCH /api/contenedores/{id}/ parcial en segundo
//      plano (`esta_llena`). El badge se repinta EN EL SITIO (sin refetch y sin
//      perder el scroll de la página).
//   2. Al marcar LLENA se abre un popover mínimo para ingresar la cantidad
//      estimada del lote (ej. 40). Guardarla hace un segundo PATCH con
//      `cantidad_objetos_lote`; «Omitir» deja el badge en «Lote foto».
//   3. Al destildar se limpia la cantidad (la normaliza el serializer).
//
// Delegación global sobre document: sobrevive a los re-render en caliente de
// las tarjetas (filtros, drag & drop, recargas del tablero). Auth centralizada
// en lib/api.ts → services/auth (NUNCA se define una versión propia).
// =============================================================================

import { apiPatch } from './api';
import { badgeEstadoCajaHtml } from './cajaEstadoBadge';
import type { CajaEstadoFuente } from './cajaEstadoBadge';
import { showToast } from './toast';

/** Estado mínimo transportado por los `data-*` del badge interactivo. */
interface EstadoToggle {
  id: string;
  nombre: string;
  estaLlena: boolean;
  cantidadLote: number | null;
  objetos: number;
}

/** Evita enlazar dos veces la delegación si el arranque se repite. */
let listenersListos = false;
/** Popover abierto (sólo puede existir uno a la vez). */
let popoverAbierto: HTMLElement | null = null;
/** Listener de cierre por clic afuera del popover (se remueve al cerrar). */
let listenerFuera: ((evento: MouseEvent) => void) | null = null;

// -----------------------------------------------------------------------------
// LECTURA / REPINTADO DEL BADGE
// -----------------------------------------------------------------------------

/** Lee los `data-*` vigentes del badge (fuente única del estado en el DOM). */
function leerEstado(btn: HTMLElement): EstadoToggle {
  const datos = btn.dataset;
  const cantidad = Number(datos.cantidadLote);
  return {
    id: datos.id || '',
    nombre: datos.nombre || 'esta caja',
    estaLlena: datos.estaLlena === '1',
    cantidadLote: Number.isFinite(cantidad) && cantidad > 0 ? Math.floor(cantidad) : null,
    objetos: Math.max(0, Math.floor(Number(datos.objetos) || 0)),
  };
}

/** Adapta el estado del DOM al contrato de la fuente única de badges. */
function fuenteDe(estado: EstadoToggle): CajaEstadoFuente {
  return {
    id: estado.id,
    nombre: estado.nombre,
    esta_llena: estado.estaLlena,
    cantidad_objetos_lote: estado.cantidadLote,
    objetos_count: estado.objetos,
  };
}

/**
 * Repinta el badge en el sitio (mismo lugar del DOM) y devuelve el nuevo nodo.
 * El HTML lo produce la fuente única `badgeEstadoCajaHtml`, así el texto y el
 * color siguen exactamente las reglas del estado de la caja.
 */
function repintarBadge(btn: HTMLElement, estado: EstadoToggle): HTMLElement {
  btn.insertAdjacentHTML('beforebegin', badgeEstadoCajaHtml(fuenteDe(estado)));
  const nuevo = btn.previousElementSibling as HTMLElement | null;
  btn.remove();
  return nuevo || btn;
}

/** Bloquea el badge mientras viaja el PATCH (evita dobles clics). */
function bloquear(btn: HTMLElement): void {
  btn.setAttribute('aria-busy', 'true');
  btn.classList.add('opacity-60', 'pointer-events-none');
}

function desbloquear(btn: HTMLElement): void {
  btn.removeAttribute('aria-busy');
  btn.classList.remove('opacity-60', 'pointer-events-none');
}

// -----------------------------------------------------------------------------
// 1. ALTERNAR «CAJA LLENA» (PATCH parcial en segundo plano)
// -----------------------------------------------------------------------------

async function alternarCajaLlena(btn: HTMLElement): Promise<void> {
  const estado = leerEstado(btn);
  if (!estado.id) return;

  // Un nuevo clic en cualquier badge cancela el popover pendiente del anterior.
  cerrarPopoverCantidad();

  const marcarLlena = !estado.estaLlena;
  bloquear(btn);
  try {
    await apiPatch('/contenedores/' + encodeURIComponent(estado.id) + '/', marcarLlena
      // Al destildar, la cantidad se limpia explícitamente (el serializer la
      // normaliza a null; el badge sólo lee cantidades > 0).
      ? { esta_llena: true }
      : { esta_llena: false, cantidad_objetos_lote: null });

    const actualizado: EstadoToggle = {
      ...estado,
      estaLlena: marcarLlena,
      cantidadLote: marcarLlena ? estado.cantidadLote : null,
    };
    const nuevo = repintarBadge(btn, actualizado);

    if (marcarLlena) {
      // Mini-popover para la cantidad estimada del lote (opcional).
      abrirPopoverCantidad(nuevo);
    } else {
      showToast('🔓 «' + estado.nombre + '» ahora tiene espacio disponible.', 'success');
    }
  } catch {
    desbloquear(btn);
    showToast('No se pudo actualizar el estado de la caja.', 'error');
  }
}

// -----------------------------------------------------------------------------
// 2. POPOVER DE CANTIDAD ESTIMADA (sólo al marcar la caja como llena)
// -----------------------------------------------------------------------------

function cerrarPopoverCantidad(): void {
  if (listenerFuera) {
    document.removeEventListener('click', listenerFuera, true);
    listenerFuera = null;
  }
  popoverAbierto?.remove();
  popoverAbierto = null;
}

/** Posiciona el popover junto al badge, sin salirse del viewport. */
function posicionarPopover(popover: HTMLElement, btn: HTMLElement): void {
  const margen = 8;
  const rect = btn.getBoundingClientRect();
  const ancho = popover.offsetWidth || 288;
  const alto = popover.offsetHeight || 170;
  const izquierda = Math.min(
    Math.max(margen, rect.left),
    Math.max(margen, window.innerWidth - ancho - margen),
  );
  let arriba = rect.bottom + margen;
  if (arriba + alto > window.innerHeight - margen) {
    arriba = Math.max(margen, rect.top - alto - margen);
  }
  popover.style.left = izquierda + 'px';
  popover.style.top = arriba + 'px';
}

/** Guarda la cantidad estimada del lote con un PATCH parcial. */
async function guardarCantidad(popover: HTMLElement, btn: HTMLElement): Promise<void> {
  const estado = leerEstado(btn);
  const input = popover.querySelector<HTMLInputElement>('input[type="number"]');
  const boton = popover.querySelector<HTMLButtonElement>('[data-accion="guardar"]');
  const texto = (input?.value || '').trim();
  const cantidad = texto === '' ? null : Math.floor(Number(texto));

  if (cantidad !== null && (!Number.isFinite(cantidad) || cantidad <= 0)) {
    showToast('Ingresá una cantidad mayor a 0 (o dejá el campo vacío).', 'warning');
    return;
  }

  if (boton) boton.disabled = true;
  try {
    if (cantidad !== null) {
      await apiPatch('/contenedores/' + encodeURIComponent(estado.id) + '/', {
        cantidad_objetos_lote: cantidad,
      });
    }
    cerrarPopoverCantidad();
    repintarBadge(btn, { ...estado, cantidadLote: cantidad });
    showToast(
      cantidad !== null
        ? '📦 «' + estado.nombre + '»: lote de ~' + cantidad + ' objetos.'
        : '📦 «' + estado.nombre + '» marcada como caja llena (lote en foto).',
      'success',
    );
  } catch {
    if (boton) boton.disabled = false;
    showToast('No se pudo guardar la cantidad del lote.', 'error');
  }
}

/** Abre el mini-popover de cantidad anclado al badge recién marcado como lleno. */
function abrirPopoverCantidad(btn: HTMLElement): void {
  const estado = leerEstado(btn);
  cerrarPopoverCantidad();

  const popover = document.createElement('div');
  popover.id = 'popoverCajaLlena';
  popover.className = 'fixed z-[70] w-72 max-w-[calc(100vw-1rem)] rounded-xl border '
    + 'border-orange-200 bg-white p-3 text-left shadow-xl';
  popover.innerHTML = `
    <p class="text-xs font-bold text-gray-800">🔒 Caja marcada como llena</p>
    <label for="popoverCajaLlenaCantidad" class="mt-2 block text-[11px] font-medium text-gray-600">
      Cantidad estimada de objetos (opcional)
    </label>
    <input id="popoverCajaLlenaCantidad" type="number" min="1" step="1" inputmode="numeric"
      placeholder="Ej: 40" value="${estado.cantidadLote ?? ''}"
      class="mt-1 w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500" />
    <div class="mt-2 flex items-center gap-2">
      <button type="button" data-accion="guardar"
        class="flex-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-base">
        Guardar
      </button>
      <button type="button" data-accion="omitir"
        class="flex-1 px-2.5 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-base">
        Omitir
      </button>
    </div>`;
  document.body.appendChild(popover);
  popoverAbierto = popover;
  posicionarPopover(popover, btn);

  const input = popover.querySelector<HTMLInputElement>('input[type="number"]');
  input?.focus({ preventScroll: true });
  input?.select();
  input?.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Enter') return;
    evento.preventDefault();
    void guardarCantidad(popover, btn);
  });
  popover.querySelector('[data-accion="omitir"]')?.addEventListener('click', cerrarPopoverCantidad);
  popover.querySelector('[data-accion="guardar"]')?.addEventListener('click', () => {
    void guardarCantidad(popover, btn);
  });

  // Cierre por clic afuera (capturado en el próximo tick para no cerrarse con
  // el mismo clic que abrió el popover).
  window.setTimeout(() => {
    listenerFuera = (evento: MouseEvent) => {
      const objetivo = evento.target as Node | null;
      if (!popoverAbierto || !objetivo) return;
      if (popoverAbierto.contains(objetivo) || btn.contains(objetivo)) return;
      cerrarPopoverCantidad();
    };
    document.addEventListener('click', listenerFuera, true);
  }, 0);
}

// -----------------------------------------------------------------------------
// 3. DELEGACIÓN GLOBAL (idempotente)
// -----------------------------------------------------------------------------

/**
 * Enlaza UNA sola vez la delegación de clic del toggle rápido. Se invoca desde
 * el arranque de /objetos (listadoJerarquicoObjetos.ts) y de /almacenamiento
 * (almacenamientoArranque.ts): las tarjetas que se re-inyectan en caliente
 * siguen funcionando sin volver a enlazar nada.
 */
export function initCajaLlenaToggle(): void {
  if (listenersListos) return;
  listenersListos = true;

  document.addEventListener('click', (evento) => {
    const objetivo = evento.target as HTMLElement | null;
    if (!objetivo || !objetivo.closest) return;
    const btn = objetivo.closest('.js-toggle-caja-llena') as HTMLElement | null;
    if (!btn) return;
    // El badge vive dentro de <summary> (acordeón de /objetos) y de tarjetas
    // arrastrables (/almacenamiento): se frena el toggle del acordeón y el
    // inicio de arrastre.
    evento.preventDefault();
    evento.stopPropagation();
    void alternarCajaLlena(btn);
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && popoverAbierto) cerrarPopoverCantidad();
  });
}
