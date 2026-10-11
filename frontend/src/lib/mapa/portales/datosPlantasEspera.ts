// =============================================================================
// DATOS DEL ESTADO DE ESPERA INICIAL (minimapas independientes por planta)
// -----------------------------------------------------------------------------
// Alimenta el Panel Derecho del Nivel Estok cuando NINGUNA planta está activa:
// agrupa las habitaciones REALES por su división (planta) para dibujar un
// mini-mapa independiente por cada una, sin clonar un solo plano.
// Módulo de DATOS: no toca el DOM, no conoce Tailwind (auth centralizada vía
// datosNodosPortales → services/auth).
// =============================================================================

import { esDivisionUbicacion } from '../../mapaJerarquico';
import type { UbicacionPlano } from '../../mapaJerarquico';
import { cargarContenedores, cargarUbicaciones } from './datosNodosPortales';
import type { ContenedorDto } from './datosNodosPortales';

/** Agrupación lista para el estado de espera inicial del Nivel Estok. */
export interface DatosPlantasEspera {
  /** Divisiones (plantas) del Estok activo, ordenadas por fila del macro-plano. */
  plantas: UbicacionPlano[];
  /** Habitaciones reales de cada planta, indexadas por el id de su división. */
  habitacionesPorPlanta: Map<string, UbicacionPlano[]>;
  /** Espacios internos de cada habitación (contadores del rótulo). */
  espaciosPorRoom: Map<string, ContenedorDto[]>;
}

/** Agrupa las plantas y sus habitaciones para el estado de espera inicial. */
export async function datosDePlantasIndependientes(): Promise<DatosPlantasEspera> {
  const todas = await cargarUbicaciones();
  const plantas = todas
    .filter(esDivisionUbicacion)
    .sort((a, b) => (a.parent_grid_row || 1) - (b.parent_grid_row || 1));
  const sueltas = todas.filter((u) => !esDivisionUbicacion(u));
  const habitacionesPorPlanta = new Map<string, UbicacionPlano[]>();
  for (const planta of plantas) {
    const fila = planta.parent_grid_row || 1;
    // Encastradas en la división + sueltas legacy de esa fila (misma física que
    // dominioCasita.habitacionesDePlanta, sin duplicar su lógica).
    habitacionesPorPlanta.set(
      String(planta.id),
      sueltas.filter(
        (u) =>
          u.parent_ubicacion === String(planta.id) ||
          (!u.parent_ubicacion && (u.parent_grid_row || 1) === fila),
      ),
    );
  }
  const conts = await cargarContenedores();
  const espaciosPorRoom = new Map<string, ContenedorDto[]>();
  for (const c of conts) {
    if (c.parent_contenedor || !c.ubicacion) continue;
    const lista = espaciosPorRoom.get(c.ubicacion) ?? [];
    lista.push(c);
    espaciosPorRoom.set(c.ubicacion, lista);
  }
  return { plantas, habitacionesPorPlanta, espaciosPorRoom };
}
