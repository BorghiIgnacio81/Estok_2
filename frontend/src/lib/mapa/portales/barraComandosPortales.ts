// =============================================================================
// BARRA DE COMANDOS DEL NIVEL ACTIVO (✏️ Editar ⇄ 💾 Guardar a toda profundidad)
// -----------------------------------------------------------------------------
// El interruptor de edición NO puede quedar secuestrado en el primer nivel: la
// cascada de Portales repinta el lienzo de CADA profundidad por innerHTML, así
// que la barra se re-sincroniza después de cada transición de nivel y el switch
// sigue operativo en CUALQUIER posición de la pila (`ruta: NodoPortal[]`).
//
//   · Nivel modelable (planta, habitación, mueble con divisiones, pieza con
//     sub-espacios arquitectónicos) → «✏️ Editar» VISIBLE, OPERATIVO y FUNCIONAL:
//     habilita la inyección de celdas elásticas (`data-lienzo-crear`) del lienzo
//     de ESE nivel, sin importar cuán hondo se haya descendido.
//   · ESPACIO FINAL (nivel terminal: declarado o sin sub-espacios
//     arquitectónicos) → ÚNICO caso que apaga la edición: el lienzo 2D se oculta,
//     «✏️ Editar» queda DESHABILITADO y el modo vuelve a navegación. El disyuntor
//     es REVERSIBLE: al destildarlo (o con «🧩 Modelar divisiones») el botón
//     reaparece en caliente.
//
// No duplica listeners: el clic lo atiende la DELEGACIÓN de lib/modoLienzo.ts,
// de modo que las barras inyectadas en caliente quedan vivas sin re-enlazar nada.
// =============================================================================

import { aplicarModo, modoLienzoActual, refrescarBotonesModo } from '../../modoLienzo';
import { nodoActual, profundidad } from './estadoPortales';
import { tieneModeladorGeometrico } from './panelesPortales';

/** Estado resuelto de la barra tras sincronizar el nivel recién pintado. */
export interface EstadoBarraComandos {
  /** Profundidad de la pila de nodos: 0 = raíz (planta), 1 = habitación, 2+ = piezas. */
  nivel: number;
  /** El nivel activo admite inyección de celdas elásticas (`data-lienzo-crear`). */
  modelable: boolean;
}

/** Micro-ayuda del botón de edición cuando el nivel activo es un Espacio Final. */
const TITULO_ESPACIO_FINAL =
  '🧱 Espacio Final: este nivel es terminal y no tiene lienzo 2D. Usá «🧩 Modelar divisiones» del panel (o destildá «Espacio Final» en el acordeón) para volver a subdividirlo.';

/**
 * Aplica la visibilidad/reactividad del interruptor «✏️ Editar» a TODAS las barras
 * del documento según el disyuntor vigente. AUTORIDAD ÚNICA: mientras el nivel
 * activo NO sea un Espacio Final el botón queda habilitado; al declararlo
 * terminal se deshabilita y el lienzo vuelve a navegación (el clic es PORTAL).
 *
 * Idempotente y re-invocable: sirve tanto tras repintar el nivel como para
 * reaccionar EN CALIENTE al tildar/destildar «Espacio Final».
 */
export function reflejarModoEdicion(modelable: boolean): void {
  // Sin modelador no hay nada que editar: el lienzo vuelve a modo navegación
  // para que el clic siga siendo disparador de PORTAL.
  if (!modelable && modoLienzoActual() === 'edicion') aplicarModo('navegacion');
  document.querySelectorAll<HTMLButtonElement>('[data-modo-editar]').forEach((btn) => {
    // El título original del marcado se memoriza UNA vez y se restituye siempre
    // que el nivel vuelva a admitir el modelador (sin duplicar micro-textos).
    if (!btn.dataset.tituloBase) btn.dataset.tituloBase = btn.title;
    btn.disabled = !modelable;
    btn.dataset.modelador = modelable ? '1' : '0';
    btn.title = modelable ? btn.dataset.tituloBase : TITULO_ESPACIO_FINAL;
  });
  refrescarBotonesModo();
}

/**
 * REACCIÓN EN CALIENTE AL DISYUNTOR «ESPACIO FINAL» (Lote 19): el ÚNICO estado
 * que apaga «✏️ Editar» es el nivel terminal. Al DESTILDARLO el botón reaparece de
 * inmediato, sin esperar al refresco de la cascada. Se invoca desde
 * `alternarEspacioFinal()` pasándole el valor tildado del checkbox.
 */
export function reaccionarEspacioFinal(espacioFinal: boolean): void {
  reflejarModoEdicion(!espacioFinal);
}

/**
 * Sincroniza la barra de comandos con el nivel activo. Devuelve el estado
 * resuelto (`nivel` + `modelable`) para que el orquestador pueda informarlo.
 */
export function sincronizarBarraComandos(): EstadoBarraComandos {
  const modelable = tieneModeladorGeometrico(nodoActual());
  reflejarModoEdicion(modelable);
  return { nivel: profundidad(), modelable };
}
