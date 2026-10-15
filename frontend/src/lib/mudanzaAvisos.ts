// =============================================================================
// AVISOS Y MENSAJES DEL TABLERO DE MUDANZAS (módulo puro, sin estado)
// -----------------------------------------------------------------------------
// Fuente ÚNICA del feedback al operador en la pantalla de Mudanza Inter-Estok:
//   · `notificar` → aviso flotante global (`window.showSuccess/showError`) que
//     define el layout base (BaseLayout.astro).
//   · `mensajeDe` → texto humano de cualquier excepción capturada.
// Se extrajo de mudanzaBoard.ts (Lote 27) para sostener el límite de 400 líneas
// por archivo sin duplicar la lógica de avisos.
// =============================================================================

/** Aviso flotante global del proyecto (definido en el layout base). */
export function notificar(tipo: 'showSuccess' | 'showError', mensaje: string): void {
  const win = window as unknown as Partial<Record<'showSuccess' | 'showError', (m: string) => void>>;
  win[tipo]?.(mensaje);
}

/** Mensaje legible de una excepción capturada (nunca devuelve vacío). */
export function mensajeDe(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'No se pudo completar la operación.';
}
