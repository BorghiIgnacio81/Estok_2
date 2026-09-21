// =============================================================================
// ASISTENTE DE BIENVENIDA — HELPERS COMPARTIDOS ENTRE PASOS
// -----------------------------------------------------------------------------
// Utilidades transversales que necesitan TODOS los controladores del asistente
// (wizard.ts + pasoEspacios.ts) sin crear dependencias circulares:
//   - mensajeDe   : texto legible de cualquier error (Error nativo o AuthError).
//   - avisoGlobal : aviso flotante global del proyecto (showSuccess/Info/Warning).
// Fuente ÚNICA: ninguna pantalla del asistente reimplementa estos helpers.
// =============================================================================

/** Mensaje legible de cualquier error (Error nativo o AuthError del backend). */
export function mensajeDe(err: unknown, porDefecto: string): string {
  const e = err as { error?: string; message?: string } | null;
  return e?.error || e?.message || porDefecto;
}

/** Aviso global del proyecto (usa el toast nativo si la página lo expone). */
export function avisoGlobal(mensaje: string): void {
  const w = window as unknown as {
    showSuccess?: (m: string) => void;
    showInfo?: (m: string) => void;
    showWarning?: (m: string) => void;
  };
  (w.showSuccess ?? w.showInfo ?? w.showWarning ?? (() => undefined))(mensaje);
}
