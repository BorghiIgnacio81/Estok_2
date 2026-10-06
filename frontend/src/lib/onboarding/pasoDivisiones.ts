// =============================================================================
// PASO 3 DEL ASISTENTE — EMBUDO SECUENCIAL DE DIVISIONES DE LA HABITACIÓN
// -----------------------------------------------------------------------------
// Reemplaza la lista plana anterior por el «embudo inteligente» secuencial:
//   ESCENA 1 · Combobox a la IZQUIERDA poblado SOLO con la lista REAL deduplicada
//     del Paso 2 («Cocina», «Fusión»…) y lienzo elástico naranja ABAJO para
//     modelar el cuarto elegido. CERO datos fantasma: sin habitaciones reales NO
//     se inyecta ninguna «Habitación principal».
//   ESCENA 2 · «Continuar» NO avanza: evalúa las PENDIENTES y congela la pantalla
//     en la SIGUIENTE con sus 3 vías → [🧱 Crear divisiones ahora] (activa el
//     selector y despliega el lienzo para modelar en caliente), [⬜ Espacio Único]
//     (persiste `espacio_unico: true` y avanza solo) y [⏳ En otro momento] (marca
//     «Se modelará más tarde», la deja abierta de fondo y avanza a la siguiente).
//   ESCENA 3 · El escape al Paso 4 (Primer Objeto) solo se habilita cuando el
//     100% de las habitaciones REALES del Paso 2 recibió una decisión explícita.
//
// DEDUPLICACIÓN: `?deduplicar_grupos=1` (./api → listarAmbientes): un espacio
// fusionado en «L» = UNA opción. El LIENZO elástico vive en ./lienzoDivisiones.
// =============================================================================

import { escapeHtml, guardarUbicacion } from '../mapaJerarquico';
import { limpiarLienzoDivisiones, montarLienzoDivisiones } from './lienzoDivisiones';
import { listarAmbientes } from './api';
import type { RecursoCreado } from './api';
import { avisoGlobal } from './comunes';

/** Decisión explícita que el embudo registra por cada habitación real. */
type Decision = 'divisiones' | 'unico' | 'diferido';

// --- Estado del EMBUDO secuencial (selector + decisiones) --------------------
let listaEl: HTMLElement | null = null;
let lienzoEl: HTMLElement | null = null;
let selectEl: HTMLSelectElement | null = null;
let estadoEl: HTMLElement | null = null;
let embudoEl: HTMLElement | null = null;
let ambientes: RecursoCreado[] = [];
/** Habitación cuyo lienzo está desplegado abajo (la que se está modelando). */
let roomActivo: string | null = null;
/** Decisión explícita por habitación: SIN entrada = PENDIENTE en el embudo. */
const decisiones = new Map<string, Decision>();
/** Escape al Paso 4: lo inyecta el wizard (mantiene este módulo desacoplado). */
let avanzarCb: (() => void) | null = null;


// =============================================================================
// EMBUDO SECUENCIAL — SELECTOR, ESTADO Y PANEL DE DECISIÓN
// =============================================================================

/** Chip de estado (texto + color) de la decisión registrada para una habitación. */
function etiquetaDecision(id: string): { texto: string; clase: string } {
  const decision = decisiones.get(id);
  if (decision === 'divisiones')
    return { texto: '✅ Divisiones', clase: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  if (decision === 'unico')
    return { texto: '⬜ Espacio Único', clase: 'bg-blue-100 text-blue-700 border-blue-200' };
  if (decision === 'diferido')
    return { texto: '⏳ Se modelará más tarde', clase: 'bg-amber-100 text-amber-700 border-amber-200' };
  return { texto: 'Pendiente', clase: 'bg-gray-100 text-gray-500 border-gray-200' };
}

/** Panel del embudo: presenta la SIGUIENTE habitación pendiente con sus 3 vías. */
function htmlEmbudo(a: RecursoCreado): string {
  return `<div class="rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-4">
    <p class="text-[11px] font-semibold uppercase tracking-wider text-amber-700">Embudo secuencial</p>
    <p class="mt-1 text-sm font-semibold text-gray-800">Siguiente ambiente: <span class="text-amber-800">«${escapeHtml(a.nombre)}»</span></p>
    <p class="mt-1 text-xs text-gray-500 leading-relaxed">Elegí cómo tratar este ambiente para seguir con el siguiente. El paso no se cierra hasta cubrir el 100% de tus habitaciones.</p>
    <div class="mt-3 flex flex-wrap gap-2">
      <button type="button" data-div-crear="${a.id}" class="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold transition-base">🧱 Crear divisiones ahora</button>
      <button type="button" data-div-unico="${a.id}" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-base">⬜ Espacio Único</button>
      <button type="button" data-div-diferir="${a.id}" class="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-base">⏳ En otro momento</button>
    </div>
  </div>`;
}

/** Escena 1: pinta el combobox (izquierda) con la lista REAL de habitaciones. */
function pintarSelector(): void {
  if (!selectEl) return;
  selectEl.innerHTML = ambientes
    .map((a) => `<option value="${a.id}">${escapeHtml(a.nombre)}</option>`)
    .join('');
  if (roomActivo) selectEl.value = roomActivo;
}

/** Pinta el estado del embudo (chip por habitación) junto al combobox. */
function pintarEstado(): void {
  if (!estadoEl) return;
  estadoEl.innerHTML = ambientes
    .map((a) => {
      const e = etiquetaDecision(a.id);
      const activo = roomActivo === a.id;
      return `<li class="flex items-center justify-between gap-2">
        <span class="text-sm ${activo ? 'font-semibold text-orange-700' : 'text-gray-600'}">${escapeHtml(a.nombre)}</span>
        <span class="px-2 py-0.5 rounded-full border text-[11px] font-semibold ${e.clase}">${e.texto}</span>
      </li>`;
    })
    .join('');
}

/** Escena 2: muestra (o limpia) el panel del embudo con la próxima pendiente. */
function pintarEmbudo(pendiente: RecursoCreado | null): void {
  if (!embudoEl) return;
  embudoEl.innerHTML = pendiente ? htmlEmbudo(pendiente) : '';
}


// =============================================================================
// ACCIONES DEL EMBUDO
// =============================================================================

/** Escena 1: el usuario elige un cuarto → se despliega abajo su lienzo naranja. */
async function seleccionarAmbiente(id: string): Promise<void> {
  if (!id) return;
  roomActivo = id;
  pintarEstado();
  if (!lienzoEl) return;
  lienzoEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  await montarLienzoDivisiones(id, lienzoEl);
}

/** Vía 1: activa el cuarto en caliente y oculta el embudo hasta el próximo «Continuar». */
async function crearDivisionesAhora(id: string): Promise<void> {
  if (!id) return;
  pintarEmbudo(null);
  roomActivo = id;
  if (selectEl) selectEl.value = id;
  pintarEstado();
  if (!lienzoEl) return;
  lienzoEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  await montarLienzoDivisiones(id, lienzoEl);
}

/** Vía 2: «Espacio Único»: persiste `espacio_unico: true` (asíncrono) y avanza solo. */
function marcarEspacioUnico(id: string): void {
  const ambiente = ambientes.find((a) => a.id === id);
  decisiones.set(id, 'unico');
  if (ambiente) ambiente.espacioUnico = true;
  if (roomActivo === id) {
    roomActivo = null;
    limpiarLienzoDivisiones(lienzoEl);
  }
  pintarEstado();
  void guardarUbicacion(id, { espacio_unico: true }).then((ok) => {
    avisoGlobal(
      ok
        ? `✅ «${ambiente?.nombre ?? 'Ambiente'}» declarado Espacio Único.`
        : '⚠️ No se pudo guardar «Espacio Único». Reintentá.',
    );
  });
  evaluarEmbudo();
}

/** Vía 3: «En otro momento»: marca «Se modelará más tarde» y avanza a la siguiente. */
function marcarDiferido(id: string): void {
  if (!id) return;
  const ambiente = ambientes.find((a) => a.id === id);
  decisiones.set(id, 'diferido');
  if (roomActivo === id) {
    roomActivo = null;
    limpiarLienzoDivisiones(lienzoEl);
  }
  pintarEstado();
  avisoGlobal(`⏳ «${ambiente?.nombre ?? 'Ambiente'}» se modelará más tarde.`);
  evaluarEmbudo();
}

/** Escena 3: evalúa el embudo y, si no quedan pendientes, habilita el escape al Paso 4. */
function evaluarEmbudo(): void {
  const pendiente = ambientes.find((a) => !decisiones.has(a.id)) ?? null;
  if (!pendiente) {
    pintarEmbudo(null);
    avanzarCb?.();
    return;
  }
  pintarEmbudo(pendiente);
}


// =============================================================================
// API PÚBLICA DEL PASO 3
// =============================================================================

/**
 * Monta el embudo del Paso 3 (idempotente; se re-corre al reingresar al paso):
 * combobox con la lista REAL del Paso 2 y lienzo de la primera habitación ya
 * desplegado de entrada (Escena 1).
 */
export async function montarGuiaDivisiones(opciones: {
  lista: HTMLElement;
  lienzo: HTMLElement;
  avanzar: () => void;
}): Promise<void> {
  listaEl = opciones.lista;
  lienzoEl = opciones.lienzo;
  avanzarCb = opciones.avanzar;
  decisiones.clear();
  roomActivo = null;
  limpiarLienzoDivisiones(lienzoEl);

  // Escena 1: SOLO habitaciones REALES del Paso 2 (deduplicadas). CERO fantasmas.
  ambientes = await listarAmbientes();
  if (ambientes.length === 0) {
    listaEl.innerHTML =
      '<p class="text-sm text-gray-400">No creaste habitaciones en el Paso 2. Podés tocar «Continuar» y subdividir más tarde desde Almacenamiento.</p>';
    selectEl = null;
    estadoEl = null;
    embudoEl = null;
    return;
  }

  // Cascarón estático: combobox a la izquierda + estado a la derecha + embudo abajo.
  listaEl.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,260px)_1fr] gap-4 sm:items-start">
      <div class="sm:border-r sm:border-gray-100 sm:pr-4">
        <label for="onbAmbienteSelect" class="block text-sm font-semibold text-gray-700 mb-1">Habitación</label>
        <select id="onbAmbienteSelect" class="w-full px-4 py-3 border border-gray-300 rounded-2xl text-base bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-base"></select>
      </div>
      <div class="text-xs text-gray-500 leading-relaxed">
        <p class="font-semibold text-gray-700 mb-1">Estado de tus ambientes</p>
        <ul id="onbEstadoAmbientes" class="space-y-1"></ul>
      </div>
    </div>
    <div id="onbEmbudo" class="mt-4"></div>`;
  selectEl = listaEl.querySelector<HTMLSelectElement>('#onbAmbienteSelect');
  estadoEl = listaEl.querySelector<HTMLElement>('#onbEstadoAmbientes');
  embudoEl = listaEl.querySelector<HTMLElement>('#onbEmbudo');

  const primero = ambientes[0].id;
  roomActivo = primero;
  pintarSelector();
  pintarEstado();
  // Se despliega el lienzo elástico naranja del primer cuarto real.
  await montarLienzoDivisiones(primero, lienzoEl);

  // Delegación idempotente (se re-asigna en cada re-montaje).
  listaEl.onchange = (e) => {
    const sel = e.target as HTMLSelectElement;
    if (sel?.id === 'onbAmbienteSelect') void seleccionarAmbiente(sel.value);
  };
  listaEl.onclick = (e) => {
    const t = e.target as HTMLElement;
    const crear = t.closest<HTMLElement>('[data-div-crear]');
    if (crear?.dataset.divCrear) {
      void crearDivisionesAhora(crear.dataset.divCrear);
      return;
    }
    const unico = t.closest<HTMLElement>('[data-div-unico]');
    if (unico?.dataset.divUnico) {
      marcarEspacioUnico(unico.dataset.divUnico);
      return;
    }
    const diferir = t.closest<HTMLElement>('[data-div-diferir]');
    if (diferir?.dataset.divDiferir) marcarDiferido(diferir.dataset.divDiferir);
  };
}

/**
 * «Continuar» (Escena 2/3): marca el cuarto modelado, evalúa las pendientes y
 * solo habilita el escape al Paso 4 cuando el 100% tiene decisión explícita.
 */
export function continuarPasoDivisiones(): void {
  if (ambientes.length === 0) {
    avanzarCb?.();
    return;
  }
  if (roomActivo && !decisiones.has(roomActivo)) decisiones.set(roomActivo, 'divisiones');
  pintarEstado();
  evaluarEmbudo();
}

/** Limpia TODO el estado del Paso 3 (vuelta atrás o cierre del asistente). */
export function desmontarDivisiones(): void {
  limpiarLienzoDivisiones(lienzoEl);
  listaEl = null;
  lienzoEl = null;
  selectEl = null;
  estadoEl = null;
  embudoEl = null;
  ambientes = [];
  decisiones.clear();
  roomActivo = null;
  avanzarCb = null;
}

