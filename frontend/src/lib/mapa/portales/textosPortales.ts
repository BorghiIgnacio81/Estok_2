// =============================================================================
// TEXTOS CANÓNICOS DEL MOTOR DE PORTALES
// -----------------------------------------------------------------------------
// Cadenas de interfaz compartidas por más de un módulo de Almacenamiento. Viven
// acá (sin imports) para que los módulos PUROS de decisión —panelesPortales.ts—
// y los módulos de render —contenidoInternoNodo.ts— usen EXACTAMENTE el mismo
// texto sin acoplarse entre sí ni duplicar la cadena.
// =============================================================================

/**
 * TÍTULO EXACTO DE LAS CAJAS DE UN NIVEL TERMINAL:
 * «📦 Cajas y piezas de este nivel · tocá una para ver su contenido y soltarle
 * objetos».
 *
 *   · Encabezado del Panel Derecho en un Espacio Final (reemplaza a la leyenda
 *     «Interior jerárquico de la pieza activa…»).
 *   · Título del selector de piezas del explorador modelable.
 */
export const TITULO_CAJAS_NIVEL =
  '📦 Cajas y piezas de este nivel · tocá una para ver su contenido y soltarle objetos';
