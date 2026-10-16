// =============================================================================
// ALTA RÁPIDA · CLASIFICACIÓN DEL OBJETO AL CREARLO (Lote 31 · punto 4)
// -----------------------------------------------------------------------------
// Los disyuntores de components/objetos/ClasificacionAltaRapida.astro son
// OPCIONALES y MUTUAMENTE EXCLUYENTES (Caja ⇄ Mueble). Este módulo:
//   1. Unifica el estado visual de la opción activa (clase .alta-opcion-activa).
//   2. Lee la clasificación elegida EN EL MOMENTO DEL ENVÍO
//      (`camposClasificacionAlta`), sin guardar estado propio: así el reseteo
//      absoluto del formulario (objetoFormCore.resetFormularioCompleto, que
//      desmarca todos los checkboxes) deja la clasificación limpia por definición.
//
// Mapeo persistido (SIN migraciones, sólo campos ya existentes del modelo Objeto):
//   · `es_contenedor = true` → el objeto puede contener otros objetos dentro
//     (campo del modelo aceptado por ObjetoCreateSerializer).
//   · `especificaciones.alta_rapida = 'caja' | 'mueble'` → conserva la DISTINCIÓN
//     elegida dentro del JSON libre `especificaciones` del objeto.
//     DRF parsea el string del multipart en su JSONField (JSONField.get_value
//     envuelve el valor de los formularios HTML como JSONString → json.loads).
//
// Ninguna casilla marcada → se envía `es_contenedor=false` (objeto simple:
// comportamiento histórico del alta, sin cambios).
// =============================================================================

const SELECTOR = '[data-alta-clasificacion]';
const CLASE_ACTIVA = 'alta-opcion-activa';
const CLAVE_ESPECIFICACIONES = 'alta_rapida';

/** Clasificaciones admitidas por el alta rápida. */
export type ClasificacionAlta = 'caja' | 'mueble';

export interface ClasificacionSeleccionada {
  /** true cuando el operador marcó «📦 Caja» o «🚪 Mueble». */
  esContenedor: boolean;
  /** Clasificación elegida (null = objeto simple, sin marcar nada). */
  clasificacion: ClasificacionAlta | null;
}

function casillas(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(SELECTOR));
}

/** Refleja el estado de las casillas en el resalte visual de su tarjeta. */
export function sincronizarClasificacionAlta(): void {
  for (const casilla of casillas()) {
    casilla
      .closest<HTMLElement>('[data-alta-opcion]')
      ?.classList.toggle(CLASE_ACTIVA, casilla.checked);
  }
}

/**
 * Inicializa los disyuntores de clasificación del alta de objetos.
 * Idempotente: se puede llamar desde /objetos/nuevo y desde el tutorial.
 */
export function initObjetoClasificacionAlta(): void {
  for (const casilla of casillas()) {
    if (casilla.dataset.altaActivo === 'true') continue;
    casilla.dataset.altaActivo = 'true';
    casilla.addEventListener('change', () => {
      // MUTUA EXCLUSIÓN: marcar una casilla desmarca la otra (Caja ⇄ Mueble).
      if (casilla.checked) {
        for (const otra of casillas()) {
          if (otra !== casilla) otra.checked = false;
        }
      }
      sincronizarClasificacionAlta();
    });
  }
  sincronizarClasificacionAlta();
}

/** Clasificación elegida AHORA (leída del DOM: no hay estado duplicado). */
export function leerClasificacionAlta(): ClasificacionSeleccionada {
  const marcada = casillas().find((casilla) => casilla.checked);
  const clasificacion =
    (marcada?.dataset.altaClasificacion as ClasificacionAlta | undefined) ?? null;
  return { esContenedor: clasificacion !== null, clasificacion };
}

/** Campos del alta rápida listos para el FormData del POST /api/objetos/. */
export function camposClasificacionAlta(): Record<string, string> {
  const { esContenedor, clasificacion } = leerClasificacionAlta();
  const campos: Record<string, string> = {
    es_contenedor: esContenedor ? 'true' : 'false',
  };
  if (clasificacion) {
    campos.especificaciones = JSON.stringify({ [CLAVE_ESPECIFICACIONES]: clasificacion });
  }
  return campos;
}
