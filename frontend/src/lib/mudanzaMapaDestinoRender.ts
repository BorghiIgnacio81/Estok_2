// =============================================================================
// RENDER DEL MAPA DE MINIMAPAS DEL ESTOK DESTINO (Mudanza Inter-Estok)
// -----------------------------------------------------------------------------
// Capa PURA de dibujo: convierte los espacios del Estok destino (geometría REAL
// persistida en PostgreSQL: ui_left/ui_top/ui_width/ui_height) en un plano de
// SILUETAS PROPORCIONALES donde cada ambiente es una zona de suelta.
//
//   Nivel 1 (planta)   → siluetas de habitaciones (suelta GRUESA).
//   Nivel 2 (interior) → siluetas de muebles y estantes (suelta FINA) + chip de
//                        la habitación completa + chips de cajas internas.
//
// Delega en el motor global de minimapas (lib/minimapa.ts → minimapaCasitaSvg)
// y en sectoresDeItems (lib/sectoresMinimapa.ts): mismo criterio de escala y
// mismo resalte naranja que Almacenamiento, Objetos y «Nuevo Objeto».
// Los data-attributes de suelta son los canónicos del motor de arrastre
// (lib/mudanzaDnd.ts). Acá NO hay estado, ni fetch, ni eventos: sólo HTML.
// =============================================================================

import { ASPECTO_LIENZO, minimapaCasitaSvg } from './minimapa';
import type { SectorMinimapa } from './minimapa';
import { sectoresDeItems } from './sectoresMinimapa';
import { iconoDeHabitacion } from './planoHabitaciones';
import { escapeHtml } from './mapaEstokWizard';
import { habitacionesDe, htmlVacio } from './mudanzaInventario';
import type { ContenedorDto, UbicacionDto } from './mudanzaApi';
import type { FiltroDestino } from './mudanzaFiltros';

// =============================================================================
// CONSTANTES
// =============================================================================

/** Piso canónico del inmueble cuando la ubicación no trae uno persistido. */
export const PISO_DEFECTO = 'PRIMER_PISO';
/** Piso "planta baja" (segundo valor del modelo, ver mapaJerarquico.ts). */
export const PISO_BAJA = 'PLANTA_BAJA';
/** Lado mínimo (%) de un sector para que siga siendo táctil en móvil. */
const LADO_MINIMO = 7;
/** Relación ancho/alto del lienzo (CSS aspect-ratio) = inversa del aspecto real. */
const ASPECTO = 1 / ASPECTO_LIENZO;

/** Iconografía por tipo de contenedor (misma convención que el resto de la app). */
const ICONO_TIPO: Record<string, string> = {
  MUEBLE: '🗄️',
  ESTANTE: '🗃️',
  CAJA: '📦',
};

// =============================================================================
// DERIVACIONES ESPACIALES (planta → habitación → mueble/estante)
// =============================================================================

export function pisoDe(u: UbicacionDto): string {
  return String(u.piso || PISO_DEFECTO);
}

/** Un mueble (fijo o móvil) se dibuja como silueta fina del grupo «Muebles». */
export function esMueble(c: ContenedorDto): boolean {
  return c.tipo === 'MUEBLE' || Boolean(c.es_inmueble);
}

export function iconoDeContenedor(c: ContenedorDto): string {
  const tipo = String(c.tipo || '').toUpperCase();
  return ICONO_TIPO[tipo] || (esMueble(c) ? '🗄️' : '🗃️');
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
// GEOMETRÍA DEL LIENZO (ESCALA SIMÉTRICA REAL)
// -----------------------------------------------------------------------------
// Cada silueta se posiciona con los porcentajes REALES persistidos en
// PostgreSQL. Sólo se aplica un LADO_MINIMO para que ningún ambiente quede
// intocable en un teléfono, sin deformar la escala ni permitir que un sector se
// salga del perímetro del lienzo.
// =============================================================================

interface Caja {
  left: number;
  top: number;
  width: number;
  height: number;
}

function acotar(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Caja visible de un sector: proporción real + mínimo táctil + borde acotado. */
function cajaDe(s: SectorMinimapa): Caja {
  const width = acotar(Number(s.width) || LADO_MINIMO, LADO_MINIMO, 100);
  const height = acotar(Number(s.height) || LADO_MINIMO, LADO_MINIMO, 100);
  return {
    left: acotar(Number(s.left) || 0, 0, 100 - width),
    top: acotar(Number(s.top) || 0, 0, 100 - height),
    width,
    height,
  };
}

function estiloCaja(c: Caja): string {
  const dims = `width:${c.width.toFixed(2)}%;height:${c.height.toFixed(2)}%`;
  return `left:${c.left.toFixed(2)}%;top:${c.top.toFixed(2)}%;${dims}`;
}

/**
 * Atributos de la zona de suelta que reconoce el motor de arrastre
 * (mudanzaDnd.ts). Cadena vacía = silueta sólo informativa.
 */
function atributosDrop(
  tipo: 'ubicacion' | 'contenedor' | null,
  id: string,
  nombre: string,
): string {
  if (!tipo) return '';
  return `data-drop-${tipo}="${escapeHtml(id)}" data-drop-nombre="${escapeHtml(nombre)}"`;
}

interface DatosSector {
  caja: Caja;
  icono: string;
  nombre: string;
  meta: string;
  /** Atributos data-drop-* ('' = no es zona de suelta). */
  drop: string;
  /** Clase de color: habitación (verde), mueble (celeste), espacio (violeta). */
  tono: string;
  ayuda: string;
}

/** Silueta de un espacio del plano (arrastrable si trae `drop`). */
function htmlSector(d: DatosSector): string {
  const clases = [
    'mudanza-sector',
    d.tono,
    d.drop ? 'mudanza-drop-zone' : 'mudanza-sector-bloqueado',
  ];
  const atributos = d.drop ? ` ${d.drop}` : '';
  const pista = d.drop ? '<span class="mudanza-drop-hint">soltar acá</span>' : '';
  return `
    <div class="${clases.join(' ')}" style="${estiloCaja(d.caja)}" title="${escapeHtml(
      d.ayuda,
    )}"${atributos}>
      <span class="mudanza-sector-ico" aria-hidden="true">${d.icono}</span>
      <span class="mudanza-sector-nombre">${escapeHtml(d.nombre)}</span>
      <span class="mudanza-sector-meta">${escapeHtml(d.meta)}</span>
      ${pista}
    </div>`;
}

/** Lienzo rectangular con la proporción elástica real del plano. */
function htmlLienzo(sectores: string[]): string {
  const estilo = `aspect-ratio:${ASPECTO.toFixed(3)}`;
  return `<div class="mudanza-mapa-lienzo" style="${estilo}">${sectores.join('')}</div>`;
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
function chipNavegacion(atributo: string, icono: string, texto: string, conteo: string): string {
  const contador = conteo
    ? `<span class="mudanza-mapa-chip-conteo">${escapeHtml(conteo)}</span>`
    : '';
  return `<button type="button" class="mudanza-mapa-chip" ${atributo}>
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

/** Selector de planta (siluetas de la casita). Sólo aparece en Modo Casa. */
export function htmlPlantaSelector(ubicaciones: UbicacionDto[], plantaActiva: string): string {
  const plantas = plantasDe(ubicaciones);
  if (plantas.length < 2) return '';
  const chips = plantas.map((piso, i) => {
    const activa = piso === plantaActiva;
    const clases = `mudanza-mapa-chip mudanza-mapa-chip-planta${
      activa ? ' mudanza-mapa-chip-activo' : ''
    }`;
    const etiqueta = etiquetaPlanta(piso, i);
    const casita = minimapaCasitaSvg({ filas: plantas.length, filaActiva: i + 1 });
    return `<button type="button" class="${clases}" data-navegar-planta="${escapeHtml(
      piso,
    )}" title="Ver el plano de ${escapeHtml(etiqueta)}">
        <span class="mudanza-mapa-chip-casita">${casita}</span>
        <span class="mudanza-mapa-chip-texto">${escapeHtml(etiqueta)}</span>
      </button>`;
  });
  return htmlChips('Planta:', chips);
}

export function htmlNivelHabitaciones(
  ubicaciones: UbicacionDto[],
  contenedores: ContenedorDto[],
  planta: string,
  filtros: Set<FiltroDestino>,
): string {
  const habitaciones = habitacionesDePlanta(ubicaciones, planta);
  if (!habitaciones.length) {
    return htmlVacio(
      'Esta planta todavía no tiene habitaciones',
      'Modelá el plano del Estok destino desde «Mapa de Estok» en Almacenamiento.',
    );
  }

  const droppable = filtros.has('HABITACION');
  const sectores = sectoresDeItems(habitaciones, null, (h) =>
    iconoDeHabitacion(String(h.nombre || '')),
  );

  const bloques = sectores.map((sector, i) => {
    const habitacion = habitaciones[i];
    const id = String(habitacion.id);
    const nombre = habitacion.nombre || 'Habitación';
    const muebles = mueblesDe(contenedores, id).length;
    const objetos = Number(habitacion.objetos_count) || 0;
    return htmlSector({
      caja: cajaDe(sector),
      icono: sector.icono || '🚪',
      nombre,
      meta: `${muebles} 🗄️ · ${objetos} 📦`,
      drop: droppable ? atributosDrop('ubicacion', id, nombre) : '',
      tono: 'mudanza-sector-hab',
      ayuda: droppable
        ? `Soltá (o tocá) acá para mudar el elemento a «${nombre}»`
        : `«${nombre}»: activá el filtro «Habitaciones» para soltar en el ambiente completo`,
    });
  });

  const chips = habitaciones.map((h) => {
    const id = String(h.id);
    return chipNavegacion(
      `data-navegar-ubicacion="${escapeHtml(id)}"`,
      iconoDeHabitacion(h.nombre),
      h.nombre || 'Habitación',
      `${mueblesDe(contenedores, id).length} muebles`,
    );
  });

  return `
    <div class="mudanza-mapa">
      <p class="mudanza-mapa-titulo">🏢 Plano real de la planta · <b>soltá sobre la silueta</b> de la habitación</p>
      ${htmlLienzo(bloques)}
      ${htmlChips('Abrir un ambiente:', chips)}
    </div>`;
}

// =============================================================================
// NIVEL 2 · INTERIOR DE LA HABITACIÓN (muebles y estantes = suelta FINA)
// =============================================================================

export function htmlNivelMuebles(
  habitacion: UbicacionDto,
  contenedores: ContenedorDto[],
  filtros: Set<FiltroDestino>,
): string {
  const habitacionId = String(habitacion.id);
  const nombreHab = habitacion.nombre || 'Habitación';

  // Siluetas del plano interior: muebles (filtro «Muebles») y espacios o
  // estanterías sueltas (filtro «Espacios / Estantes»).
  const raices = mueblesDe(contenedores, habitacionId).filter((c) =>
    esMueble(c) ? filtros.has('MUEBLE') : filtros.has('ESPACIO'),
  );
  const sectores = sectoresDeItems(raices, null, (c) => iconoDeContenedor(c as ContenedorDto));

  const bloques = sectores.map((sector, i) => {
    const contenedor = raices[i];
    const id = String(contenedor.id);
    const nombre = contenedor.nombre || 'Mueble';
    const mueble = esMueble(contenedor);
    const objetos = Number(contenedor.objetos_count) || 0;
    const espacios = Number(contenedor.subcontenedores_count) || 0;
    return htmlSector({
      caja: cajaDe(sector),
      icono: iconoDeContenedor(contenedor),
      nombre,
      meta: espacios > 0 ? `${objetos} 📦 · ${espacios} 🗃️` : `${objetos} 📦`,
      drop: atributosDrop('contenedor', id, nombre),
      tono: mueble ? 'mudanza-sector-mueble' : 'mudanza-sector-espacio',
      ayuda: `Soltá (o tocá) acá para guardar DENTRO de «${nombre}»`,
    });
  });

  // Suelta GRUESA dentro del nivel fino: la habitación completa, siempre visible.
  const sueltaGruesa = filtros.has('HABITACION')
    ? `<div class="mudanza-suelta-gruesa mudanza-drop-zone" data-drop-ubicacion="${escapeHtml(
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

  const plano = bloques.length
    ? htmlLienzo(bloques)
    : htmlVacio(
        'Sin muebles ni estantes visibles con estos filtros',
        'Activá «Muebles» o «Espacios / Estantes» en la barra de filtros, o soltá en la habitación completa.',
      );

  return `
    <div class="mudanza-mapa">
      <div class="mudanza-mapa-cabecera">
        <p class="mudanza-mapa-titulo">🗄️ «${escapeHtml(
          nombreHab,
        )}» · <b>soltá sobre la silueta</b> del mueble</p>
        <button type="button" class="mudanza-mapa-volver" data-navegar-volver title="Volver al plano de la planta">← Volver</button>
      </div>
      ${sueltaGruesa}
      ${plano}
      ${htmlChips('Guardar dentro de:', anidados.map(chipContenedor))}
    </div>`;
}

