// =============================================================================
// RENDER DEL PLANO UNIFICADO DEL ESTOK DESTINO (Mudanza Inter-Estok)
// -----------------------------------------------------------------------------
// Capa PURA de dibujo: convierte los espacios del Estok destino (geometría REAL
// persistida en PostgreSQL: ui_left/ui_top/ui_width/ui_height) en el PLANO
// CANÓNICO del componente global components/MinimapaRuta.astro, dibujado con su
// MISMO motor puro (lib/minimapa.ts → minimapaSectoresSvg + sectoresDeItems):
// siluetas asimétricas proporcionales, fondo crema, bordes negros definidos y
// sector activo en naranja (#f97316). Se eliminó de raíz el lienzo propio con
// cajas absolutas y perímetro gris (los «minimapas gigantes descalzados»).
//
//   Nivel 1 (planta)   → siluetas de habitaciones (suelta GRUESA).
//   Nivel 2 (interior) → siluetas de muebles y estantes (suelta FINA) + chip de
//                        la habitación completa + chips de cajas internas.
//
// Cada silueta viaja como `<g data-sector-id>` (opción `clicable` del motor) y,
// cuando es zona de suelta, lleva los data-attributes canónicos del motor de
// arrastre (lib/mudanzaDnd.ts) inyectados con `atributosSector`. Acá NO hay
// estado, ni fetch, ni eventos: sólo HTML (el host lo declara mudanza.astro y el
// tablero lo rellena en caliente).
// =============================================================================

import { ASPECTO_LIENZO, minimapaSectoresSvg } from './minimapa';
import type { SectorMinimapa } from './minimapa';
import { sectoresDeItems } from './sectoresMinimapa';
import { iconoDeHabitacion } from './planoHabitaciones';
import { escapeHtml } from './mapaJerarquico';
import { habitacionesDe, htmlVacio } from './mudanzaInventario';
import type { ContenedorDto, UbicacionDto } from './mudanzaApi';
import type { FiltroDestino } from './mudanzaFiltros';
// TAXONOMÍA FÍSICA ÚNICA + iconografía: muebles (móvil/inmueble), conjuntos y
// cajas se reconocen con el MISMO criterio que el backend y el resto de la UI.
import { tipoFisico, esMueble as esMuebleFisico } from './taxonomiaContenedor';
import type { PiezaTaxonomica } from './taxonomiaContenedor';
import { iconoDeMuebleReconocido } from './iconosFisicos';

// =============================================================================
// CONSTANTES
// =============================================================================

/** Piso canónico del inmueble cuando la ubicación no trae uno persistido. */
export const PISO_DEFECTO = 'PRIMER_PISO';
/** Piso "planta baja" (segundo valor del modelo, ver mapaJerarquico.ts). */
export const PISO_BAJA = 'PLANTA_BAJA';

/** Iconografía por tipo de contenedor (misma convención que el resto de la app). */
const ICONO_TIPO: Record<string, string> = {
  MUEBLE_MOVIL: '🗄️',
  MUEBLE_INMUEBLE: '🗄️',
  MUEBLE: '🗄️',
  CONJUNTO: '🗃️',
  ESTANTE: '🗃️',
  CAJA: '📦',
  OBJETO: '🧸',
};

// =============================================================================
// DERIVACIONES ESPACIALES (planta → habitación → mueble/estante)
// =============================================================================

export function pisoDe(u: UbicacionDto): string {
  return String(u.piso || PISO_DEFECTO);
}

/** Un mueble (fijo o móvil) se dibuja como silueta fina del grupo «Muebles». */
export function esMueble(c: ContenedorDto): boolean {
  return esMuebleFisico(c);
}

/** Icono contextual del contenedor (subtipo por nombre + taxonomía de 5 tipos). */
export function iconoDeContenedor(c: ContenedorDto): string {
  return iconoDeMuebleReconocido(c.nombre, c as PiezaTaxonomica)
    || ICONO_TIPO[tipoFisico(c)] || (esMueble(c) ? '🗄️' : '🗃️');
}

/** Plantas con habitaciones reales, en orden canónico del inmueble. */
export function plantasDe(ubicaciones: UbicacionDto[]): string[] {
  const vistas = new Set<string>();
  habitacionesDe(ubicaciones).forEach((u) => vistas.add(pisoDe(u)));
  return Array.from(vistas).sort((a, b) => {
    if (a === PISO_DEFECTO) return -1;
    if (b === PISO_DEFECTO) return 1;
    return 0;
  });
}

export function etiquetaPlanta(piso: string, indice: number): string {
  if (piso === PISO_DEFECTO) return '1er piso';
  if (piso === PISO_BAJA) return 'Planta baja';
  return `Planta ${indice + 1}`;
}

/** Habitaciones (Ubicaciones de Nivel 2) de una planta. */
export function habitacionesDePlanta(
  ubicaciones: UbicacionDto[],
  planta: string,
): UbicacionDto[] {
  return habitacionesDe(ubicaciones).filter((u) => pisoDe(u) === planta);
}

/** Contenedores raíz de una habitación (muebles, estanterías y cajas sueltas). */
export function mueblesDe(
  contenedores: ContenedorDto[],
  ubicacionId: string | null,
): ContenedorDto[] {
  if (!ubicacionId) return [];
  return contenedores.filter(
    (c) => !c.parent_contenedor && String(c.ubicacion || '') === String(ubicacionId),
  );
}

/** Sub-contenedores directos de un mueble/estante (cajas internas, estantes). */
export function hijosDe(contenedores: ContenedorDto[], padreId: string): ContenedorDto[] {
  return contenedores.filter((c) => String(c.parent_contenedor || '') === String(padreId));
}

/** Cantidad de zonas disponibles por cada filtro de la columna Destino. */
export function contarDestino(
  ubicaciones: UbicacionDto[],
  contenedores: ContenedorDto[],
): Record<FiltroDestino, number> {
  const raices = contenedores.filter((c) => !c.parent_contenedor);
  const anidados = contenedores.filter((c) => Boolean(c.parent_contenedor));
  return {
    HABITACION: habitacionesDe(ubicaciones).length,
    MUEBLE: raices.filter(esMueble).length,
    ESPACIO: raices.filter((c) => !esMueble(c)).length + anidados.length,
  };
}

// =============================================================================
// PLANO UNIFICADO (EL MISMO DEL COMPONENTE GLOBAL MinimapaRuta.astro)
// -----------------------------------------------------------------------------
// Lo dibuja el motor puro compartido: sectoresDeItems (geometría REAL ui_* de
// cada espacio) + minimapaSectoresSvg (siluetas asimétricas proporcionales,
// fondo crema, BORDES NEGROS definidos y resalte naranja del sector activo).
// Así el Destino de la Mudanza se ve idéntico a Almacenamiento y a Objetos.
// =============================================================================

/**
 * SVG elástico del plano del componente global: se inyecta DENTRO del host
 * `.minimapa-ruta-plano` que declara mudanza.astro, de modo que el tamaño lo
 * gobierna su `aspect-ratio` real (nunca un ancho fijo que desborde el panel).
 *
 * `atributos` (opcional) agrega los `data-drop-*` de cada silueta: sin ellos el
 * plano es sólo informativo y ningún sector actúa como zona de suelta.
 */
function htmlPlano(
  sectores: SectorMinimapa[],
  atributos?: (sector: { id: string; nombre: string }) => string,
): string {
  return minimapaSectoresSvg({
    sectores,
    aspecto: ASPECTO_LIENZO,
    responsive: true,
    clicable: true,
    atributosSector: atributos,
    // Etiquetas de lectura del componente global: icono + nombre de cada
    // ambiente sobre su silueta (la capa es `pointer-events:none`, así que las
    // zonas de suelta `data-drop-*` siguen recibiendo el arrastre).
    etiquetas: true,
  });
}

/**
 * Atributos de la zona de suelta que reconoce el motor de arrastre
 * (mudanzaDnd.ts): se inyectan en el `<g data-sector-id>` de la silueta.
 */
function atributosDrop(tipo: 'ubicacion' | 'contenedor', id: string, nombre: string): string {
  return `data-drop-${tipo}="${escapeHtml(id)}" data-drop-nombre="${escapeHtml(nombre)}"`;
}

/** Salida de cada nivel del mapa: SVG del plano (host global) + su chrome. */
export interface NivelMapaDestino {
  /** SVG elástico del componente global ('' = nada que dibujar → host apagado). */
  plano: string;
  /** Cabecera, avisos y chips de navegación / suelta fina (HTML). */
  detalle: string;
  /**
   * El plano vigente es la SILUETA DE LA CASA (niveles 0 «Estok entero» y 1
   * «Plantas»): la pantalla le da al host del componente una caja cuadrada
   * centrada, porque la silueta de la casa es alta y no un lienzo 16:9.
   */
  casita?: boolean;
}

/** Tira de chips de navegación (abrir ambientes, cambiar de planta). */
function htmlChips(titulo: string, chips: string[]): string {
  if (!chips.length) return '';
  return `
    <div class="mudanza-mapa-chips">
      <span class="mudanza-mapa-chips-titulo">${escapeHtml(titulo)}</span>
      ${chips.join('')}
    </div>`;
}

/** Chip de navegación hacia un nivel inferior (planta o habitación). */
function chipNavegacion(
  atributo: string,
  icono: string,
  texto: string,
  conteo: string,
  extraClases = '',
): string {
  const contador = conteo
    ? `<span class="mudanza-mapa-chip-conteo">${escapeHtml(conteo)}</span>`
    : '';
  return `<button type="button" class="mudanza-mapa-chip${extraClases}" ${atributo}>
      <span aria-hidden="true">${icono}</span>
      <span class="mudanza-mapa-chip-texto">${escapeHtml(texto)}</span>
      ${contador}
    </button>`;
}

/** Chip de suelta fina dentro de un mueble (cajas / estantes internos). */
function chipContenedor(c: ContenedorDto): string {
  const id = escapeHtml(String(c.id));
  const nombre = escapeHtml(c.nombre || 'Espacio');
  const objetos = Number(c.objetos_count) || 0;
  return `<button type="button" class="mudanza-mapa-chip mudanza-drop-zone" data-drop-contenedor="${id}" data-drop-nombre="${nombre}" title="Soltá (o tocá) acá para guardar DENTRO de «${nombre}»">
      <span aria-hidden="true">${iconoDeContenedor(c)}</span>
      <span class="mudanza-mapa-chip-texto">${nombre}</span>
      <span class="mudanza-mapa-chip-conteo">${objetos} 📦</span>
      <span class="mudanza-drop-hint">soltar</span>
    </button>`;
}

// =============================================================================
// NIVEL 1 · PLANO DE LA PLANTA (habitaciones = suelta GRUESA)
// =============================================================================

/**
 * Selector de planta: chips de TEXTO PURO (una migaja por planta, la vigente
 * resaltada). REGLA ANTI-DUPLICACIÓN: acá NO se dibuja ninguna silueta de la
 * casa. La casa es SÓLO una por nivel (el macro del Nivel 0 o la miniatura del
 * cabezal de contexto); repetirla dentro de cada chip apilaba planos idénticos
 * en vertical y rompía la limpieza de la pantalla.
 */
export function htmlPlantaSelector(ubicaciones: UbicacionDto[], plantaActiva: string): string {
  const plantas = plantasDe(ubicaciones);
  if (plantas.length < 2) return '';
  const chips = plantas.map((piso, i) => {
    const activa = piso === plantaActiva;
    return chipNavegacion(
      `data-navegar-planta="${escapeHtml(piso)}"`,
      activa ? '🏠' : '🏢',
      etiquetaPlanta(piso, i),
      activa ? 'actual' : '',
      activa ? ' mudanza-mapa-chip-activo' : '',
    );
  });
  return htmlChips('Planta:', chips);
}

/** Chrome opcional del plano de la planta (título y chips propios del nivel). */
export interface OpcionesNivelPlanta {
  /** Línea de título propia del nivel (HTML ya escapado por quien la provee). */
  titulo?: string;
  /** Chips que se anteponen a los de «Abrir un ambiente» (ej: el selector de planta). */
  chipsExtra?: string;
}

export function htmlNivelHabitaciones(
  ubicaciones: UbicacionDto[],
  contenedores: ContenedorDto[],
  planta: string,
  filtros: Set<FiltroDestino>,
  opts: OpcionesNivelPlanta = {},
): NivelMapaDestino {
  const habitaciones = habitacionesDePlanta(ubicaciones, planta);
  if (!habitaciones.length) {
    return {
      plano: '',
      detalle: `${htmlVacio(
        'Esta planta todavía no tiene habitaciones',
        'Modelá el plano del Estok destino desde «Mapa de Estok» en Almacenamiento.',
      )}${opts.chipsExtra || ''}`,
    };
  }

  const droppable = filtros.has('HABITACION');
  const sectores = sectoresDeItems(habitaciones, null, (h) =>
    iconoDeHabitacion(String(h.nombre || '')),
  );
  // Plano unificado: cada silueta es, además, la zona de suelta GRUESA cuando el
  // filtro «Habitaciones» está activo. Sin el filtro el plano sigue visible como
  // contexto (silueta sólo informativa, sin data-drop-*).
  const plano = htmlPlano(
    sectores,
    droppable ? (s) => atributosDrop('ubicacion', s.id, s.nombre) : undefined,
  );

  const chips = habitaciones.map((h) => {
    const id = String(h.id);
    return chipNavegacion(
      `data-navegar-ubicacion="${escapeHtml(id)}"`,
      iconoDeHabitacion(h.nombre),
      h.nombre || 'Habitación',
      `${mueblesDe(contenedores, id).length} muebles`,
    );
  });

  const titulo =
    opts.titulo ??
    `🏢 Plano real de la planta · <b>Nivel 1</b> · <b>soltá sobre la silueta</b> de la habitación${
      droppable ? '' : ' (activá el filtro «Habitaciones» para habilitar la suelta)'
    }`;
  return {
    plano,
    detalle: `<p class="mudanza-mapa-titulo">${titulo}</p>${
      opts.chipsExtra || ''
    }${htmlChips('Abrir un ambiente:', chips)}`,
  };
}

// =============================================================================
// NIVEL 2 · INTERIOR DE LA HABITACIÓN (muebles y estantes = suelta FINA)
// =============================================================================

export function htmlNivelMuebles(
  habitacion: UbicacionDto,
  contenedores: ContenedorDto[],
  filtros: Set<FiltroDestino>,
): NivelMapaDestino {
  const habitacionId = String(habitacion.id);
  const nombreHab = habitacion.nombre || 'Habitación';

  // Siluetas del plano interior: muebles (filtro «Muebles») y espacios o
  // estanterías sueltas (filtro «Espacios / Estantes»).
  const raices = mueblesDe(contenedores, habitacionId).filter((c) =>
    esMueble(c) ? filtros.has('MUEBLE') : filtros.has('ESPACIO'),
  );
  const sectores = sectoresDeItems(raices, null, (c) => iconoDeContenedor(c as ContenedorDto));
  // Plano unificado: toda silueta del interior es zona de suelta FINA (el motor
  // de arrastre resuelve `data-drop-contenedor` desde el propio `<g>`).
  const plano = htmlPlano(
    sectores,
    raices.length ? (s) => atributosDrop('contenedor', s.id, s.nombre) : undefined,
  );

  // Suelta GRUESA dentro del nivel fino: la habitación completa, siempre visible.
  const sueltaGruesa = filtros.has('HABITACION')
    ? `<div class="mudanza-suelta-gruesa" data-drop-ubicacion="${escapeHtml(
        habitacionId,
      )}" data-drop-nombre="${escapeHtml(
        nombreHab,
      )}" title="Soltá (o tocá) acá para dejar el elemento en «${escapeHtml(nombreHab)}»">
        <span aria-hidden="true">🏠</span>
        <span class="min-w-0 flex-1 truncate">Soltar en «${escapeHtml(nombreHab)}» completa</span>
        <span class="mudanza-drop-hint">soltar acá</span>
      </div>`
    : '<p class="mudanza-mapa-aviso">El filtro «Habitaciones» está apagado: sólo podés soltar dentro de un mueble o estante.</p>';

  // Cajas / estantes internos de cada mueble (suelta fina de segundo nivel).
  const anidados = filtros.has('ESPACIO')
    ? raices.flatMap((c) => hijosDe(contenedores, String(c.id)))
    : [];

  const aviso = plano
    ? ''
    : htmlVacio(
        'Sin muebles ni estantes visibles con estos filtros',
        'Activá «Muebles» o «Espacios / Estantes» en la barra de filtros, o soltá en la habitación completa.',
      );

  return {
    plano,
    detalle: `<p class="mudanza-mapa-titulo">🗄️ «${escapeHtml(
        nombreHab,
      )}» · <b>Nivel 2</b> · <b>soltá sobre la silueta</b> del mueble o del estante</p>
      ${sueltaGruesa}
      ${aviso}
      ${htmlChips('Guardar dentro de:', anidados.map(chipContenedor))}`,
  };
}

