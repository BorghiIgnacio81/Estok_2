// =============================================================================
// BARRA DE COMANDOS DEL NIVEL ACTIVO (✏️ Editar ⇄ 💾 Guardar a toda profundidad)
// -----------------------------------------------------------------------------
// El interruptor de edición NO puede quedar secuestrado en el primer nivel: la
// cascada de Portales repinta el lienzo de CADA profundidad por innerHTML, así
// que la barra se re-sincroniza después de cada transición de nivel y el switch
// sigue operativo en CUALQUIER posición de la pila (`ruta: NodoPortal[]`).
//
//   · Nivel con modelador (plano de planta, Visor de Habitación o sub-grilla de
//     un contenedor) → «✏️ Editar» VISIBLE, OPERATIVO y FUNCIONAL: habilita la
//     inyección de celdas elásticas (`data-lienzo-crear`) del lienzo de ESE
//     nivel, sin importar cuán hondo se haya descendido.
//   · Bloque monolítico («Espacio Único») → «✏️ Editar» visible pero
//     DESHABILITADO (no hay modelador que abrir) y el modo vuelve a navegación.
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
  '🧱 Espacio Único: este bloque es monolítico y no admite subdivisiones internas.';

/**
 * Sincroniza la barra de comandos con el nivel activo. Devuelve el estado
 * resuelto (`nivel` + `modelable`) para que el orquestador pueda informarlo.
 */
export function sincronizarBarraComandos(): EstadoBarraComandos {
  const modelable = tieneModeladorGeometrico(nodoActual());
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
  return { nivel: profundidad(), modelable };
}
