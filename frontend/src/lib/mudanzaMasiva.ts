// =============================================================================
// MODAL «MUDAR TODO EL STOCK» (previsualización + purga de estructuras)
// -----------------------------------------------------------------------------
// Flujo completo de la migración masiva del tablero de Mudanzas:
//   1. Lista SCANNABLE de los elementos móviles detectados en el Origen (la
//      misma clasificación que la columna Origen: cajas, muebles y objetos
//      sueltos), con un checkbox TILDADO POR DEFECTO.
//   2. El operador destilda (o usa «Eliminar de la mudanza») los ítems basura
//      («Espacio 1», «Estantería C1-A1»…): esos ids NO viajan y se purgan.
//   3. «Confirmar Mudanza General» despacha el POST con la lista de exclusión y
//      muestra el resumen; el refresco final lo decide la página host.
//
// El borde HTTP vive en mudanzaApi.ts (enviarMudanzaMasiva) y la clasificación
// del inventario en mudanzaInventario.ts: acá sólo hay UI + estado del modal.
// =============================================================================

import { escapeHtml } from './mapaEstokWizard';
import { agruparMoviles } from './mudanzaInventario';
import type { ElementoMudable } from './mudanzaInventario';
import type { ContenedorDto, ObjetoDto, ResultadoMudanza } from './mudanzaApi';

export interface OpcionesMudanzaMasiva {
  /** Nombre legible del inquilinato de origen (sólo contexto de la UI). */
  origenNombre: string;
  /** Nombre legible del inquilinato destino. */
  destinoNombre: string;
  /** Inventario móvil del Origen (misma fuente que la columna Origen). */
  contenedores: ContenedorDto[];
  objetos: ObjetoDto[];
  /** Ejecuta la migración masiva con los ids a purgar. */
  ejecutar: (excluirIds: string[]) => Promise<ResultadoMudanza>;
  /** Refresco de la pantalla tras una migración exitosa. */
  alExito: () => void;
}

const ICONO_CLASE: Record<string, string> = {
  CAJA: '🧰',
  MUEBLE: '🗄️',
  OBJETO: '📦',
};

const BTN_BASE =
  'rounded-lg px-2 py-1 text-[10px] font-semibold outline-none transition-base ' +
  'focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60 sm:text-[11px]';

const BTN_GRIS = `${BTN_BASE} border border-gray-300 bg-white text-gray-600 hover:bg-gray-100`;
const BTN_VERDE =
  `${BTN_BASE} bg-emerald-600 font-bold text-white shadow-sm hover:bg-emerald-700 ` +
  'focus-visible:ring-emerald-300';

/** Fila scannable de un elemento móvil (checkbox + datos + botón de purga). */
function filaHtml(el: ElementoMudable, indice: number): string {
  const id = escapeHtml(el.id);
  const nombre = escapeHtml(el.nombre);
  const icono = ICONO_CLASE[el.clase] ?? '📦';
  return `
    <li class="flex items-center gap-2 border-b border-gray-100 px-2 py-2 transition-base last:border-b-0 sm:gap-3 sm:px-3"
      data-fila-id="${id}">
      <input type="checkbox" checked data-masiva-check="${id}"
        class="h-4 w-4 shrink-0 accent-emerald-600"
        aria-label="Incluir «${nombre}» en la mudanza" />
      <span class="shrink-0 text-base leading-none" aria-hidden="true">${icono}</span>
      <span class="mudanza-masiva-datos min-w-0 flex-1 text-left">
        <span class="block truncate text-[12px] font-semibold text-gray-800 sm:text-sm">
          ${indice}. ${nombre}
        </span>
        <span class="block truncate text-[10px] text-gray-400 sm:text-[11px]">
          📍 ${escapeHtml(el.procedencia)} · ${escapeHtml(el.detalle)}
        </span>
      </span>
      <button type="button" data-masiva-eliminar="${id}"
        class="shrink-0 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 outline-none transition-base hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-300 sm:text-[11px]"
        title="Sacar «${nombre}» de la mudanza y borrarlo definitivamente del Estok origen">
        🗑️ <span class="hidden sm:inline">Eliminar de la mudanza</span>
      </button>
    </li>`;
}

/** Panel del modal: cabecera + lista scannable + pie de confirmación. */
function panelHtml(origenNombre: string, destinoNombre: string, filas: string): string {
  return `
    <div class="mudanza-masiva-overlay fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-2 sm:items-center sm:p-4"
      role="dialog" aria-modal="true" aria-label="Mudar todo el stock">
      <div class="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header class="shrink-0 border-b border-gray-100 px-3 py-3 sm:px-5 sm:py-4">
          <h2 class="text-base font-bold text-gray-900 sm:text-lg">🚚 Mudar Todo el Stock</h2>
          <p class="mt-1 text-[11px] leading-snug text-gray-500 sm:text-xs">
            <b>${escapeHtml(origenNombre)}</b> → <b>${escapeHtml(destinoNombre)}</b>. Lo que queda
            <b>tildado viaja EN TRÁNSITO</b> al Estok destino; lo que destildás (o marcás con
            «Eliminar de la mudanza») se <b class="text-red-600">borra definitivamente</b> del origen.
          </p>
        </header>
        <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 sm:px-5">
          <span id="mudanzaMasivaContador" class="text-[11px] font-semibold text-gray-600"></span>
          <span class="w-2 flex-1"></span>
          <button type="button" data-masiva-todos="1" class="${BTN_GRIS}">✅ Marcar todos</button>
          <button type="button" data-masiva-ninguno="1" class="${BTN_GRIS}">⛔ Destildar todos</button>
        </div>
        <ul id="mudanzaMasivaLista" class="min-h-0 flex-1 overflow-y-auto">${filas}</ul>
        <div id="mudanzaMasivaError"
          class="hidden shrink-0 border-t border-red-100 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700 sm:px-5"></div>
        <footer class="flex shrink-0 items-center justify-end gap-2 border-t border-gray-100 px-3 py-3 sm:px-5">
          <button type="button" data-masiva-cancelar="1"
            class="${BTN_BASE} border border-gray-300 bg-white text-[12px] text-gray-700 hover:bg-gray-100 sm:text-sm">
            Cancelar
          </button>
          <button type="button" data-masiva-confirmar="1" class="${BTN_VERDE} text-[12px] sm:text-sm">
            Confirmar Mudanza General
          </button>
        </footer>
      </div>
    </div>`;
}

/** Aviso centrado de un solo botón (estado vacío y resumen de éxito). */
function avisoHtml(emoji: string, titulo: string, detalle: string, textoBoton: string): string {
  return `
    <div class="mudanza-masiva-overlay fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3 sm:p-4"
      role="dialog" aria-modal="true">
      <div class="w-full max-w-md rounded-2xl bg-white p-5 text-center shadow-2xl">
        <p class="text-3xl">${emoji}</p>
        <h2 class="mt-2 text-base font-bold text-gray-900 sm:text-lg">${escapeHtml(titulo)}</h2>
        <p class="mt-2 text-[12px] leading-relaxed text-gray-600 sm:text-sm">${escapeHtml(detalle)}</p>
        <button type="button" data-masiva-accion="1" class="${BTN_VERDE} mt-4 w-full py-2 text-sm">
          ${escapeHtml(textoBoton)}
        </button>
      </div>
    </div>`;
}

/** Cierra un modal montado por este módulo (limpia el host). */
function cerrarHost(host: HTMLElement): void {
  host.innerHTML = '';
}

/**
 * Aviso simple y autocontenido (mismo shell que el modal): lo usa la página para
 * informar un fallo de carga del inventario u otra situación previa al listado.
 */
export function montarAvisoMudanzaMasiva(
  host: HTMLElement,
  emoji: string,
  titulo: string,
  detalle: string,
): void {
  host.innerHTML = avisoHtml(emoji, titulo, detalle, 'Cerrar');
  host.querySelector('[data-masiva-accion]')
    ?.addEventListener('click', () => cerrarHost(host));
}


/**
 * Monta el modal de migración masiva sobre `host` (host vacío y dedicado).
 *
 * Sin inventario móvil en el Origen muestra un aviso y no permite confirmar.
 * Los ítems nacen tildados; destildarlos (o el botón «Eliminar de la mudanza»)
 * los manda a la lista de PURGA física que viaja en `ejecutar`.
 */
export function montarModalMudanzaMasiva(host: HTMLElement, opciones: OpcionesMudanzaMasiva): void {
  // Clasificación ÚNICA del inventario móvil (idéntica a la columna Origen).
  const elementos = agruparMoviles(opciones.contenedores, opciones.objetos)
    .flatMap((grupo) => grupo.elementos);

  if (elementos.length === 0) {
    montarAvisoMudanzaMasiva(
      host,
      '🗃️',
      'No hay inventario móvil para mudar',
      `El Estok «${opciones.origenNombre}» no tiene cajas móviles, muebles mudables ni objetos sueltos.`,
    );
    return;
  }

  const excluidos = new Set<string>();
  host.innerHTML = panelHtml(
    opciones.origenNombre,
    opciones.destinoNombre,
    elementos.map((el, i) => filaHtml(el, i + 1)).join(''),
  );

  const overlay = host.querySelector<HTMLElement>('.mudanza-masiva-overlay');
  const lista = host.querySelector<HTMLElement>('#mudanzaMasivaLista');
  const contador = host.querySelector<HTMLElement>('#mudanzaMasivaContador');
  const cajaError = host.querySelector<HTMLElement>('#mudanzaMasivaError');
  const btnConfirmar = host.querySelector<HTMLButtonElement>('[data-masiva-confirmar]');
  if (!overlay || !lista || !contador || !cajaError || !btnConfirmar) return;

  // Atajo de teclado: ESC cierra el modal (se desregistra al desmontar).
  function cerrar(): void {
    document.removeEventListener('keydown', alTecleo);
    cerrarHost(host);
  }
  function alTecleo(e: KeyboardEvent): void {
    if (e.key === 'Escape') cerrar();
  }

  /** Recalcula el contador «se mudan / se eliminan» del encabezado. */
  const contar = (): void => {
    const purgar = excluidos.size;
    contador.textContent =
      `${elementos.length - purgar} se mudan · ${purgar} se eliminan (${elementos.length} detectados)`;
  };

  /** Aplica el estado de un elemento: tildado (viaja) o destildado (se purga). */
  const fijar = (id: string, incluida: boolean, sincronizar: boolean): void => {
    if (incluida) excluidos.delete(id);
    else excluidos.add(id);
    const selector = CSS.escape(id);
    lista.querySelector<HTMLElement>(`[data-fila-id="${selector}"]`)
      ?.classList.toggle('mudanza-masiva-fila-excluida', !incluida);
    if (sincronizar) {
      const check = lista.querySelector<HTMLInputElement>(`[data-masiva-check="${selector}"]`);
      if (check) check.checked = incluida;
    }
    contar();
  };

  // Delegación: checkbox nativo (destildar) y botón «Eliminar de la mudanza».
  lista.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const id = input?.dataset?.masivaCheck;
    if (id) fijar(id, input.checked, false);
  });
  lista.addEventListener('click', (e) => {
    const boton = (e.target as HTMLElement)?.closest<HTMLElement>('[data-masiva-eliminar]');
    const id = boton?.dataset?.masivaEliminar;
    if (id) fijar(id, false, true);
  });

  host.querySelector('[data-masiva-todos]')?.addEventListener('click', () => {
    elementos.forEach((el) => fijar(el.id, true, true));
  });
  host.querySelector('[data-masiva-ninguno]')?.addEventListener('click', () => {
    elementos.forEach((el) => fijar(el.id, false, true));
  });
  host.querySelector('[data-masiva-cancelar]')?.addEventListener('click', cerrar);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrar();
  });
  document.addEventListener('keydown', alTecleo);

  // -------------------------------------------------------------------------
  // CONFIRMACIÓN: POST al borde HTTP con la lista de PURGA (destildados).
  // -------------------------------------------------------------------------
  btnConfirmar.addEventListener('click', () => void confirmar());

  async function confirmar(): Promise<void> {
    if (btnConfirmar!.disabled) return;
    btnConfirmar!.disabled = true;
    btnConfirmar!.textContent = 'Mudando…';
    cajaError!.classList.add('hidden');

    let resultado: ResultadoMudanza;
    try {
      resultado = await opciones.ejecutar([...excluidos]);
    } catch (err) {
      resultado = {
        ok: false,
        mensaje: err instanceof Error ? err.message : 'No se pudo completar la operación.',
      };
    }

    if (!resultado.ok) {
      cajaError!.textContent = resultado.mensaje;
      cajaError!.classList.remove('hidden');
      btnConfirmar!.disabled = false;
      btnConfirmar!.textContent = 'Confirmar Mudanza General';
      return;
    }

    // Éxito: resumen + refresco explícito de la pantalla (lo decide la página).
    document.removeEventListener('keydown', alTecleo);
    host.innerHTML = avisoHtml('🚚✅', 'Mudanza general completada', resultado.mensaje, 'Refrescar paneles e inventario');
    host.querySelector('[data-masiva-accion]')?.addEventListener('click', () => {
      cerrarHost(host);
      opciones.alExito();
    });
  }

  contar();
}

