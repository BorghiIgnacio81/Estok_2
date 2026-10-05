// =============================================================================
// HELPERS COMUNES DE LA CARGA MANUAL DE OBJETO (/objetos/nuevo)
// -----------------------------------------------------------------------------
// Utilidades de apoyo compartidas por los módulos de src/lib/objetos/ que
// nacieron al desmantelar el <script> de pages/objetos/nuevo.astro (regla de
// modularización <400 líneas por archivo):
//   · mensajeError   → texto legible de un error capturado en un catch.
//   · inputDeEvento  → tipa e.target como HTMLInputElement (change/input).
//   · claves de sessionStorage de la carga en curso (fotos y formulario).
//   · id canónico del input oculto que guarda la foto Base64 del objeto.
// Son utilidades puras: no tocan el DOM por su cuenta ni definen estado.
// =============================================================================

/** Extrae el mensaje legible de un error capturado en un catch. */
export function mensajeError(err: unknown): string {
  if (err instanceof Error) return err.message || 'Error desconocido';
  if (typeof err === 'string') return err;
  return 'Error desconocido';
}

/** Tipa e.target como HTMLInputElement en eventos change/input. */
export function inputDeEvento(e: Event): HTMLInputElement | null {
  return e.target as HTMLInputElement | null;
}

/** Claves de sessionStorage que sobreviven a un refresco (F5) del formulario. */
export const CLAVE_FOTOS = 'nuevo_objeto_fotos';
export const CLAVE_FOTO_LEGADA = 'nuevo_objeto_foto';
export const CLAVE_FORM = 'nuevo_objeto_form';

/** Input oculto que guarda la foto Base64 del objeto en curso. */
export const ID_INPUT_FOTO = 'imagenBase64';
