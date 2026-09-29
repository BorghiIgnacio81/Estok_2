// =============================================================================
// NIVELES SUPERIORES Y CABEZAL EN CASCADA DEL ESTOK DESTINO (render puro)
// -----------------------------------------------------------------------------
// Dos piezas de la JERARQUÍA ELÁSTICA de la columna derecha de Mudanza:
//
//   1. LOS DOS NIVELES DE ARRIBA (plano grande del componente global):
//      · Nivel 0 «Estok entero» → silueta canónica de la casa del motor único
//        (lib/minimapa.ts → minimapaCasitaSvg) SIN planta resaltada: el Estok
//        leído como UNA sola unidad, que al tocarla se abre en sus plantas.
//      · Nivel 1 «Plantas»      → la MISMA silueta con la planta vigente en
//        naranja + la tira de chips de plantas (htmlPlantaSelector), que es la
//        navegación real hacia el nivel 2. Con un Estok de una sola planta el
//        Nivel 0 entra DIRECTO al plano de sus habitaciones (sin paso muerto).
//
//   2. EL CABEZAL DE CONTEXTO EN CASCADA (minimapas que se achican al avanzar):
//      cada nivel ya visitado se re-emite como un `NodoRuta` con su geometría
//      REAL (sectoresDeItems → ui_left/ui_top/ui_width/ui_height persistidos) y
//      lo dibuja renderMinimapasAnidados: el MISMO motor puro del componente
//      global `components/MinimapaRuta.astro`. Al profundizar, el plano que se
//      abandona se ENCOGE (escala canónica 4× menor del motor) y se apila al
//      lado del anterior, como guía de contexto ACTIVA del nivel vigente.
//      Hereda el estándar visual único: siluetas asimétricas reales, contornos
//      NEGROS nítidos y espacios fusionados («Pasillo Escalera») como UN solo
//      trazo, sin ninguna línea divisoria interna.
//
// 100% puro (sin estado, sin fetch, sin DOM): la pila de navegación vive en
// mudanzaMapaDestino.ts y el volcado en caliente en mudanzaBoard.ts.
// =============================================================================

import { ASPECTO_LIENZO, minimapaCasitaSvg } from './minimapa';
import { renderMinimapasAnidados } from './minimapasAnidados';
import type { NodoRuta } from './minimapasAnidados';
import { sectoresDeItems } from './sectoresMinimapa';
import { iconoDeHabitacion } from './planoHabitaciones';
import { escapeHtml } from './mapaEstokWizard';
import {
  PISO_DEFECTO,
  etiquetaPlanta,
  habitacionesDePlanta,
  htmlPlantaSelector,
  plantasDe,
} from './mudanzaMapaDestinoRender';
import type { NivelMapaDestino } from './mudanzaMapaDestinoRender';
import type { UbicacionDto } from './mudanzaApi';

// =============================================================================
// ESTADO DEL CAMINO (tipos compartidos con mudanzaMapaDestino.ts)
// =============================================================================

/** Los cuatro niveles del Estok Destino, de la casa al mueble. */
export type NivelDestino = 'ESTOK' | 'PLANTAS' | 'HABITACIONES' | 'MUEBLES';

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
 * Aviso de los niveles de CONTEXTO (Nivel 0 y 1): el plano todavía no dibuja
 * zonas de suelta (aparecen en el plano real de la planta y en el interior de la
 * habitación), así que el usuario sabe que debe seguir bajando de nivel o usar
 * la receptora estática «En Tránsito».
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
  // plano real de sus habitaciones (Nivel 2) y evita un paso intermedio vacío.
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
// NIVEL 1 · PLANTAS (la casa con la planta vigente + chips de plantas)
// =============================================================================

export function htmlNivelPlantas(
  ubicaciones: UbicacionDto[],
  plantaActiva: string,
): NivelMapaDestino {
  const plantas = plantasDe(ubicaciones);
  const total = Math.max(1, plantas.length);
  const indice = Math.max(0, plantas.indexOf(plantaActiva));
  const selector = htmlPlantaSelector(ubicaciones, plantaActiva);
  // Defensa: con una sola planta el selector canónico no se dibuja; un chip
  // único mantiene la navegación hacia el plano real de las habitaciones.
  const unico = total === 1 ? plantas[0] : null;
  const chips = selector
    ? selector
    : `<div class="mudanza-mapa-chips">
        <span class="mudanza-mapa-chips-titulo">Planta</span>
        <button type="button" class="mudanza-mapa-chip" data-navegar-planta="${escapeHtml(
          unico || plantaActiva,
        )}" title="Ver el plano real de la planta">
          <span aria-hidden="true">🏢</span>
          <span class="mudanza-mapa-chip-texto">${escapeHtml(
            etiquetaPlanta(unico || plantaActiva, 0),
          )}</span>
          <span class="mudanza-mapa-chip-conteo">›</span>
        </button>
      </div>`;
  return {
    casita: true,
    plano: minimapaCasitaSvg({ filas: total, filaActiva: indice + 1 }),
    detalle: `<p class="mudanza-mapa-titulo">🏢 Plantas · <b>Nivel 1</b> — tocá una planta para ver su <b>plano real</b> de habitaciones</p>${chips}${avisoSinZonas()}`,
  };
}

// =============================================================================
// CABEZAL DE CONTEXTO · MINIMAPAS COMPACTADOS DE LOS NIVELES YA VISITADOS
// =============================================================================

/**
 * Un minimapa compactado por cada nivel YA VISITADO (la pila menos el nivel
 * vigente), en el MISMO orden de profundidad: al avanzar, el plano que se deja
 * atrás se achica y se acomoda al lado de los anteriores.
 */
export function nodosCascadaDestino(
  pila: PasoDestino[],
  nombreEstok: string,
  ubicaciones: UbicacionDto[],
): NodoRuta[] {
  const plantas = plantasDe(ubicaciones);
  const total = Math.max(1, plantas.length);
  return pila.slice(0, -1).map((paso) => {
    const indice = Math.max(0, plantas.indexOf(paso.planta));
    const etiqueta = etiquetaPlanta(paso.planta, indice);
    if (paso.nivel === 'ESTOK') {
      // Casa entera, sin planta resaltada: es el contexto raíz del recorrido.
      return {
        tipo: 'estok',
        nombre: nombreEstok || 'Estok entero',
        filaActiva: 0,
        totalPlantas: total,
      };
    }
    if (paso.nivel === 'PLANTAS') {
      return {
        tipo: 'planta',
        nombre: etiqueta,
        filaActiva: indice + 1,
        totalPlantas: total,
      };
    }
    // HABITACIONES: plano PROPORCIONAL REAL de la planta, con la habitación que
    // se abrió en naranja (el minimapa achicado conserva las siluetas
    // asimétricas verdaderas y las fusiones sin líneas divisorias internas).
    const hermanas = habitacionesDePlanta(ubicaciones, paso.planta);
    return {
      tipo: 'habitacion',
      nombre: etiqueta,
      id: paso.habitacionId,
      sectores: sectoresDeItems(hermanas, paso.habitacionId, (h) =>
        iconoDeHabitacion(String(h.nombre || '')),
      ),
      aspecto: ASPECTO_LIENZO,
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


