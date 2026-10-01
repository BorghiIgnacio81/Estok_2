// =============================================================================
// DERIVACIONES DEL RECORRIDO DEL MODAL «MOVER» (niveles, destinos y migas)
// -----------------------------------------------------------------------------
// 100% puro: traduce el estado del recorrido (planta / ambiente / mueble / nivel)
// a los SECTORES reales que dibuja el plano elástico, al DESTINO final de cada
// sector y a los nombres de la miga de pan textual.
//
// Vive en su propio módulo para que el controlador
// (lib/moverContenedorMinimapas.ts) quede solo con estado, eventos y persistencia,
// por debajo del límite de modularidad del proyecto.
//
// Toda la geometría viaja desde el motor de sectores (lib/sectoresMinimapa.ts →
// sectoresDeItems) y desde las derivaciones del interior del mueble
// (lib/moverContenedorMinimapasDatos.ts): acá no se inventa ninguna silueta.
// =============================================================================

import type { SectorMinimapa } from './minimapa';
import { sectoresDeItems } from './sectoresMinimapa';
import {
  ambientesDePlanta,
  cajasDelMueble,
  casilleroDeId,
  casillerosDelMueble,
  contenedorPorId,
  contenedoresDelAmbiente,
} from './moverContenedorMinimapasDatos';
import type { EstructuraMover } from './moverContenedorMinimapasDatos';

/** Nivel visible: 0 ambientes · 1 contenedores · 2 interior del mueble. */
export type NivelRecorrido = 0 | 1 | 2;

/** Estado del recorrido que consumen las derivaciones. */
export interface RecorridoNiveles {
  /** FILA (1-based) de la planta activa. */
  planta: number;
  /** Ambiente abierto (null en el nivel de ambientes). */
  habitacionId: string | null;
  /** Mueble abierto (null fuera de su interior). */
  muebleId: string | null;
  /** Nivel visible del recorrido. */
  nivel: NivelRecorrido;
}

/** Destino final del traslado (ambiente, contenedor o casillero del mueble). */
export interface Destino {
  tipo: 'habitacion' | 'contenedor';
  id: string;
  nombre: string;
  /** Ubicación que viaja en el PUT (ambiente del destino final). */
  ubicacionId: string;
  /**
   * Casillero F·C del destino dentro de la cuadrícula del mueble abierto
   * (`casillero:F:C`). Null en ambientes y en destinos por ID de contenedor.
   */
  casillero?: { fila: number; col: number } | null;
}

/** Mueble ABIERTO del recorrido (null en los niveles de ambiente/contenedores). */
function muebleActual(estructura: EstructuraMover, recorrido: RecorridoNiveles) {
  return contenedorPorId(estructura, recorrido.muebleId);
}

/** Destino final al que apunta un sector del plano (ambiente, contenedor o casillero). */
export function destinoDeSector(
  estructura: EstructuraMover,
  recorrido: RecorridoNiveles,
  sectorId: string,
): Destino | null {
  if (!sectorId) return null;
  // CASILLERO INTERNO (`casillero:F:C`): el destino es el mueble ABIERTO con su
  // coordenada de grilla, el mismo payload que persiste el arrastre del Visor de
  // Contenedores. Solo existe mientras el mueble está abierto.
  const casillero = casilleroDeId(sectorId);
  if (casillero) {
    const mueble = muebleActual(estructura, recorrido);
    if (!mueble) return null;
    return {
      tipo: 'contenedor',
      id: mueble.id,
      nombre: mueble.nombre + ' · F' + casillero.fila + '·C' + casillero.col,
      ubicacionId: mueble.ubicacion || recorrido.habitacionId || '',
      casillero,
    };
  }
  const habitacion = estructura.ubicaciones.find((u) => String(u.id) === sectorId);
  if (habitacion) {
    return {
      tipo: 'habitacion',
      id: String(habitacion.id),
      nombre: habitacion.nombre,
      ubicacionId: String(habitacion.id),
    };
  }
  const destino = estructura.contenedores.find((c) => c.id === sectorId);
  if (!destino) return null;
  return {
    tipo: 'contenedor',
    id: destino.id,
    nombre: destino.nombre,
    ubicacionId: destino.ubicacion || recorrido.habitacionId || '',
  };
}

/**
 * Sectores REALES del nivel visible (geometría ui_* de PostgreSQL) + su ayuda.
 * Sin geometría devuelve el aviso explicativo: el asistente JAMÁS dibuja un plano
 * inventado, y el interior de un mueble sin estantes cae a su cuadrícula interna.
 */
export function sectoresDelNivel(
  estructura: EstructuraMover,
  contenedorId: string,
  recorrido: RecorridoNiveles,
): { sectores: SectorMinimapa[]; aviso: string } {
  if (recorrido.nivel === 0) {
    const ambientes = ambientesDePlanta(estructura, recorrido.planta);
    if (!ambientes.length) {
      return {
        sectores: [],
        aviso: 'Esta planta todavía no tiene ambientes definidos en el plano.',
      };
    }
    return { sectores: sectoresDeItems(ambientes, recorrido.habitacionId), aviso: '' };
  }

  if (recorrido.nivel === 1) {
    const items = contenedoresDelAmbiente(estructura, recorrido.habitacionId, contenedorId);
    if (!items.length) {
      return {
        sectores: [],
        aviso: 'Este ambiente no tiene muebles ni cajas: tocá «💾 Confirmar ubicación aquí» para dejarlo a nivel del ambiente.',
      };
    }
    return { sectores: sectoresDeItems(items, null), aviso: '' };
  }

  const cajas = cajasDelMueble(estructura, recorrido.muebleId, contenedorId);
  if (cajas.length) {
    return {
      sectores: sectoresDeItems(cajas, null),
      aviso: 'Estos son los estantes/divisiones internas del mueble: tocá el destino final o confirmá la ubicación.',
    };
  }
  // MUEBLE SIN ESTANTES CREADOS: se dibuja su CUADRÍCULA INTERNA real (filas ×
  // columnas de su grilla) para elegir la división exacta (F·C). Nunca un lienzo
  // vacío ni un plano inventado.
  const mueble = muebleActual(estructura, recorrido);
  const casilleros = mueble ? casillerosDelMueble(mueble) : [];
  if (casilleros.length) {
    return {
      sectores: casilleros,
      aviso: 'Este mueble todavía no tiene estantes: tocá el casillero de su cuadrícula interna, o confirmá para dejarlo dentro del mueble.',
    };
  }
  return {
    sectores: [],
    aviso: 'Este mueble no tiene divisiones internas: tocá «💾 Confirmar ubicación aquí» para dejarlo dentro del mueble.',
  };
}

/** Nombres de los niveles ya recorridos (miga de pan textual del encabezado). */
export function nombresRecorrido(
  estructura: EstructuraMover,
  recorrido: RecorridoNiveles,
): string[] {
  const nombres: string[] = [];
  if (recorrido.habitacionId) {
    const habitacion = estructura.ubicaciones.find(
      (u) => String(u.id) === String(recorrido.habitacionId),
    );
    if (habitacion) nombres.push(habitacion.nombre);
  }
  const mueble = muebleActual(estructura, recorrido);
  if (mueble) nombres.push(mueble.nombre);
  return nombres;
}
