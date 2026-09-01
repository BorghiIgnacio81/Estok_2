// =============================================================================
// MAPA DE ESTOK - RECONSTRUCCIÓN DEL ÁRBOL DESDE DATOS EXISTENTES
// -----------------------------------------------------------------------------
// El wizard "Mapa de Estok" se reutiliza en Almacenamiento con
// "✏️ Editar Estructura": en vez de empezar de cero, carga el estado actual
// (divisiones → habitaciones → muebles → estanterías) matcheando cada celda
// por sus coordenadas parent_grid_row / parent_grid_col dentro de la grilla
// de su nodo padre.
//
// Nivel 1 unificado: una Ubicación es DIVISIÓN si está posicionada en el
// macro-plano (parent_grid_row) sin parent_ubicacion. Cubre el modelo legacy
// (fila sin columna) y el del wizard (celda fila × columna).
// =============================================================================

import {
  clampGrilla,
  totalCeldas,
  coordenadasDeIndice,
  crearCelda,
} from './mapaEstokWizard';
import type { CeldaWizard } from './mapaEstokWizard';

// =============================================================================
// TIPOS DTO (respuestas de /api/ubicaciones/ y /api/contenedores/)
// =============================================================================

export interface UbiDTO {
  id: string;
  nombre: string;
  piso?: string;
  parent_ubicacion?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  grid_filas?: number | null;
  grid_columnas?: number | null;
  grid_filas_config?: number[] | null;
}

export interface ContDTO {
  id: string;
  nombre: string;
  ubicacion?: string | null;
  parent_contenedor?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  grid_filas?: number | null;
  grid_columnas?: number | null;
  grid_filas_config?: number[] | null;
}

export interface DatosEstructuraEstok {
  grid_filas: number;
  grid_columnas: number;
  grid_filas_config: number[] | null;
  celdas: CeldaWizard[];
}

// =============================================================================
// RECONSTRUCCIÓN
// =============================================================================

function configNormalizada(config: number[] | null | undefined, filas: number): number[] | null {
  if (!Array.isArray(config) || config.length !== filas) return null;
  return config.map((c) => clampGrilla(c));
}

/** Reconstruye el árbol completo del wizard a partir de los datos del backend. */
export function estructuraDesdeDatos(
  estok: { grid_filas?: number | null; grid_columnas?: number | null; grid_filas_config?: number[] | null },
  ubicaciones: UbiDTO[],
  contenedores: ContDTO[],
): DatosEstructuraEstok {
  const filas = clampGrilla(Number(estok.grid_filas) || 2);
  const columnas = clampGrilla(Number(estok.grid_columnas) || 2);
  const config = configNormalizada(estok.grid_filas_config, filas);

  // Nivel 1 = Ubicaciones posicionadas en el macro-plano sin encastrar
  // (parent_ubicacion null). Cubre el modelo legacy (fila sin columna) y el
  // del wizard (celda fila × columna).
  const divisiones = ubicaciones.filter((u) => u.parent_grid_row && !u.parent_ubicacion);
  // Nivel 2 = Ubicaciones encastradas dentro de una división.
  const habitaciones = ubicaciones.filter((u) => u.parent_ubicacion);
  // Nivel 3 = Contenedores raíz (sin parent_contenedor); Nivel 4 = sub-cajas.
  const contsRaiz = contenedores.filter((c) => !c.parent_contenedor);
  const subs = contenedores.filter((c) => c.parent_contenedor);

  const celdas: CeldaWizard[] = [];
  const total = totalCeldas(filas, columnas, config);
  for (let i = 0; i < total; i++) {
    const { fila, col } = coordenadasDeIndice(i, filas, columnas, config);
    // 1) División de celda (fila + columna) del modelo wizard.
    const divCelda = divisiones.find((d) => d.parent_grid_row === fila && d.parent_grid_col === col) ?? null;
    // 2) División de fila (columna null) del modelo legacy → se mapea a la
    //    primera celda de la fila (col === 1) junto con sus habitaciones.
    const divLegacy = !divCelda && col === 1
      ? (divisiones.find((d) => d.parent_grid_row === fila && !d.parent_grid_col) ?? null)
      : null;
    celdas.push(celdaDivision(divCelda ?? divLegacy, fila, col, habitaciones, contsRaiz, subs));
  }
  return { grid_filas: filas, grid_columnas: columnas, grid_filas_config: config, celdas };
}

function celdaBase(
  item: UbiDTO | ContDTO | null,
  fila: number,
  col: number,
  nivel: number,
): CeldaWizard {
  if (item) {
    const filas = clampGrilla(Number(item.grid_filas) || 2);
    return {
      id: item.id,
      nombre: item.nombre,
      grid_filas: filas,
      grid_columnas: clampGrilla(Number(item.grid_columnas) || 2),
      grid_filas_config: configNormalizada(item.grid_filas_config, filas),
      hijos: [],
    };
  }
  return crearCelda(nivel, fila, col);
}

function celdaDivision(
  div: UbiDTO | null,
  fila: number,
  col: number,
  habitaciones: UbiDTO[],
  contsRaiz: ContDTO[],
  subs: ContDTO[],
): CeldaWizard {
  const celda = celdaBase(div, fila, col, 1);
  if (!div) return celda;
  const filas = clampGrilla(Number(div.grid_filas) || 2);
  const columnas = clampGrilla(Number(div.grid_columnas) || 2);
  const config = configNormalizada(div.grid_filas_config, filas);
  celda.grid_filas = filas;
  celda.grid_columnas = columnas;
  celda.grid_filas_config = config;
  const divHabs = habitaciones.filter((h) => h.parent_ubicacion === div.id);
  const total = totalCeldas(filas, columnas, config);
  const hijos: CeldaWizard[] = [];
  for (let i = 0; i < total; i++) {
    const { fila: f2, col: c2 } = coordenadasDeIndice(i, filas, columnas, config);
    const hab = divHabs.find((h) => h.parent_grid_row === f2 && h.parent_grid_col === c2) ?? null;
    hijos.push(celdaHabitacion(hab, f2, c2, contsRaiz, subs));
  }
  celda.hijos = hijos;
  return celda;
}

function celdaHabitacion(
  hab: UbiDTO | null,
  fila: number,
  col: number,
  contsRaiz: ContDTO[],
  subs: ContDTO[],
): CeldaWizard {
  const celda = celdaBase(hab, fila, col, 2);
  if (!hab) return celda;
  const filas = clampGrilla(Number(hab.grid_filas) || 2);
  const columnas = clampGrilla(Number(hab.grid_columnas) || 2);
  const config = configNormalizada(hab.grid_filas_config, filas);
  celda.grid_filas = filas;
  celda.grid_columnas = columnas;
  celda.grid_filas_config = config;
  const contsHab = contsRaiz.filter((c) => c.ubicacion === hab.id);
  const total = totalCeldas(filas, columnas, config);
  const hijos: CeldaWizard[] = [];
  for (let i = 0; i < total; i++) {
    const { fila: f3, col: c3 } = coordenadasDeIndice(i, filas, columnas, config);
    const cont = contsHab.find((c) => c.parent_grid_row === f3 && c.parent_grid_col === c3) ?? null;
    hijos.push(celdaMueble(cont, f3, c3, subs));
  }
  celda.hijos = hijos;
  return celda;
}

function celdaMueble(
  cont: ContDTO | null,
  fila: number,
  col: number,
  subs: ContDTO[],
): CeldaWizard {
  const celda = celdaBase(cont, fila, col, 3);
  if (!cont) return celda;
  const filas = clampGrilla(Number(cont.grid_filas) || 2);
  const columnas = clampGrilla(Number(cont.grid_columnas) || 2);
  const config = configNormalizada(cont.grid_filas_config, filas);
  celda.grid_filas = filas;
  celda.grid_columnas = columnas;
  celda.grid_filas_config = config;
  const subsCont = subs.filter((s) => s.parent_contenedor === cont.id);
  const total = totalCeldas(filas, columnas, config);
  const hijos: CeldaWizard[] = [];
  for (let i = 0; i < total; i++) {
    const { fila: f4, col: c4 } = coordenadasDeIndice(i, filas, columnas, config);
    const sub = subsCont.find((s) => s.parent_grid_row === f4 && s.parent_grid_col === c4) ?? null;
    hijos.push(celdaBase(sub, f4, c4, 4));
  }
  celda.hijos = hijos;
  return celda;
}

