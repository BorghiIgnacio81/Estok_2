// =============================================================================
// DESTINOS DE NAVEGACIÓN DEL ALTA — FUENTE ÚNICA
// -----------------------------------------------------------------------------
// Tras fundar (o adoptar) un Estok, el usuario debe caer SIEMPRE en el modelador
// interactivo y no en el Dashboard seco. La constante canónica vive acá y la
// consumen TODOS los anfitriones del alta:
//   · pages/estoks/index.astro            → alta desde el panel admin
//   · lib/onboarding/wizard.ts            → cierre del asistente de bienvenida
// Nunca duplicar el string '/almacenamiento' en otro archivo.
// =============================================================================

/** Pantalla canónica a la que se redirige al usuario una vez fundado/activado el Estok. */
export const DESTINO_POST_ALTA = '/almacenamiento';
