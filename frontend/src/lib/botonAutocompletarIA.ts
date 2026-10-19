// =============================================================================
// ESTADO DEL BOTÓN "AUTOCOMPLETAR CON IA" (Alta / edición de Objetos)
// -----------------------------------------------------------------------------
// El botón se habilita SIEMPRE que haya una foto disponible: no depende de
// ningún heartbeat ni health-check del motor. La IA es 100% en la nube (Google
// Gemini) y el fallo real se informa por toast al analizar, sin bloquear el
// llenado manual del formulario.
//
//   inactivo   → sin foto cargada: disabled + aspecto opaco.
//   listo      → texto fijo "Autocompletar con IA", listo para hacer clic.
//   analizando → spinner + "Analizando..." SOLO tras un clic real del usuario.
//
// El estado se aplica a TODOS los nodos `[data-ia-boton]` de la página en una
// sola pasada (`pintar()`), así el módulo sigue valiendo si el botón se monta
// en otra sección más adelante.
//
// Fuente de la foto:
//   · Alta (/objetos/nuevo): input oculto #imagenBase64 (cámara/galería/drag).
//   · Edición (/objetos/<id>/editar): `establecerFotoDisponible()` informa si el
//     objeto ya tiene fotos cargadas en el servidor.
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

/** Botones IA de la pantalla (alta: Fotos del Objeto; edición: Fotos). */
const SELECTOR_BOTONES = '[data-ia-boton]';
/** Input oculto que guarda la foto Base64 del objeto en curso (alta). */
const ID_INPUT_FOTO = 'imagenBase64';

let analizando = false;
/** null → se deduce del input #imagenBase64; true/false → lo fija la pantalla. */
let fotoDisponibleManual: boolean | null = null;

function botones(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(SELECTOR_BOTONES));
}

/** true cuando el formulario ya tiene una foto disponible para analizar. */
function hayFotoCargada(): boolean {
  if (fotoDisponibleManual !== null) return fotoDisponibleManual;
  const input = document.getElementById(ID_INPUT_FOTO) as HTMLInputElement | null;
  return !!input && input.value.length > 0;
}

/**
 * Fija si hay foto disponible (pantalla de edición). En el alta NO se llama:
 * el estado se deduce del input #imagenBase64.
 */
export function establecerFotoDisponible(disponible: boolean): void {
  fotoDisponibleManual = disponible;
  refrescarBotonesIA();
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

/** Estado que corresponde a los botones según foto disponible + análisis. */
function estadoCorrespondiente(): EstadoBotonIA {
  if (analizando) return 'analizando';
  return hayFotoCargada() ? 'listo' : 'inactivo';
}

/** Recalcula y pinta TODOS los botones IA de la página. */
export function refrescarBotonesIA(): void {
  const estado = estadoCorrespondiente();
  botones().forEach((boton) => pintar(boton, estado));
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
