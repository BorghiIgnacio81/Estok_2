// =============================================================================
// BARRA DE COMANDOS DEL NIVEL ACTIVO (✏️ Editar ⇄ 💾 Guardar a toda profundidad)
// -----------------------------------------------------------------------------
// El interruptor de edición NO puede quedar secuestrado en el primer nivel: la
// cascada de Portales repinta el lienzo de CADA profundidad por innerHTML, así
// que la barra se re-sincroniza después de cada transición de nivel y el switch
// sigue operativo en CUALQUIER posición de la pila (`ruta: NodoPortal[]`).
//
//   · Nivel NO monolítico (planta, habitación, mueble, estante, caja o pieza
//     VACÍA recién creada) → «✏️ Editar» VISIBLE, OPERATIVO y FUNCIONAL: habilita
//     la inyección de celdas elásticas (`data-lienzo-crear`) del lienzo de ESE
//     nivel, sin importar cuán hondo se haya descendido.
//   · «Espacio Único» declarado (`espacio_unico = true`) → ÚNICO caso que apaga la
//     edición: «✏️ Editar» queda DESHABILITADO y el modo vuelve a navegación.
//     El disyuntor es REVERSIBLE: al DESTILDARLO el botón reaparece en caliente.
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

/** Micro-ayuda del botón de edición cuando el nivel activo es monolítico. */
const TITULO_MONOLITICO =
  '🧱 Espacio Único: este bloque es monolítico y no admite subdivisiones internas. Destildá «Espacio Único» para volver a dividirlo.';

/**
 * Aplica la visibilidad/reactividad del interruptor «✏️ Editar» a TODAS las barras
 * del documento según el disyuntor vigente. AUTORIDAD ÚNICA: mientras el nivel
 * activo NO sea «Espacio Único» el botón queda habilitado; al declararlo monolítico
 * se deshabilita y el lienzo vuelve a navegación (el clic vuelve a ser PORTAL).
 *
 * Idempotente y re-invocable: sirve tanto tras repintar el nivel como para
 * reaccionar EN CALIENTE al tildar/destildar «Espacio Único».
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
    btn.title = modelable ? btn.dataset.tituloBase : TITULO_MONOLITICO;
  });
  refrescarBotonesModo();
}

/**
 * REACCIÓN EN CALIENTE AL DISYUNTOR «ESPACIO ÚNICO» (Lote 19): el ÚNICO estado que
 * apaga «✏️ Editar» es `espacio_unico = true`. Al DESTILDARLO el botón reaparece de
 * inmediato, sin esperar al refresco de la cascada. Se invoca desde
 * `alternarEspacioUnico()` pasándole el valor tildado del checkbox.
 */
export function reaccionarEspacioUnico(espacioUnico: boolean): void {
  reflejarModoEdicion(!espacioUnico);
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
