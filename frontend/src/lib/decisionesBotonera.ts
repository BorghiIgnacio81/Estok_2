// =============================================================================
// BOTONERA Y ESTADO VISUAL DE LA TARJETA DE DECISIONES (/alertas-stock)
// -----------------------------------------------------------------------------
// Markup y estado DOM de la botonera in-place de las tarjetas SIN decisión, con
// la regla de PROPIEDAD como fuente única (lib/decisionesPropiedad.ts):
//
//   Caso A · el objeto es del usuario  → 💰 Vender / 📦 Conservar / 🗑️ Tirar y Donar
//   Caso B · objeto SIN propietario    → 🗳️ Iniciar votación (decisión compartida)
//   Caso C · objeto de OTRO usuario    → 📩 Avisar al propietario
//
// Vive aparte de lib/decisionesPendientes.ts (que orquesta la carga y las
// acciones) para mantener los archivos de UI por debajo del límite de
// modularidad del proyecto.
// =============================================================================

import type { ObjetoDecision } from './decisionesTarjeta';
import { modoDecisionObjeto } from './decisionesPropiedad';

/** Botonera in-place de una tarjeta sin decidir según la PROPIEDAD del objeto. */
export function botoneraHtml(obj: ObjetoDecision): string {
  const boton = (accion: string, etiqueta: string, icono: string, clase: string): string => `
    <button type="button" data-objeto-id="${obj.id}" data-decision="${accion}" title="${etiqueta}"
      class="flex-1 inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white rounded-lg shadow-sm transition-base disabled:opacity-40 disabled:cursor-not-allowed ${clase}">
      <span aria-hidden="true">${icono}</span>${etiqueta}
    </button>`;

  const modo = modoDecisionObjeto(obj);

  // Caso B · SIN propietario asignado: no hay decisión individual posible, se
  // PROPONE la decisión compartida al grupo familiar (votación del Estok).
  if (modo === 'sin_dueno') {
    return `
    <div class="mt-auto flex flex-col gap-1.5" data-botones-decision>
      <button type="button" data-iniciar-votacion="${obj.id}" title="Proponer la decisión al grupo familiar"
        class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg shadow-sm transition-base disabled:opacity-40 disabled:cursor-not-allowed">
        <span aria-hidden="true">🗳️</span>Iniciar votación
      </button>
    </div>`;
  }

  // Caso C · el objeto es de OTRO usuario: sólo se puede avisar al propietario.
  if (modo === 'ajeno') {
    return `
    <div class="mt-auto flex flex-col gap-1.5" data-botones-decision>
      <button type="button" data-avisar-propietario="${obj.id}" title="Avisar al propietario de este objeto"
        class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-orange-900 bg-orange-100 hover:bg-orange-200 rounded-lg shadow-sm transition-base disabled:opacity-40 disabled:cursor-not-allowed">
        <span aria-hidden="true">📩</span>Avisar al propietario
      </button>
    </div>`;
  }

  // Caso A · el objeto es del usuario autenticado: decisión individual.
  return `
    <div class="mt-auto flex items-stretch gap-1.5" data-botones-decision>
      ${boton('vender', 'Vender', '💰', 'bg-green-600 hover:bg-green-700')}
      ${boton('conservar', 'Conservar', '📦', 'bg-blue-600 hover:bg-blue-700')}
      ${boton('tirar', 'Tirar / Donar', '🗑️', 'bg-red-600 hover:bg-red-700')}
    </div>`;
}

/** Veredicto que reemplaza la botonera una vez fijada la decisión. */
export function decididoHtml(obj: ObjetoDecision, accion: string): string {
  if (accion === 'vender') {
    const publicadoML = obj.plataformas_publicadas.includes('mercadolibre');
    return `
      <div class="mt-auto flex flex-col gap-1.5" data-botones-decision>
        <span class="inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-green-100 text-green-800 text-xs font-bold">
          💰 Para vender
        </span>
        <button type="button" data-publicar="${obj.id}"
          class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-base">
          📢 ${publicadoML ? 'Ver / republicar anuncio' : 'Publicar en ML o Facebook'}
        </button>
      </div>`;
  }
  return `
    <div class="mt-auto flex flex-col gap-1.5" data-botones-decision>
      <span class="inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-blue-100 text-blue-800 text-xs font-bold">
        📦 Se conserva en el Estok
      </span>
    </div>`;
}

/** Habilita/bloquea los botones de decisión de una tarjeta. */
export function bloquearBotones(id: string, bloquear: boolean): void {
  document
    .querySelectorAll<HTMLButtonElement>(`[data-objeto-card="${id}"] [data-decision]`)
    .forEach((boton) => {
      boton.disabled = bloquear;
    });
}

/** Reemplaza la botonera por el veredicto y resalta la tarjeta. */
export function marcarTarjetaDecidida(obj: ObjetoDecision, accion: string): void {
  const card = document.querySelector<HTMLElement>(`[data-objeto-card="${obj.id}"]`);
  if (!card) return;
  card.dataset.decisionTomada = accion;
  card.classList.add('ring-2', 'ring-green-400');
  const botones = card.querySelector('[data-botones-decision]');
  if (botones) botones.outerHTML = decididoHtml(obj, accion);
}
