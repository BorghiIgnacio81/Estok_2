// =============================================================================
// INVENTARIO MÓVIL DE LA MUDANZA INTER-ESTOK (clasificación + render puro)
// -----------------------------------------------------------------------------
// Fuente ÚNICA de qué se puede mudar de un Estok a otro:
//   - CAJAS móviles reales        → Contenedor tipo='CAJA'   y es_inmueble=false
//   - MUEBLES grandes del usuario → Contenedor tipo='MUEBLE' y es_inmueble=false
//   - OBJETOS individuales sueltos→ Objeto sin contenedor ni objeto padre
//     (incluye los HUÉRFANOS sin ubicación física, que se marcan "sin ubicación").
// Los espacios FIJOS (muebles inmuebles) y los estantes internos (tipo
// 'ESTANTE') no son elementos mudables: viajan en cascada con su mueble.
// Render puro (sin estado ni fetch): la orquestación vive en mudanzaBoard.ts.
// Este módulo también dibuja la zona estática «En Tránsito» del destino
// (htmlZonaTransito), receptora de sueltas sin ubicación física.
// =============================================================================

import { escapeHtml } from './mapaEstokWizard';
import { iconoDeHabitacion } from './planoHabitaciones';

// =============================================================================
// DTOs (respuestas de /api/ubicaciones/, /api/contenedores/ y /api/objetos/)
// =============================================================================

export interface UbicacionDto {
  id: string;
  nombre: string;
  piso?: string;
  parent_ubicacion?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  objetos_count?: number;
  contenedores_count?: number;
  sububicaciones_count?: number;
}

export interface ContenedorDto {
  id: string;
  nombre: string;
  ubicacion?: string | null;
  procedencia_nombre?: string | null;
  parent_contenedor?: string | null;
  tipo?: string;
  es_inmueble?: boolean;
  objetos_count?: number;
  subcontenedores_count?: number;
  foto?: string | null;
}

export interface ObjetoDto {
  id: string;
  nombre: string;
  estok?: string | null;
  ubicacion?: string | null;
  ubicacion_nombre?: string | null;
  contenedor?: string | null;
  contenedor_nombre?: string | null;
  objeto_padre?: string | null;
  es_contenedor?: boolean;
  categoria_nombre?: string | null;
  foto_principal?: string | null;
  deleted_at?: string | null;
}

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
// CLASIFICACIÓN
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
  // Procedencia real del ítem suelto: caja/contenedor si lo tiene, si no la
  // habitación. Sin ninguna de las dos es un HUÉRFANO (limbo del inquilinato).
  const procedencia = o.contenedor_nombre
    ? o.contenedor_nombre
    : o.ubicacion_nombre || 'sin ubicación (limbo)';
  return {
    id: o.id,
    origen: 'objeto',
    clase: 'OBJETO',
    nombre: o.nombre,
    procedencia,
    detalle: [o.categoria_nombre, o.es_contenedor ? 'con contenido' : 'suelto']
      .filter((parte) => Boolean(parte))
      .join(' · '),
    foto: o.foto_principal || null,
  };
}

/**
 * Índice agrupado de los elementos MÓVILES del Estok de origen.
 *
 * Reglas de exclusión (deliberadas):
 *   - `es_inmueble=true` → mueble fijo adherido a la habitación, no se muda.
 *   - `tipo='ESTANTE'`   → sub-división interna, viaja con su mueble.
 *   - Objetos dentro de un contenedor o de otro objeto (incluido el ESPEJO de
 *     dualidad Contenedor+Objeto) no se listan dos veces: viajan en cascada.
 *
 * Los objetos individuales sueltos (`contenedor` y `objeto_padre` nulos) se
 * listan SIEMPRE, incluidos los huérfanos sin ubicación física (limbo del
 * inquilinato): el endpoint los devuelve con `?incluir_sin_estok=true`.
 */
export function agruparMoviles(
  contenedores: ContenedorDto[],
  objetos: ObjetoDto[],
): GrupoMoviles[] {
  const moviles = contenedores.filter(
    (c) => !c.es_inmueble && (c.tipo === 'CAJA' || c.tipo === 'MUEBLE'),
  );
  const cajas = moviles.filter((c) => c.tipo === 'CAJA').map(_desdeContenedor);
  const muebles = moviles.filter((c) => c.tipo === 'MUEBLE').map(_desdeContenedor);
  const sueltos = objetos
    .filter((o) => !o.deleted_at && !o.contenedor && !o.objeto_padre)
    .map(_desdeObjeto);

  const grupos: GrupoMoviles[] = [
    { clase: 'CAJA', titulo: 'Cajas móviles (tipo CAJA)', elementos: cajas },
    { clase: 'MUEBLE', titulo: 'Muebles móviles (tipo MUEBLE)', elementos: muebles },
    { clase: 'OBJETO', titulo: 'Objetos sueltos (fuera de cajas)', elementos: sueltos },
  ];
  return grupos.filter((g) => g.elementos.length > 0);
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
 * por naturaleza (cajas / muebles / objetos sueltos) y numerados en orden.
 */
export function htmlInventarioMovil(
  contenedores: ContenedorDto[],
  objetos: ObjetoDto[],
): string {
  const grupos = agruparMoviles(contenedores, objetos);
  const total = grupos.reduce((acc, g) => acc + g.elementos.length, 0);
  if (total === 0) {
    return htmlVacio(
      'Este Estok no tiene inventario móvil para mudar',
      'Creá cajas, muebles móviles u objetos individuales desde Almacenamiento y volvé a intentarlo.',
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

function htmlHabitacion(h: UbicacionDto): string {
  const piso = h.piso === 'PRIMER_PISO' ? '1er piso' : 'PB';
  const muebles = Number(h.contenedores_count) || 0;
  const objetos = Number(h.objetos_count) || 0;
  return `
    <div class="mudanza-drop-zone rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 p-2 sm:p-3"
      data-drop-ubicacion="${h.id}" title="Soltá (o tocá) acá el elemento arrastrado">
      <div class="flex items-start gap-1.5 sm:gap-2">
        <span class="text-base leading-none sm:text-lg">${iconoDeHabitacion(h.nombre)}</span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[11px] font-semibold text-gray-800 sm:text-[13px]">${escapeHtml(h.nombre)}</p>
          <p class="truncate text-[10px] text-gray-500 sm:text-[11px]">${piso} · ${muebles} mueb · ${objetos} obj</p>
        </div>
      </div>
      <p class="mudanza-drop-hint mt-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">soltar acá</p>
    </div>`;
}

/**
 * Plano de la columna DESTINO: mapa de las HABITACIONES receptoras del Estok,
 * agrupadas por división del macro-plano. Cada tarjeta es una zona de suelta
 * (`data-drop-ubicacion`) que el tablero enlaza con dragover/drop.
 */
export function htmlPlanoDestino(ubicaciones: UbicacionDto[]): string {
  const habitaciones = habitacionesDe(ubicaciones);
  if (habitaciones.length === 0) {
    return htmlVacio(
      'El Estok destino todavía no tiene habitaciones',
      'Modelá el plano desde «Mapa de Estok» en Almacenamiento para habilitar las zonas de suelta.',
    );
  }

  const divisiones = ubicaciones.filter(esDivision);
  const porDivision = new Map<string, UbicacionDto[]>();
  const sueltas: UbicacionDto[] = [];
  for (const h of habitaciones) {
    const div = h.parent_ubicacion ? divisiones.find((d) => d.id === h.parent_ubicacion) : undefined;
    if (!div) {
      sueltas.push(h);
      continue;
    }
    const lista = porDivision.get(div.id);
    if (lista) lista.push(h);
    else porDivision.set(div.id, [h]);
  }

  const bloques: { titulo: string; icono: string; habitaciones: UbicacionDto[] }[] = [];
  for (const d of divisiones) {
    const lista = porDivision.get(d.id);
    if (lista?.length) bloques.push({ titulo: d.nombre, icono: '🗂️', habitaciones: lista });
  }
  if (sueltas.length > 0) {
    bloques.push({
      titulo: divisiones.length > 0 ? 'Sin división' : 'Plano general',
      icono: '🏠',
      habitaciones: sueltas,
    });
  }

  return bloques
    .map(
      (b) => `
      <section class="mb-3 last:mb-0 sm:mb-4">
        <div class="mb-1.5 flex items-center gap-1.5 sm:mb-2 sm:gap-2">
          <span class="text-xs sm:text-sm">${b.icono}</span>
          <h3 class="truncate text-[11px] font-semibold text-gray-700 sm:text-[13px]">${escapeHtml(b.titulo)}</h3>
          <span class="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-400 sm:px-2 sm:text-[10px]">${b.habitaciones.length}</span>
        </div>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-2.5">${b.habitaciones.map(htmlHabitacion).join('')}</div>
      </section>`,
    )
    .join('');
}

// =============================================================================
// ZONA ESTÁTICA «EN TRÁNSITO» (columna DESTINO)
// =============================================================================

/**
 * Receptora estática y destacada del limbo del Estok destino.
 *
 * Se dibuja ARRIBA del plano de habitaciones y fuera del scroll del panel:
 * siempre visible para poder soltar (o tocar) un elemento que debe viajar al
 * nuevo inquilinato SIN ubicación física asignada. El tablero la enlaza como
 * zona de suelta legítima (`data-drop-transito`) y envía `en_transito: true` al
 * backend, que deja los objetos huérfanos (`ubicacion=None`) y los
 * contenedores en la habitación limbo del destino.
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
