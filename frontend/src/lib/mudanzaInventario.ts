// =============================================================================
// INVENTARIO MÓVIL DE LA MUDANZA INTER-ESTOK (clasificación + render puro)
// -----------------------------------------------------------------------------
// Fuente ÚNICA de qué se puede mudar de un Estok a otro:
//   - CAJAS móviles reales        → Contenedor tipo='CAJA'   y es_inmueble=false
//   - MUEBLES grandes del usuario → Contenedor tipo='MUEBLE' y es_inmueble=false
//   - OBJETOS individuales sueltos→ Objeto sin contenedor ni objeto padre
// Los espacios FIJOS (muebles inmuebles) y los estantes internos (tipo
// 'ESTANTE') no son elementos mudables: viajan en cascada con su mueble.
// Render puro (sin estado ni fetch): la orquestación vive en mudanzaBoard.ts.
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
  return {
    id: o.id,
    origen: 'objeto',
    clase: 'OBJETO',
    nombre: o.nombre,
    procedencia: o.ubicacion_nombre || 'Sin ubicación',
    detalle: o.categoria_nombre || (o.es_contenedor ? 'Ítem con contenido' : 'Ítem suelto'),
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
    { clase: 'CAJA', titulo: 'Cajas móviles', elementos: cajas },
    { clase: 'MUEBLE', titulo: 'Muebles y estructuras móviles', elementos: muebles },
    { clase: 'OBJETO', titulo: 'Objetos individuales sueltos', elementos: sueltos },
  ];
  return grupos.filter((g) => g.elementos.length > 0);
}

// =============================================================================
// RENDER (Tailwind + estados de arrastre declarados en styles/mudanza.css)
// =============================================================================

export function htmlCargando(texto: string): string {
  return `
    <div class="py-10 flex flex-col items-center gap-3">
      <span class="w-6 h-6 rounded-full border-2 border-gray-200 border-t-orange-500 animate-spin"></span>
      <p class="text-xs font-medium text-gray-400">${escapeHtml(texto)}</p>
    </div>`;
}

export function htmlVacio(titulo: string, detalle: string): string {
  return `
    <div class="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center">
      <p class="text-2xl mb-1.5">🗃️</p>
      <p class="text-[13px] font-semibold text-gray-700">${escapeHtml(titulo)}</p>
      <p class="mt-1 text-[11px] leading-relaxed text-gray-400">${escapeHtml(detalle)}</p>
    </div>`;
}

function htmlElemento(el: ElementoMudable, indice: number): string {
  const foto = escapeHtml(el.foto || IMG_FALLBACK[el.clase]);
  return `
    <div class="mudanza-drag-item flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white p-2"
      draggable="true" data-drag="${el.origen}" data-drag-id="${el.id}" data-drag-nombre="${escapeHtml(el.nombre)}"
      title="Arrastrá «${escapeHtml(el.nombre)}» hacia una habitación del Estok destino">
      <span class="w-6 h-6 shrink-0 rounded-lg border border-gray-200 bg-gray-50 text-[11px] font-bold text-gray-500 flex items-center justify-center">${indice}</span>
      <img src="${foto}" alt="${el.clase}" class="w-8 h-8 shrink-0 rounded-lg border border-gray-100 object-cover" />
      <span class="min-w-0 flex-1">
        <span class="block text-[13px] font-semibold text-gray-800 truncate">${escapeHtml(el.nombre)}</span>
        <span class="block text-[11px] text-gray-400 truncate">📍 ${escapeHtml(el.procedencia)} · ${escapeHtml(el.detalle)}</span>
      </span>
      <span class="shrink-0 text-sm leading-none text-gray-300" aria-hidden="true">⠿</span>
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
        <section class="mb-4 last:mb-0">
          <div class="flex items-center gap-2 mb-2">
            <h3 class="text-[13px] font-semibold text-gray-700">${escapeHtml(g.titulo)}</h3>
            <span class="text-[10px] font-bold uppercase tracking-wide text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">${g.elementos.length}</span>
          </div>
          <div class="flex flex-col gap-2">${tarjetas}</div>
        </section>`;
    })
    .join('');
}

function htmlHabitacion(h: UbicacionDto): string {
  const piso = h.piso === 'PRIMER_PISO' ? '1er piso' : 'Planta baja';
  const muebles = Number(h.contenedores_count) || 0;
  const objetos = Number(h.objetos_count) || 0;
  return `
    <div class="mudanza-drop-zone rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 p-3"
      data-drop-ubicacion="${h.id}" title="Soltá acá el elemento arrastrado">
      <div class="flex items-start gap-2">
        <span class="text-lg leading-none">${iconoDeHabitacion(h.nombre)}</span>
        <div class="min-w-0 flex-1">
          <p class="text-[13px] font-semibold text-gray-800 truncate">${escapeHtml(h.nombre)}</p>
          <p class="text-[11px] text-gray-500 truncate">${piso} · ${muebles} mueble(s) · ${objetos} objeto(s)</p>
        </div>
      </div>
      <p class="mudanza-drop-hint mt-2 text-[10px] font-bold uppercase tracking-wide text-emerald-700">soltar acá</p>
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
      <section class="mb-4 last:mb-0">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-sm">${b.icono}</span>
          <h3 class="text-[13px] font-semibold text-gray-700 truncate">${escapeHtml(b.titulo)}</h3>
          <span class="shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">${b.habitaciones.length} ${b.habitaciones.length === 1 ? 'habitación' : 'habitaciones'}</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">${b.habitaciones.map(htmlHabitacion).join('')}</div>
      </section>`,
    )
    .join('');
}
