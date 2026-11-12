// =============================================================================
// VISOR DE HABITACIÓN - helpers de render PUROS
// -----------------------------------------------------------------------------
// Funciones sin estado para el Visor (columna derecha): contenido de celdas
// con iconografía contextual de tercer nivel (Ropero 🗄️ / Cama 🛏️ / archivador),
// botón de edición ✏️, cuerpo de la habitación con las CUATRO paredes Drop Zone
// y la paleta de la puerta arrastrable 🚪.
// Consumido únicamente por src/lib/visorHabitacion.ts.
// =============================================================================

import { escapeHtml, filasInternasDe, columnasDeFilaInterna } from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';
import { minimapaRectangularSvg } from './minimapa';
// ICONOGRAFÍA FÍSICA ÚNICA: el icono de un contenedor mueble se resuelve con la
// MISMA fuente que el lienzo de edición de Almacenamiento (subtipo por nombre +
// taxonomía). Si no hay subtipo reconocido se devuelve '' y el visor cae a la
// imagen local (/contenedor-grande.webp o /nuevo-contenedor.webp).
import { iconoDeMuebleReconocido } from './iconosFisicos';
import type { PiezaTaxonomica } from './taxonomiaContenedor';

// Iconografía local estricta del Lienzo de Mapeo Espacial.
// Rutas canónicas (WebP optimizados) en UN solo módulo: lib/assetsUi.ts.
import { ASSET_MUEBLE } from './assetsUi';

const IMG_OBJETO = ASSET_MUEBLE;

export { IMG_OBJETO };

/** Etiquetas legibles de las cuatro paredes (posicion_puerta). */
export const ETIQUETAS_PARED: Record<string, string> = {
  TOP: 'superior',
  BOTTOM: 'inferior',
  LEFT: 'izquierda',
  RIGHT: 'derecha',
};

/**
 * Icono contextual de un contenedor del Visor (subtipo por nombre + taxonomía).
 * Devuelve '' cuando el subtipo no está definido: el visor cae entonces a la
 * imagen local (contenedor grande/pequeño), conservando el look de siempre.
 */
export function iconoContenedorVisor(
  nombre: string,
  pieza?: PiezaTaxonomica | null,
): string {
  return iconoDeMuebleReconocido(nombre, pieza);
}

/** Cuerpo de la habitación: grilla rodeada por las CUATRO paredes Drop Zone. */
export function cuerpoConParedesHtml(filasHtml: string, puerta: string | null): string {
  // Marcador de ENTRADA: solo la pared que aloja la puerta lo muestra. Ícono +
  // etiqueta «Entrada» sobre un hueco ámbar de alto contraste (ver mapa-espacial.css).
  const lateral = (lado: 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT'): string =>
    puerta === lado
      ? '<span class="visor-puerta-indicador">🚪<span class="visor-puerta-label">Entrada</span></span>'
      : '';
  const titulo = (lado: string): string =>
    puerta === lado
      ? `Puerta en la pared ${ETIQUETAS_PARED[lado] ?? lado} (clic para cambiarla de pared)`
      : `Soltá la puerta en la pared ${ETIQUETAS_PARED[lado] ?? lado}`;
  return `
    <div class="visor-habitacion-cuerpo">
      <div class="visor-pared visor-pared-top${puerta === 'TOP' ? ' visor-pared-con-puerta' : ''}" data-visor-pared="TOP" title="${titulo('TOP')}">
        ${lateral('TOP')}
      </div>
      <div class="visor-pared-medio">
        <div class="visor-pared visor-pared-left${puerta === 'LEFT' ? ' visor-pared-con-puerta' : ''}" data-visor-pared="LEFT" title="${titulo('LEFT')}">
          ${lateral('LEFT')}
        </div>
        <div class="visor-grid">${filasHtml}</div>
        <div class="visor-pared visor-pared-right${puerta === 'RIGHT' ? ' visor-pared-con-puerta' : ''}" data-visor-pared="RIGHT" title="${titulo('RIGHT')}">
          ${lateral('RIGHT')}
        </div>
      </div>
      <div class="visor-pared visor-pared-bottom${puerta === 'BOTTOM' ? ' visor-pared-con-puerta' : ''}" data-visor-pared="BOTTOM" title="${titulo('BOTTOM')}">
        ${lateral('BOTTOM')}
      </div>
    </div>`;
}

/** Paleta inferior con el componente "🚪 Puerta" arrastrable. */
export function paletaPuertaHtml(): string {
  return `
    <div class="visor-puerta-paleta">
      <span class="visor-puerta-paleta-titulo">Puerta de entrada</span>
      <div class="visor-puerta-drag" draggable="true" data-puerta-drag title="Arrastrá la puerta hacia una de las cuatro paredes para marcar la entrada del ambiente">🚪 Arrastrá la puerta a una pared</div>
    </div>`;
}

/** Formatea las medidas "Alto × Ancho × Largo (cm)" de una habitación. */
export function medidasDe(room: {
  alto?: string | number | null;
  ancho?: string | number | null;
  largo?: string | number | null;
}): string | null {
  const valores = [room.alto, room.ancho, room.largo].filter(
    (v) => v !== null && v !== undefined && v !== '',
  ) as Array<string | number>;
  if (!valores.length) return null;
  return `${valores.map((v) => String(Number(v))).join(' × ')} cm`;
}

/** Grilla asimétrica (filas × columnas por fila) de una Ubicación, en vivo. */
function columnasPorFilaDe(room: UbicacionPlano): number[] {
  const filas = filasInternasDe(room);
  return Array.from({ length: filas }, (_, i) => columnasDeFilaInterna(room, i + 1));
}

/** Minimapa rectangular de la habitación seleccionada (Nivel 2).
 *  REGLA GRÁFICA ESTRICTA: RECTÁNGULO PURO sin techo. Replica en vivo la grilla
 *  exacta de la habitación (filas × columnas por fila, asimétrica) e ilumina en
 *  NARANJA (#f97316) el casillero que el usuario está inspeccionando. El techo
 *  puntiagudo queda EXCLUSIVO de la casa de Nivel 1 (mapaCasitaNavegable). */
export function minimapaHabitacionHtml(
  room: UbicacionPlano | null,
  filaActiva: number | null | undefined,
  columnaActiva: number | null | undefined,
): string {
  if (!room) return '';
  const filas = filasInternasDe(room);
  const inspeccionando = filaActiva != null && columnaActiva != null;
  return `<div class="visor-minimapa-planta" title="Grilla de «${escapeHtml(room.nombre)}»: ${filas} filas · el casillero naranja es el que estás inspeccionando">
    <span class="visor-minimapa-titulo">🧭 Grilla de la habitación</span>
    ${minimapaRectangularSvg({ filas, columnasPorFila: columnasPorFilaDe(room), filaActiva: filaActiva ?? null, columnaActiva: columnaActiva ?? null })}
    <span class="visor-minimapa-detalle">${inspeccionando ? `Casillero F${filaActiva}·C${columnaActiva}` : 'Pasá el mouse sobre un casillero para guiarte'}</span>
  </div>`;
}

/**
 * TARJETA de planta del estado inicial del Visor: RETIRADA junto con el bloque
 * «Minimapas de las plantas» (#visorPlantas), que duplicaba los minimapas
 * principales de la pantalla de Almacenamiento.
 */
