// =============================================================================
// NIVELES DEL ESTOK DESTINO (plano vigente + cabezal de contexto en cascada)
// -----------------------------------------------------------------------------
// Dos piezas de la JERARQUÍA de la columna derecha de Mudanza:
//
//   1. EL PLANO VIGENTE (cuerpo central del componente global):
//      · Nivel 0 «Estok entero» → silueta canónica de la casa del motor único
//        (lib/minimapa.ts → minimapaCasitaSvg) SIN planta resaltada: el Estok
//        leído como UNA sola unidad. Es el ÚNICO nivel donde la casa grande vive
//        en el cuerpo central. Al tocarla (o al tocar un chip de planta) se abre
//        el piso elegido.
//      · Nivel 1 «Piso elegido»  → la casa macro DEJA el cuerpo central y sube
//        al cabezal como migaja reducida; el cuerpo queda LIBERADO para el plano
//        REAL de la planta (siluetas asimétricas proporcionales de sus
//        habitaciones, con sus trazos negros) y esas siluetas son las zonas de
//        suelta legítimas. El chrome del nivel agrega el selector de planta en
//        chips de TEXTO (sin casitas: la casa nunca se repite).
//      · Nivel 2 «Ambiente»      → plano real del interior (muebles y estantes).
//        Lo dibuja mudanzaMapaDestinoRender.ts.
//
//   2. EL CABEZAL DE CONTEXTO EN CASCADA (minimapas que se achican al avanzar):
//      cada nivel ya visitado se re-emite como un `NodoRuta` con su silueta REAL
//      y lo dibuja renderMinimapasAnidados: el MISMO motor puro del componente
//      global `components/MinimapaRuta.astro`. Es la miga de pan contextual:
//      · la casa entera (raíz del recorrido), y
//      · la MISMA silueta macro de la casa con el piso vigente en naranja, que
//        es la que baja del cuerpo central al elegir el piso.
//      Hereda el estándar visual único: contornos NEGROS nítidos y espacios
//      fusionados («Pasillo Escalera») como UN solo trazo, sin línea divisoria.
//
// 100% puro (sin estado, sin fetch, sin DOM): la pila de navegación vive en
// mudanzaMapaDestino.ts y el volcado en caliente en mudanzaBoard.ts.
// =============================================================================

import { minimapaCasitaSvg } from './minimapa';
import { renderMinimapasAnidados } from './minimapasAnidados';
import type { NodoRuta } from './minimapasAnidados';
import { escapeHtml } from './mapaJerarquico';
import {
  PISO_DEFECTO,
  etiquetaPlanta,
  htmlNivelHabitaciones,
  htmlPlantaSelector,
  plantasDe,
} from './mudanzaMapaDestinoRender';
import type { NivelMapaDestino } from './mudanzaMapaDestinoRender';
import type { ContenedorDto, UbicacionDto } from './mudanzaApi';
import type { FiltroDestino } from './mudanzaFiltros';

// =============================================================================
// ESTADO DEL CAMINO (tipos compartidos con mudanzaMapaDestino.ts)
// =============================================================================

/** Los tres niveles del Estok Destino: de la casa al mueble. */
export type NivelDestino = 'ESTOK' | 'PLANTAS' | 'MUEBLES';

/** Un paso visitado de la jerarquía (una entrada de la pila de navegación). */
export interface PasoDestino {
  /** Nivel dibujado en grande cuando el paso está al tope de la pila. */
  nivel: NivelDestino;
  /** Planta vigente al entrar al paso (campo `piso` de la ubicación). */
  planta: string;
  /** Habitación abierta (sólo en el nivel MUEBLES). */
  habitacionId: string | null;
}

/** Paso raíz: el Estok entero, sin planta elegida todavía. */
export function pasoInicialDestino(): PasoDestino {
  return { nivel: 'ESTOK', planta: PISO_DEFECTO, habitacionId: null };
}

/**
 * Aviso del único nivel de CONTEXTO (Nivel 0 «Estok entero»): el macro de la casa
 * todavía no dibuja zonas de suelta (aparecen al abrir el piso, en el plano real
 * de sus habitaciones, y en el interior del ambiente), así que el usuario sabe que
 * debe seguir bajando de nivel o usar la receptora estática «En Tránsito».
 */
function avisoSinZonas(): string {
  return `<p class="mudanza-mapa-aviso">Este nivel todavía no tiene zonas de suelta: abrí la planta y después el ambiente, o soltá el elemento en «En Tránsito».</p>`;
}

// =============================================================================
// NIVEL 0 · ESTOK ENTERO (la casa completa se abre al tocarla)
// =============================================================================

export function htmlNivelEstok(nombreEstok: string, ubicaciones: UbicacionDto[]): NivelMapaDestino {
  const plantas = plantasDe(ubicaciones);
  const total = Math.max(1, plantas.length);
  // Estok de una sola planta: no hay nada que elegir, el mismo toque entra al
  // plano real de sus habitaciones (Nivel 1) y evita un paso intermedio vacío.
  const unica = total === 1 ? plantas[0] : null;
  const accion = unica ? `data-navegar-planta="${escapeHtml(unica)}"` : 'data-navegar-estok="1"';
  const destino = unica ? 'Ver las habitaciones' : 'Elegir la planta';
  const casa = minimapaCasitaSvg({ filas: total, filaActiva: 0 });
  return {
    casita: true,
    // La silueta canónica del motor es el botón: se toca la casa y el mapa se
    // abre en el nivel siguiente (la casa se encoge al cabezal de contexto).
    plano: `<button type="button" class="mudanza-casita-boton" ${accion} title="${escapeHtml(
      destino,
    )} de «${escapeHtml(nombreEstok)}»">${casa}</button>`,
    detalle: `<p class="mudanza-mapa-titulo">🏠 Estok entero · <b>Nivel 0</b> — «${escapeHtml(
      nombreEstok,
    )}» (${total} ${total === 1 ? 'planta' : 'plantas'}) · <b>tocá la casa</b> para abrir su plano</p>
      <div class="mudanza-mapa-chips">
        <span class="mudanza-mapa-chips-titulo">Destino</span>
        <button type="button" class="mudanza-mapa-chip" ${accion} title="${escapeHtml(
          destino,
        )} del Estok destino">
          <span aria-hidden="true">🏢</span>
          <span class="mudanza-mapa-chip-texto">${escapeHtml(destino)}</span>
          <span class="mudanza-mapa-chip-conteo">›</span>
        </button>
      </div>
      ${avisoSinZonas()}`,
  };
}

// =============================================================================
// NIVEL 1 · PISO ELEGIDO (plano REAL de la planta: la casa sube al cabezal)
// =============================================================================

/**
 * El cuerpo central deja de dibujar la casa: la silueta macro se re-emite en el
 * cabezal de contexto (nodosCascadaDestino → migaja con el piso en naranja) y
 * acá queda SÓLO el plano real asimétrico proporcional de las habitaciones de ese
 * piso, con sus trazos negros y sus sectores como zonas de suelta legítimas.
 */
export function htmlNivelPlantas(
  ubicaciones: UbicacionDto[],
  contenedores: ContenedorDto[],
  plantaActiva: string,
  filtros: Set<FiltroDestino>,
): NivelMapaDestino {
  const plantas = plantasDe(ubicaciones);
  const indice = Math.max(0, plantas.indexOf(plantaActiva));
  const etiqueta = etiquetaPlanta(plantaActiva, indice);
  return htmlNivelHabitaciones(ubicaciones, contenedores, plantaActiva, filtros, {
    titulo: `🏠 «${escapeHtml(
      etiqueta,
    )}» · <b>Nivel 1</b> · tocá otra planta o <b>soltá sobre la silueta</b> de una habitación`,
    chipsExtra: htmlPlantaSelector(ubicaciones, plantaActiva),
  });
}

// =============================================================================
// CABEZAL DE CONTEXTO · MINIMAPAS COMPACTADOS DE LAS MIGAS DEL RECORRIDO
// =============================================================================

/**
 * Migas del cabezal, UNA por paso visitado y en el MISMO orden de profundidad de
 * la pila: el índice del DOM coincide con el índice de la pila, así el toque
 * salta exactamente al nivel elegido.
 *
 * REGLA DE LA CASA ÚNICA: la silueta macro de la casa no se repite en el cuerpo
 * central. Por eso, cuando el piso ya está elegido (paso vigente = PLANTAS), el
 * paso VIGENTE también se emite: es la casa del Nivel 0 reducida al tamaño de la
 * miniatura, con el piso activo en naranja, como miga de pan contextual.
 */
export function nodosCascadaDestino(
  pila: PasoDestino[],
  nombreEstok: string,
  ubicaciones: UbicacionDto[],
): NodoRuta[] {
  const plantas = plantasDe(ubicaciones);
  const total = Math.max(1, plantas.length);
  const vigente = pila[pila.length - 1];
  const pasos = vigente?.nivel === 'PLANTAS' ? pila : pila.slice(0, -1);
  return pasos.map((paso): NodoRuta => {
    const indice = Math.max(0, plantas.indexOf(paso.planta));
    // Casa entera (raíz del recorrido): silueta sin planta resaltada.
    if (paso.nivel === 'ESTOK') {
      return {
        tipo: 'estok',
        nombre: nombreEstok || 'Estok entero',
        filaActiva: 0,
        totalPlantas: total,
      };
    }
    // Piso elegido: la MISMA silueta macro de la casa, achicada, con la planta
    // vigente en naranja (es la que acaba de salir del cuerpo central).
    return {
      tipo: 'planta',
      nombre: etiquetaPlanta(paso.planta, indice),
      filaActiva: indice + 1,
      totalPlantas: total,
    };
  });
}

/**
 * Barra del cabezal: los minimapas compactados de los niveles previos.
 * `todosActivos` conserva el resalte naranja de cada uno: son guías de contexto
 * ACTIVAS (también navegables), no migajas apagadas.
 */
export function htmlCascadaDestino(nodos: NodoRuta[]): string {
  if (!nodos.length) return '';
  return renderMinimapasAnidados(nodos, { todosActivos: true });
}


