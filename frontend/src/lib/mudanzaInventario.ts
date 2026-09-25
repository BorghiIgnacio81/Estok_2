// =============================================================================
// INVENTARIO MÓVIL DEL ORIGEN (clasificación + render puro)
// -----------------------------------------------------------------------------
// Fuente ÚNICA de qué se puede mudar de un Estok a otro:
//   - CAJAS móviles reales        → Contenedor tipo='CAJA'   y es_inmueble=false
//   - MUEBLES grandes del usuario → Contenedor tipo='MUEBLE' y es_inmueble=false
//   - OBJETOS individuales sueltos→ Objeto cuyo padre FÍSICO es la habitación
//     directamente (sin caja asignada) y que no está dentro de otro objeto.
//     Incluye los HUÉRFANOS sin ubicación (limbo del inquilinato), que llegan al
//     listado gracias a `?incluir_sin_estok=true` + paginación completa.
// Los espacios FIJOS (es_inmueble) y los estantes internos (tipo='ESTANTE') no
// son elementos mudables: viajan en cascada con su mueble.
//
// FILTROS: `agruparMoviles` recibe el set de filtros activos de la columna
// (Objetos sueltos / Muebles / Cajas) y devuelve SOLO los grupos visibles, sin
// volver a pedir datos al servidor.
//
// Render puro (sin estado ni fetch): la orquestación vive en mudanzaBoard.ts y
// el borde HTTP en mudanzaApi.ts.
// =============================================================================

import { escapeHtml } from './mapaEstokWizard';
import { filtrosActivos, FILTROS_ORIGEN } from './mudanzaFiltros';
import type { FiltroOrigen } from './mudanzaFiltros';
import type { ContenedorDto, ObjetoDto, UbicacionDto } from './mudanzaApi';

// Re-export de los DTOs: el resto del módulo de mudanzas los consume desde acá.
export type { ContenedorDto, ObjetoDto, UbicacionDto } from './mudanzaApi';

export type ClaseElemento = 'CAJA' | 'MUEBLE' | 'OBJETO';

export interface ElementoMudable {
  /** UUID del Contenedor o del Objeto según `origen`. */
  id: string;
  /** FK que espera el endpoint POST /api/inventario/mudanza/. */
  origen: 'contenedor' | 'objeto';
  clase: ClaseElemento;
  nombre: string;
  procedencia: string;
  detalle: string;
  foto: string | null;
}

export interface GrupoMoviles {
  clase: ClaseElemento;
  titulo: string;
  elementos: ElementoMudable[];
}

const IMG_FALLBACK: Record<ClaseElemento, string> = {
  CAJA: '/Nuevo Contenedor.png',
  MUEBLE: '/archivador-login.png',
  OBJETO: '/fluffy_plush_ball.jpg',
};

// =============================================================================
// CLASIFICACIÓN ESPACIAL (compartida con mudanzaMapaDestinoRender.ts)
// =============================================================================

/**
 * División del macro-plano (Nivel 1 del Mapa Estok): ubicación posicionada en
 * la grilla de piso SIN división padre. Misma regla que almacenamientoBoard.
 */
export function esDivision(u: UbicacionDto): boolean {
  return Boolean(u.parent_grid_row) && !u.parent_ubicacion;
}

/** Habitaciones reales del Estok (Nivel 2): zonas de suelta receptoras. */
export function habitacionesDe(ubicaciones: UbicacionDto[]): UbicacionDto[] {
  return ubicaciones.filter((u) => !esDivision(u));
}

/**
 * OBJETO INDIVIDUAL SUELTO — los dos casos que exige el negocio:
 *   1. No tiene caja/contenedor asignado (`contenedor` nulo) → su padre físico
 *      es la habitación directamente o el limbo del inquilinato.
 *   2. No está dentro de otro objeto (`objeto_padre` nulo); si lo estuviera,
 *      viaja en cascada con su objeto raíz y duplicarlo sería un error.
 */
export function esObjetoSuelto(o: ObjetoDto): boolean {
  return !o.deleted_at && !o.contenedor && !o.objeto_padre;
}

/** Contenedor mudable de forma independiente (caja o mueble móvil). */
export function esContenedorMudable(c: ContenedorDto): boolean {
  return !c.es_inmueble && (c.tipo === 'CAJA' || c.tipo === 'MUEBLE');
}

// =============================================================================
// MAPEO A ELEMENTOS ARRASTRABLES
// =============================================================================

function _partes(...valores: string[]): string {
  return valores.filter((v) => v.trim().length > 0).join(' · ');
}

function _desdeContenedor(c: ContenedorDto): ElementoMudable {
  const clase: ClaseElemento = c.tipo === 'MUEBLE' ? 'MUEBLE' : 'CAJA';
  const objetos = Number(c.objetos_count) || 0;
  const estantes = Number(c.subcontenedores_count) || 0;
  return {
    id: c.id,
    origen: 'contenedor',
    clase,
    nombre: c.nombre,
    procedencia: c.procedencia_nombre || 'Sin ubicación',
    detalle: _partes(
      `${objetos} ${objetos === 1 ? 'objeto' : 'objetos'}`,
      estantes > 0 ? `${estantes} ${estantes === 1 ? 'estante' : 'estantes'}` : '',
    ),
    foto: c.foto || null,
  };
}

function _desdeObjeto(o: ObjetoDto): ElementoMudable {
  // Procedencia real del ítem suelto: la habitación donde está apoyado. Sin
  // habitación es un HUÉRFANO que espera en el limbo del inquilinato.
  return {
    id: o.id,
    origen: 'objeto',
    clase: 'OBJETO',
    nombre: o.nombre,
    procedencia: o.ubicacion_nombre || 'sin ubicación (limbo)',
    detalle: [o.categoria_nombre, o.es_contenedor ? 'con contenido' : 'suelto']
      .filter((parte) => Boolean(parte))
      .join(' · '),
    foto: o.foto_principal || null,
  };
}

/** Cantidad de elementos disponibles por cada filtro de la columna Origen. */
export function contarOrigen(
  contenedores: ContenedorDto[],
  objetos: ObjetoDto[],
): Record<FiltroOrigen, number> {
  const moviles = contenedores.filter(esContenedorMudable);
  return {
    CAJA: moviles.filter((c) => c.tipo === 'CAJA').length,
    MUEBLE: moviles.filter((c) => c.tipo === 'MUEBLE').length,
    OBJETO: objetos.filter(esObjetoSuelto).length,
  };
}

/**
 * Índice agrupado y FILTRADO de los elementos móviles del Estok de origen.
 *
 * Excluye deliberadamente los espacios fijos (`es_inmueble`), los estantes
 * internos (viajan en cascada) y los objetos que ya viven dentro de una caja u
 * otro objeto. Nunca "pierde" objetos sueltos: `esObjetoSuelto` es la regla
 * única y explícita, y los huérfanos sin estok llegan por la capa de datos.
 */
export function agruparMoviles(
  contenedores: ContenedorDto[],
  objetos: ObjetoDto[],
  filtros: Set<FiltroOrigen> = filtrosActivos(FILTROS_ORIGEN),
): GrupoMoviles[] {
  const moviles = contenedores.filter(esContenedorMudable);
  const grupos: GrupoMoviles[] = [
    {
      clase: 'CAJA',
      titulo: 'Cajas móviles (tipo CAJA)',
      elementos: moviles.filter((c) => c.tipo === 'CAJA').map(_desdeContenedor),
    },
    {
      clase: 'MUEBLE',
      titulo: 'Muebles móviles (tipo MUEBLE)',
      elementos: moviles.filter((c) => c.tipo === 'MUEBLE').map(_desdeContenedor),
    },
    {
      clase: 'OBJETO',
      titulo: 'Objetos sueltos (sin caja asignada)',
      elementos: objetos.filter(esObjetoSuelto).map(_desdeObjeto),
    },
  ];
  return grupos.filter((g) => filtros.has(g.clase) && g.elementos.length > 0);
}

// =============================================================================
// RENDER (Tailwind + estados de arrastre declarados en styles/mudanza.css)
// =============================================================================

export function htmlCargando(texto: string): string {
  return `
    <div class="flex flex-col items-center gap-3 py-8 sm:py-10">
      <span class="w-6 h-6 rounded-full border-2 border-gray-200 border-t-orange-500 animate-spin"></span>
      <p class="text-[11px] font-medium text-gray-400 sm:text-xs">${escapeHtml(texto)}</p>
    </div>`;
}

export function htmlVacio(titulo: string, detalle: string): string {
  return `
    <div class="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-6 text-center sm:px-4 sm:py-8">
      <p class="text-xl mb-1.5 sm:text-2xl">🗃️</p>
      <p class="text-[11px] font-semibold text-gray-700 sm:text-[13px]">${escapeHtml(titulo)}</p>
      <p class="mt-1 text-[10px] leading-relaxed text-gray-400 sm:text-[11px]">${escapeHtml(detalle)}</p>
    </div>`;
}

function htmlElemento(el: ElementoMudable, indice: number): string {
  const foto = escapeHtml(el.foto || IMG_FALLBACK[el.clase]);
  const nombre = escapeHtml(el.nombre);
  return `
    <div class="mudanza-drag-item flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-1.5 sm:gap-2.5 sm:p-2"
      draggable="true" data-drag="${el.origen}" data-drag-id="${el.id}" data-drag-nombre="${nombre}"
      title="Arrastrá «${nombre}» hacia una habitación del destino (en móvil: tocá la tarjeta y luego la habitación)">
      <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-[10px] font-bold text-gray-500 sm:h-6 sm:w-6 sm:text-[11px]">${indice}</span>
      <img src="${foto}" alt="${el.clase}" class="h-7 w-7 shrink-0 rounded-lg border border-gray-100 object-cover sm:h-8 sm:w-8" />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-[11px] font-semibold text-gray-800 sm:text-[13px]">${nombre}</span>
        <span class="block truncate text-[10px] text-gray-400 sm:text-[11px]">📍 ${escapeHtml(el.procedencia)} · ${escapeHtml(el.detalle)}</span>
      </span>
      <span class="hidden shrink-0 text-sm leading-none text-gray-300 sm:block" aria-hidden="true">⠿</span>
    </div>`;
}

/**
 * Panel completo de la columna ORIGEN: índice de elementos móviles agrupados
 * por naturaleza (objetos sueltos / muebles / cajas) y numerados en orden.
 *
 * `filtros` sólo decide QUÉ GRUPOS se dibujan: no hay nuevas peticiones ni
 * pérdida de datos (los elementos siguen en memoria y reaparecen al reactivar).
 */
export function htmlInventarioMovil(
  contenedores: ContenedorDto[],
  objetos: ObjetoDto[],
  filtros: Set<FiltroOrigen>,
): string {
  const hayInventario = Object.values(contarOrigen(contenedores, objetos)).some((n) => n > 0);
  const grupos = agruparMoviles(contenedores, objetos, filtros);

  if (!hayInventario) {
    return htmlVacio(
      'Este Estok no tiene inventario móvil para mudar',
      'Creá cajas, muebles móviles u objetos individuales desde Almacenamiento y volvé a intentarlo.',
    );
  }
  if (grupos.length === 0) {
    return htmlVacio(
      'Ningún grupo visible con los filtros actuales',
      'Activá al menos un filtro de la barra superior (Objetos sueltos, Muebles o Cajas).',
    );
  }

  let indice = 0;
  return grupos
    .map((g) => {
      const tarjetas = g.elementos
        .map((el) => {
          indice += 1;
          return htmlElemento(el, indice);
        })
        .join('');
      return `
        <section class="mb-3 last:mb-0 sm:mb-4">
          <div class="mb-1.5 flex items-center gap-1.5 sm:mb-2 sm:gap-2">
            <h3 class="truncate text-[11px] font-semibold text-gray-700 sm:text-[13px]">${escapeHtml(g.titulo)}</h3>
            <span class="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-400 sm:px-2 sm:text-[10px]">${g.elementos.length}</span>
          </div>
          <div class="flex flex-col gap-1.5 sm:gap-2">${tarjetas}</div>
        </section>`;
    })
    .join('');
}

/**
 * Receptora estática «EN TRÁNSITO» del Estok destino.
 *
 * Se dibuja ARRIBA del plano de habitaciones y fuera de su scroll: siempre
 * visible para soltar (o tocar) un elemento que debe viajar al nuevo
 * inquilinato SIN ubicación física. El tablero la enlaza como zona de suelta
 * (`data-drop-transito`) y envía `en_transito: true`: el backend deja los
 * objetos huérfanos (`ubicacion=None`) y los contenedores en la habitación limbo.
 */
export function htmlZonaTransito(): string {
  return `
    <div class="mudanza-transito rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/70 p-2 sm:p-3"
      data-drop-transito="1"
      title="Soltá (o tocá) acá para mudar el elemento al Estok destino SIN ubicación física">
      <div class="flex items-center gap-2">
        <span class="text-lg leading-none sm:text-xl" aria-hidden="true">🚚</span>
        <div class="min-w-0 flex-1">
          <p class="text-[10px] font-bold uppercase tracking-wide text-amber-800 sm:text-xs">En Tránsito</p>
          <p class="truncate text-[10px] leading-snug text-amber-700/90 sm:text-[11px]">
            Limbo del destino: viaja sin ubicación física
          </p>
        </div>
      </div>
      <p class="mudanza-drop-hint mt-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">soltar acá</p>
    </div>`;
}
