// =============================================================================
// ASISTENTE DE PLANTILLAS 2D · «⚡ USAR PLANTILLA» DE LA PROPIEDAD (Nivel 1)
// -----------------------------------------------------------------------------
// Punto de entrada del Nivel 1 que NO depende de un botón interno del lienzo:
// lo dispara la cabecera de /almacenamiento con `[data-usar-plantilla]`.
//
// FLUJO (idéntico al del botón «➕ Habitación» del Mapa Estok):
//   Paso 1 → conteo de ambientes (dormitorios, baños, cocina, living).
//   Paso 2 → 4 maquetas 2D vectoriales.
//   Paso 3 → inserción REAL: cada ambiente se persiste como Ubicación con su
//            geometría ui_* en la planta activa.
// Al terminar, el evento canónico `estok:espacios-cambiados` repinta el lienzo
// con los ambientes YA COLOCADOS, listos para retocar bordes o tamaños desde
// «🛠️ Crear desde cero» (modo edición in-place).
//
// Módulo de EFECTOS: sólo resuelve la planta destino y delega el alta real en
// cargaCasita.ts; el asistente y el repintado viven en sus módulos canónicos.
// =============================================================================

import { estado } from './estadoCasita';
import { esPlantaUnica } from './dominioCasita';
import { crearEnDepartamento, crearHabitacionEnPlanta } from './cargaCasita';
import { abrirGeneradorPlanta, refrescarLienzoCasita } from '../mapaCasitaNavegable';

/**
 * Abre el Generador Visual Espacial del Nivel 1 (propiedad / Estok).
 *
 * · Modo Planta Única → inserta en el contenedor «Departamento» (se crea si
 *   todavía no existe).
 * · Modo Casa → usa la planta activa o, si no hay ninguna fijada, la primera
 *   registrada; la fija para que los ambientes recién creados queden dibujados
 *   en el lienzo derecho.
 *
 * Devuelve false cuando todavía no hay una planta donde insertar los ambientes.
 */
export function abrirPlantillasPropiedad(): boolean {
  if (esPlantaUnica(estado.estok, estado.divisiones)) {
    abrirGeneradorPlanta('Distribución del departamento', crearEnDepartamento);
    return true;
  }

  const fila = estado.filaActiva ?? estado.divisiones[0]?.parent_grid_row ?? null;
  const div = fila
    ? estado.divisiones.find((d) => d.parent_grid_row === fila) ?? null
    : null;
  if (!div) return false;

  // La planta destino queda seleccionada ANTES de insertar: al cerrarse el
  // asistente el lienzo ya muestra las habitaciones de esa planta.
  if (estado.filaActiva !== fila) {
    estado.filaActiva = fila;
    refrescarLienzoCasita();
  }

  abrirGeneradorPlanta(`Distribución de «${div.nombre}»`, (nuevo) =>
    crearHabitacionEnPlanta(div, nuevo),
  );
  return true;
}