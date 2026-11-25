// =============================================================================
// COLA ÚNICA DE NAVEGACIÓN DE LA CASCADA (serialización + espera de refrescos)
// -----------------------------------------------------------------------------
// Un mismo gesto del operador puede disparar DOS navegaciones: el evento público
// del visor histórico (`estok:mueble-seleccionado` / `estok:habitacion-seleccionada`)
// y la DELEGACIÓN del clic en el panel. Ejecutadas en paralelo, esas navegaciones
// intercalan `desapilarHasta()` y `empujarNodo()` y dejan en la pila un nodo
// duplicado o un nivel de más: la izquierda (padre) y la derecha (activo)
// terminaban mostrando el MISMO espacio y los datos del «espacio anterior» se
// leían como si fueran del seleccionado.
//
// Acá vive la ÚNICA cola: cada navegación corre después de la anterior y espera a
// que la pantalla deje de refrescarse, de modo que el espacio activo y el nivel
// pintado nunca divergen. Sin estado propio de la cascada ni acceso al DOM.
// =============================================================================

import { estaRefrescando } from './portalesAlmacenamiento';

/** Tope de espera antes de navegar igual (el render normal tarda << 1 s). */
const ESPERA_MAXIMA_MS = 1500;
/** Grano del sondeo del disyuntor `refrescando`. */
const PASO_MS = 30;

/** Cadena de navegaciones: siempre secuencial, nunca en paralelo. */
let colaNavegacion: Promise<void> = Promise.resolve();

/**
 * Encola una navegación. Un fallo (red, nodo inexistente) jamás rompe la cola de
 * las navegaciones siguientes.
 */
export function enColaNavegacion(tarea: () => Promise<void>): void {
  colaNavegacion = colaNavegacion.then(tarea).catch(() => {
    /* la próxima navegación vuelve a intentarlo con el estado vigente */
  });
}

/**
 * Espera (máx. `ESPERA_MAXIMA_MS`) a que el refresco en vuelo termine antes de
 * navegar: un clic que llega mientras el nivel se repinta (latido de cambios) NO
 * se pierde ni compite con ese refresco.
 */
export async function esperarSinRefresco(): Promise<void> {
  const inicio = Date.now();
  while (estaRefrescando() && Date.now() - inicio < ESPERA_MAXIMA_MS) {
    await new Promise((resolver) => window.setTimeout(resolver, PASO_MS));
  }
}
