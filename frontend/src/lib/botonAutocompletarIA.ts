// =============================================================================
// ESTADO DEL BOTÓN "AUTOCOMPLETAR CON IA" (Alta de Objetos)
// -----------------------------------------------------------------------------
// En /objetos/nuevo hay UN ÚNICO control "Autocompletar con IA": el de la
// botonera de "Fotos del Objeto" (celda contigua a "Otra foto"). Su estado se
// pinta SIEMPRE desde acá (fuente única de verdad): nuevo.astro nunca vuelve a
// tocar `disabled` ni las clases a mano.
//
//   inactivo   → sin foto cargada o sin motor de IA: disabled + aspecto opaco.
//   listo      → texto fijo "Autocompletar con IA", listo para hacer clic.
//   analizando → spinner + "Analizando..." SOLO tras un clic real del usuario.
//
// El estado se aplica a TODOS los nodos `[data-ia-boton]` de la página en una
// sola pasada (`pintar()`), así el módulo sigue valiendo si el botón se monta
// en otra sección más adelante.
//
// OJO (bug histórico del botón trabado): los nodos de texto/spinner se ocultan
// con el ATRIBUTO `hidden`, NO con la clase `.hidden`. En Tailwind v4 el CSS
// emitido pone `.hidden{display:none}` ANTES de `.inline-flex{display:inline-flex}`,
// por lo que un nodo con `hidden inline-flex` queda SIEMPRE visible: el botón
// nacía mostrando la ruedita y "Analizando..." de forma permanente. El preflight
// de Tailwind v4 sí define `[hidden]{display:none!important}`, así que el
// atributo es la vía robusta e independiente del orden de las utilidades.
// =============================================================================

export type EstadoBotonIA = 'inactivo' | 'listo' | 'analizando';

/** Botones IA del formulario (hoy: la botonera de "Fotos del Objeto"). */
const SELECTOR_BOTONES = '[data-ia-boton]';
/** Input oculto que guarda la foto Base64 del objeto en curso. */
const ID_INPUT_FOTO = 'imagenBase64';

let iaDisponible = false;
let analizando = false;

function botones(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(SELECTOR_BOTONES));
}

/** true cuando el formulario ya tiene una foto cargada. */
function hayFotoCargada(): boolean {
  const input = document.getElementById(ID_INPUT_FOTO) as HTMLInputElement | null;
  return !!input && input.value.length > 0;
}

/** true cuando el health-check contra el motor de IA (Gemini) respondió OK. */
export function esIaDisponible(): boolean {
  return iaDisponible;
}

/** Pinta UN botón con el estado pedido (texto ↔ spinner + disabled). */
function pintar(boton: HTMLButtonElement, estado: EstadoBotonIA): void {
  const enAnalisis = estado === 'analizando';
  const texto = boton.querySelector<HTMLElement>('[data-ia-texto]');
  const spinner = boton.querySelector<HTMLElement>('[data-ia-spinner]');

  texto?.toggleAttribute('hidden', enAnalisis);
  spinner?.toggleAttribute('hidden', !enAnalisis);

  // Habilitado SOLO en estado "listo": el aspecto opaco lo aportan las clases
  // `disabled:opacity-50 disabled:cursor-not-allowed` del propio botón.
  boton.disabled = estado !== 'listo';
  boton.setAttribute('aria-busy', String(enAnalisis));
}

/** Estado que corresponde a los botones según foto + motor de IA + análisis. */
function estadoCorrespondiente(): EstadoBotonIA {
  if (analizando) return 'analizando';
  return iaDisponible && hayFotoCargada() ? 'listo' : 'inactivo';
}

/** Recalcula y pinta TODOS los botones IA de la página. */
export function refrescarBotonesIA(): void {
  const estado = estadoCorrespondiente();
  botones().forEach((boton) => pintar(boton, estado));
}

/** Registra si el motor de IA responde y repinta el botón. */
export function establecerIaDisponible(disponible: boolean): void {
  iaDisponible = disponible;
  refrescarBotonesIA();
}

/** Pone el botón en "Analizando..." (llamar SOLO tras un clic real). */
export function marcarAnalizandoIA(): void {
  analizando = true;
  refrescarBotonesIA();
}

/** Libera el modo "Analizando..." y devuelve el botón a su estado natural. */
export function liberarAnalizandoIA(): void {
  analizando = false;
  refrescarBotonesIA();
}

/**
 * Vincula el MISMO handler de clic a TODOS los botones IA (hoy uno solo), sin
 * listeners duplicados ni lógica paralela.
 */
export function vincularBotonesIA(handler: () => void | Promise<void>): void {
  botones().forEach((boton) => {
    boton.addEventListener('click', () => {
      if (boton.disabled) return;
      void handler();
    });
  });
}
