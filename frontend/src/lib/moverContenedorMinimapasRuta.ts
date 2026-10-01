// =============================================================================
// MIGA DE PAN VISUAL DEL MODAL «MOVER» (cadena de minimapas del encabezado)
// -----------------------------------------------------------------------------
// Al profundizar el recorrido, el plano ANTERIOR no se descarta: se «encoge» y
// sube al encabezado del modal como la cadena canónica de minimapas anidados de
// la app (lib/minimapasAnidados.ts → `.mini-anidado`), la MISMA que usan
// Almacenamiento y las tarjetas de Objetos. Así el operador ve de un vistazo en
// qué planta, en qué ambiente y en qué mueble está parado.
//
// La cadena se arma con la geometría REAL ya cargada por el controlador
// (estructura espacial del Estok activo) y con el MISMO traductor de sectores
// (lib/sectoresMinimapa.ts → sectoresDeItems) que el resto de los planos:
// cero geometría inventada, cero nodos de relleno.
//
// 100% puro: no toca el DOM ni hace fetch; solo devuelve los nodos.
// =============================================================================

import type { NodoRuta } from './minimapasAnidados';
import { sectoresDeItems } from './sectoresMinimapa';
import { plantasDe } from './espaciosDePlanta';
import { ambientesDePlanta, contenedoresDelAmbiente } from './moverContenedorMinimapasDatos';
import type { EstructuraMover } from './moverContenedorMinimapasDatos';

/** Punto del recorrido que la miga debe reflejar (estado del controlador). */
export interface RecorridoMover {
  /** FILA (1-based) de la planta activa. */
  planta: number;
  /** Ambiente abierto (null en el nivel de ambientes). */
  habitacionId: string | null;
  /** Mueble abierto (null fuera de su interior). */
  muebleId: string | null;
  /** Contenedor que se está moviendo: nunca se ofrece como destino. */
  contenedorId: string;
}

/**
 * Nodos de la cadena de contexto: planta (casita) → ambiente (con su plano de
 * ambientes y la habitación abierta en naranja) → mueble elegido (con el plano
 * de contenedores del ambiente y ese mueble en naranja).
 *
 * El nivel de detalle crece con el recorrido real: en el arranque solo viaja la
 * planta, al elegir un ambiente se agrega su plano y al abrir un mueble se agrega
 * su nodo. Nunca se declaran nodos sin datos.
 */
export function nodosMigaMover(
  estructura: EstructuraMover,
  recorrido: RecorridoMover,
): NodoRuta[] {
  const plantas = plantasDe(estructura.estok, estructura.ubicaciones);
  const planta = plantas.find((p) => p.fila === recorrido.planta) ?? plantas[0];
  const nodos: NodoRuta[] = [
    {
      tipo: 'planta',
      nombre: planta ? planta.etiqueta : 'Planta ' + recorrido.planta,
      filaActiva: recorrido.planta,
      totalPlantas: Math.max(1, plantas.length),
    },
  ];
  if (!recorrido.habitacionId) return nodos;

  // MAPA del ambiente: los ambientes de la planta con el abierto en naranja.
  const ambientes = ambientesDePlanta(estructura, recorrido.planta);
  const habitacion = ambientes.find((u) => String(u.id) === String(recorrido.habitacionId));
  nodos.push({
    id: recorrido.habitacionId,
    tipo: 'habitacion',
    nombre: habitacion ? habitacion.nombre : 'Ambiente',
    sectores: sectoresDeItems(ambientes, recorrido.habitacionId),
  });
  if (!recorrido.muebleId) return nodos;

  // MAPA del mueble: muebles/cajas raíz del ambiente con el elegido en naranja.
  const mueble = estructura.contenedores.find((c) => c.id === recorrido.muebleId);
  const hermanos = contenedoresDelAmbiente(
    estructura,
    recorrido.habitacionId,
    recorrido.contenedorId,
  );
  const sectores = hermanos.length ? hermanos : mueble ? [mueble] : [];
  if (!sectores.length) return nodos;
  nodos.push({
    id: recorrido.muebleId,
    tipo: 'mueble',
    nombre: mueble ? mueble.nombre : 'Mueble',
    sectores: sectoresDeItems(sectores, recorrido.muebleId),
  });
  return nodos;
}
