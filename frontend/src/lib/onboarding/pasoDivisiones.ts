// =============================================================================
// PASO 3 DEL ASISTENTE — EMBUDO SECUENCIAL DE DIVISIONES DE LA HABITACIÓN
// -----------------------------------------------------------------------------
// Reemplaza la lista plana anterior por el «embudo inteligente» secuencial:
//   ESCENA 1 · Combobox a la IZQUIERDA poblado SOLO con la lista REAL deduplicada
//     del Paso 2 («Cocina», «Fusión»…) + checkbox canónico «Espacio Único» de la
//     habitación elegida y lienzo elástico naranja ABAJO para modelar el cuarto
//     (con los BORDES EXTERIORES estirables, igual que el Paso 2). CERO datos
//     fantasma: sin habitaciones reales NO se inyecta ninguna «Habitación
//     principal».
//   ESCENA 2 · «Continuar» evalúa la habitación seleccionada: si YA tiene
//     divisiones creadas se OMITE el modal de las 3 opciones y se avanza directo
//     al Paso 4; si no, congela la pantalla en la SIGUIENTE pendiente con sus 3
//     vías → [🧱 Crear divisiones ahora] (activa el selector y despliega el
//     lienzo para modelar en caliente), [⬜ Espacio Único] (persiste
//     `espacio_unico: true` y avanza solo) y [⏳ En otro momento] (marca «Se
//     modelará más tarde», la deja abierta de fondo y avanza a la siguiente).
//   ESCENA 3 · El escape al Paso 4 (Primer Objeto) solo se habilita cuando el
//     100% de las habitaciones REALES del Paso 2 recibió una decisión explícita.
//
// DEDUPLICACIÓN: `?deduplicar_grupos=1` (./api → listarAmbientes): un espacio
// fusionado en «L» = UNA opción. El LIENZO elástico vive en ./lienzoDivisiones.
// ANTI CARRERA DE DATOS: si el fetch llega vacío se REINTENTA con delay de
// resguardo y, en última instancia, se hidrata desde el rastro local que dejó el
// Paso 2 (./rastroAmbientes, en sessionStorage).
// =============================================================================

import { escapeHtml } from '../mapaJerarquico';
import { habitacionTieneDivisiones, limpiarLienzoDivisiones, montarLienzoDivisiones } from './lienzoDivisiones';
import { listarAmbientes } from './api';
import type { RecursoCreado } from './api';
import { avisoGlobal } from './comunes';
// Checkbox CANÓNICO «Espacio Único» (lib/espacioUnico.ts): el mismo control de
// toda la aplicación, disponible para CUALQUIER habitación seleccionada (Baño,
// Cocina, etc.), no sólo para las que pasan por el embudo.
import {
  htmlEspacioUnicoHabitacion,
  ID_ESPACIO_UNICO_DIVISIONES,
  persistirEspacioUnicoHabitacion,
} from './espacioUnicoDivisiones';
import { leerRastroAmbientes } from './rastroAmbientes';
// Piezas de vista del embudo (chip de decisión + panel de las 3 vías).
import { etiquetaDecision, htmlEmbudo } from './embudoDivisiones';
import type { Decision } from './embudoDivisiones';

// --- Estado del EMBUDO secuencial (selector + decisiones) --------------------
let listaEl: HTMLElement | null = null;
let lienzoEl: HTMLElement | null = null;
let selectEl: HTMLSelectElement | null = null;
let estadoEl: HTMLElement | null = null;
let embudoEl: HTMLElement | null = null;
/** Host del checkbox «Espacio Único» de la habitación seleccionada. */
let unicoEl: HTMLElement | null = null;
let ambientes: RecursoCreado[] = [];
/** Habitación cuyo lienzo está desplegado abajo (la que se está modelando). */
let roomActivo: string | null = null;
/** Decisión explícita por habitación: SIN entrada = PENDIENTE en el embudo. */
const decisiones = new Map<string, Decision>();
/** Escape al Paso 4: lo inyecta el wizard (mantiene este módulo desacoplado). */
let avanzarCb: (() => void) | null = null;
/** Guarda del chequeo asíncrono de «Continuar» (evita dobles clics). */
let verificandoContinuar = false;

// =============================================================================
// CARGA REACTIVA DE AMBIENTES (ANTI CARRERA DE DATOS)
// =============================================================================

/** Espera `ms` milisegundos (delay de resguardo del re-intento reactivo). */
function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Carga los ambientes REALES del Paso 2 con RE-INTENTO REACTIVO: si el primer
 * fetch llega vacío (carrera de datos: Django todavía consolidando el nuevo
 * tenant), reintenta con un breve delay de resguardo antes de dar el listado por
 * vacío. Absorbe la latencia de PostgreSQL sin bloquear al usuario.
 */
async function cargarAmbientesConReintento(): Promise<RecursoCreado[]> {
  // Intento inmediato + dos re-intentos escalonados (300ms y 500ms).
  const pausasMs = [0, 300, 500];
  let lista: RecursoCreado[] = [];
  for (const pausa of pausasMs) {
    if (pausa > 0) await esperar(pausa);
    try {
      lista = await listarAmbientes();
    } catch {
      lista = [];
    }
    if (lista.length > 0) return lista;
  }
  return lista;
}

// =============================================================================
// EMBUDO SECUENCIAL — SELECTOR, ESTADO Y PANEL DE DECISIÓN
// =============================================================================

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
      const e = etiquetaDecision(decisiones.get(a.id));
      const activo = roomActivo === a.id;
      return `<li class="flex items-center justify-between gap-2">
        <span class="text-sm ${activo ? 'font-semibold text-orange-700' : 'text-gray-600'}">${escapeHtml(a.nombre)}</span>
        <span class="px-2 py-0.5 rounded-full border text-[11px] font-semibold ${e.clase}">${e.texto}</span>
      </li>`;
    })
    .join('');
}

/** Habitación SELECCIONADA (dueña del lienzo desplegado abajo).
 *
 * Prioriza `roomActivo` (la que se está modelando) y, cuando el embudo la
 * desmonta, cae al valor VISIBLE en el combobox: el checkbox «Espacio Único»
 * sigue así a la habitación que el usuario ve seleccionada (Baño, Cocina…).
 */
function ambienteActivo(): RecursoCreado | null {
  const id = roomActivo ?? selectEl?.value ?? null;
  return ambientes.find((a) => a.id === id) ?? null;
}

/**
 * Pinta el checkbox canónico «Espacio Único» de la habitación seleccionada.
 * Disponible para TODAS las habitaciones del Paso 3 (Baño, Cocina, Pasillo…),
 * reflejando el estado REAL persistido en PostgreSQL.
 */
function pintarEspacioUnico(): void {
  if (!unicoEl) return;
  const ambiente = ambienteActivo();
  unicoEl.innerHTML = ambiente ? htmlEspacioUnicoHabitacion(ambiente) : '';
}

/**
 * Persiste el «Espacio Único» de la habitación seleccionada con PUT parcial
 * sobre la Ubicación (mismo contrato que Almacenamiento). No re-monta el lienzo:
 * el embudo y el estado de los ambientes quedan consistentes al instante.
 */
function alternarEspacioUnicoHabitacion(marcado: boolean): void {
  const ambiente = ambienteActivo();
  if (!ambiente) return;
  // Un ambiente monolítico ya está decidido: no vuelve a caer en el embudo.
  decisiones.set(ambiente.id, marcado ? 'unico' : 'divisiones');
  pintarEstado();
  persistirEspacioUnicoHabitacion(ambiente, marcado);
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
  // El checkbox «Espacio Único» sigue a la habitación elegida (Baño, Cocina…).
  pintarEspacioUnico();
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
  pintarEspacioUnico();
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
  pintarEspacioUnico();
  if (ambiente) persistirEspacioUnicoHabitacion(ambiente, true);
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
  verificandoContinuar = false;
  limpiarLienzoDivisiones(lienzoEl);

  // Escena 1: SOLO habitaciones REALES del Paso 2 (deduplicadas). CERO fantasmas.
  // Placeholder inmediato: evita que el usuario vea el paso «desierto» mientras
  // corre el re-intento reactivo.
  listaEl.innerHTML = '<p class="text-sm text-gray-400">Sincronizando tus ambientes…</p>';

  // 1) RE-INTENTO REACTIVO contra el backend (absorbe la carrera de datos).
  ambientes = await cargarAmbientesConReintento();

  // 2) Red de seguridad: si la red sigue vacía, hidratamos con el rastro local
  //    que dejó el Paso 2 (ids REALES, así el lienzo elástico funciona igual).
  let hidratadoLocal = false;
  if (ambientes.length === 0) {
    ambientes = leerRastroAmbientes();
    hidratadoLocal = ambientes.length > 0;
  }

  // 3) Fallback defensivo final: recién ahora, sin datos reales NI rastro.
  if (ambientes.length === 0) {
    listaEl.innerHTML =
      '<p class="text-sm text-gray-400">No creaste habitaciones en el Paso 2. Podés tocar «Continuar» y subdividir más tarde desde Almacenamiento.</p>';
    selectEl = null;
    estadoEl = null;
    embudoEl = null;
    return;
  }

  if (hidratadoLocal) {
    avisoGlobal('⏳ Sincronizando tus ambientes con el servidor…');
  }

  // Cascarón estático: combobox a la izquierda + estado a la derecha + embudo abajo.
  listaEl.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,260px)_1fr] gap-4 sm:items-start">
      <div class="sm:border-r sm:border-gray-100 sm:pr-4">
        <label for="onbAmbienteSelect" class="block text-sm font-semibold text-gray-700 mb-1">Habitación</label>
        <select id="onbAmbienteSelect" class="w-full px-4 py-3 border border-gray-300 rounded-2xl text-base bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-base"></select>
        <div id="onbDivisionEspacioUnico"></div>
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
  unicoEl = listaEl.querySelector<HTMLElement>('#onbDivisionEspacioUnico');

  const primero = ambientes[0].id;
  roomActivo = primero;
  pintarSelector();
  pintarEstado();
  // Checkbox canónico de la habitación de entrada (vale para todas las del combo).
  pintarEspacioUnico();
  // Se despliega el lienzo elástico naranja del primer cuarto real.
  await montarLienzoDivisiones(primero, lienzoEl);

  // Delegación idempotente (se re-asigna en cada re-montaje).
  listaEl.onchange = (e) => {
    const t = e.target as HTMLElement;
    // Checkbox «Espacio Único» de la habitación seleccionada (PUT parcial).
    if (t instanceof HTMLInputElement && t.id === ID_ESPACIO_UNICO_DIVISIONES) {
      alternarEspacioUnicoHabitacion(t.checked);
      return;
    }
    const sel = t as HTMLSelectElement;
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
 * «Continuar» (Escena 2/3): si la habitación SELECCIONADA ya tiene divisiones
 * creadas, el modal de las 3 opciones («Crear divisiones ahora» / «Espacio
 * Único» / «En otro momento») es redundante: se OMITE y se avanza directo al
 * Paso 4. Si todavía no tiene divisiones, se conserva el embudo secuencial y
 * el paso sólo se cierra cuando el 100% de los ambientes tiene decisión.
 */
export function continuarPasoDivisiones(): void {
  if (ambientes.length === 0) {
    avanzarCb?.();
    return;
  }
  const id = roomActivo;
  if (!id || verificandoContinuar) {
    pintarEstado();
    evaluarEmbudo();
    return;
  }
  verificandoContinuar = true;
  void (async () => {
    try {
      if (await habitacionTieneDivisiones(id)) {
        // Ya modelada: se registra la decisión, se limpia el modal y se avanza.
        decisiones.set(id, 'divisiones');
        pintarEstado();
        pintarEmbudo(null);
        avisoGlobal(`✅ «${ambienteActivo()?.nombre ?? 'La habitación'}» ya tiene divisiones: seguimos.`);
        avanzarCb?.();
        return;
      }
      if (!decisiones.has(id)) decisiones.set(id, 'divisiones');
      pintarEstado();
      evaluarEmbudo();
    } finally {
      verificandoContinuar = false;
    }
  })();
}

/** Limpia TODO el estado del Paso 3 (vuelta atrás o cierre del asistente). */
export function desmontarDivisiones(): void {
  limpiarLienzoDivisiones(lienzoEl);
  listaEl = null;
  lienzoEl = null;
  selectEl = null;
  estadoEl = null;
  embudoEl = null;
  unicoEl = null;
  ambientes = [];
  decisiones.clear();
  roomActivo = null;
  verificandoContinuar = false;
  avanzarCb = null;
}

