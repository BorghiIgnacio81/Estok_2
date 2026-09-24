// =============================================================================
// PLANO RECEPTOR DEL DESTINO (jerarquía de zonas de suelta + filtros)
// -----------------------------------------------------------------------------
// Estructura jerárquica del Estok destino, en dos escalas:
//   · SUELTA GRUESA  → la HABITACIÓN completa (`data-drop-ubicacion`).
//   · SUELTA FINA    → un MUEBLE o un ESPACIO/ESTANTE concreto
//                      (`data-drop-contenedor` → el backend recibe
//                      `contenedor_destino_id` y re-ancla el elemento ahí).
//
// Los filtros de la columna (Habitaciones · Muebles · Espacios / Estantes)
// deciden QUÉ NIVELES se dibujan, sin nuevas peticiones: reactivar un filtro
// vuelve a mostrar las zonas (los datos viven en memoria).
//
// Render puro: la orquestación (DnD, toque y estado de filtros) vive en
// mudanzaBoard.ts; la clasificación espacial compartida, en mudanzaInventario.
// =============================================================================

import { escapeHtml } from './mapaEstokWizard';
import { iconoDeHabitacion } from './planoHabitaciones';
import { esDivision, habitacionesDe, htmlVacio } from './mudanzaInventario';
import type { ContenedorDto, UbicacionDto } from './mudanzaApi';
import type { FiltroDestino } from './mudanzaFiltros';

/** Profundidad máxima dibujada (mueble → estante → caja interna → …). */
const NIVEL_MAXIMO = 4;

/** Un mueble (fijo o móvil) se ofrece como zona fina del grupo «Muebles». */
function esMueble(c: ContenedorDto): boolean {
  return c.tipo === 'MUEBLE' || Boolean(c.es_inmueble);
}

/** Contenedores raíz de una habitación (muebles, cajas y estanterías sueltas). */
function raicesDe(contenedores: ContenedorDto[], ubicacionId: string): ContenedorDto[] {
  return contenedores.filter((c) => !c.parent_contenedor && c.ubicacion === ubicacionId);
}

function hijosDe(contenedores: ContenedorDto[], padreId: string): ContenedorDto[] {
  return contenedores.filter((c) => c.parent_contenedor === padreId);
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

function htmlZonaFina(c: ContenedorDto, nivel: number): string {
  const mueble = esMueble(c);
  const objetos = Number(c.objetos_count) || 0;
  const espacios = Number(c.subcontenedores_count) || 0;
  const detalle = [
    `${objetos} ${objetos === 1 ? 'objeto' : 'objetos'}`,
    espacios > 0 ? `${espacios} ${espacios === 1 ? 'espacio' : 'espacios'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const nombre = escapeHtml(c.nombre);
  const tono = mueble
    ? 'border-sky-200 bg-sky-50/50 text-sky-900'
    : 'border-indigo-200 bg-indigo-50/50 text-indigo-900';
  return `
    <div class="mudanza-drop-zone mudanza-drop-fina rounded-lg border-2 border-dashed p-1.5 sm:p-2 ${tono}"
      data-drop-contenedor="${c.id}" data-drop-nombre="${nombre}"
      style="margin-left:${Math.min(nivel, NIVEL_MAXIMO) * 6}px"
      title="Soltá (o tocá) acá para guardar DENTRO de «${nombre}»">
      <div class="flex items-start gap-1.5">
        <span class="text-sm leading-none sm:text-base" aria-hidden="true">${mueble ? '🗄️' : '🗂️'}</span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[11px] font-semibold sm:text-xs">${nombre}</p>
          <p class="truncate text-[10px] opacity-80 sm:text-[11px]">${detalle}</p>
        </div>
      </div>
      <p class="mudanza-drop-hint mt-1 text-[9px] font-bold uppercase tracking-wide sm:text-[10px]">guardar acá</p>
    </div>`;
}

/** Dibuja recursivamente los sub-contenedores visibles (estantes, cajas internas). */
function htmlAnidados(
  contenedores: ContenedorDto[],
  padreId: string,
  nivel: number,
  filtros: Set<FiltroDestino>,
  vistos: Set<string>,
): string {
  if (nivel > NIVEL_MAXIMO || !filtros.has('ESPACIO')) return '';
  return hijosDe(contenedores, padreId)
    .filter((c) => !vistos.has(c.id))
    .map((c) => {
      vistos.add(c.id);
      return htmlZonaFina(c, nivel) + htmlAnidados(contenedores, c.id, nivel + 1, filtros, vistos);
    })
    .join('');
}

/** Zona de suelta GRUESA: la habitación completa. */
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
 * Plano receptor completo: habitaciones (agrupadas por división del macro-plano)
 * con sus muebles y espacios internos como zonas de suelta fina.
 *
 * Una habitación se dibuja si algún nivel visible la contiene (la propia zona
 * gruesa o al menos un mueble/espacio), de modo que desactivar «Habitaciones»
 * deja igualmente operativa la suelta fina.
 */
export function htmlPlanoDestino(
  ubicaciones: UbicacionDto[],
  contenedores: ContenedorDto[],
  filtros: Set<FiltroDestino>,
): string {
  const habitaciones = habitacionesDe(ubicaciones);
  if (habitaciones.length === 0) {
    return htmlVacio(
      'El Estok destino todavía no tiene habitaciones',
      'Modelá el plano desde «Mapa de Estok» en Almacenamiento para habilitar las zonas de suelta.',
    );
  }

  const verHabitacion = filtros.has('HABITACION');
  const verMuebles = filtros.has('MUEBLE');
  const verEspacios = filtros.has('ESPACIO');

  const renderHabitacion = (h: UbicacionDto): { html: string; visible: boolean } => {
    const vistos = new Set<string>();
    const finas = raicesDe(contenedores, h.id)
      .filter((c) => (esMueble(c) ? verMuebles : verEspacios))
      .map((c) => {
        vistos.add(c.id);
        return htmlZonaFina(c, 0) + htmlAnidados(contenedores, c.id, 1, filtros, vistos);
      })
      .join('');
    const visible = verHabitacion || finas.length > 0;
    if (!visible) return { html: '', visible: false };
    const bloque = `
      <article class="rounded-xl border border-gray-200 bg-white p-1.5 sm:p-2">
        ${verHabitacion ? htmlHabitacion(h) : ''}
        ${finas ? `<div class="mt-1.5 flex flex-col gap-1">${finas}</div>` : ''}
      </article>`;
    return { html: bloque, visible: true };
  };

  // Agrupación por división del macro-plano (idéntica regla que el resto del mapa).
  const divisiones = ubicaciones.filter(esDivision);
  const porDivision = new Map<string, string[]>();
  const sueltas: string[] = [];
  const visibles = new Set<string>();

  for (const h of habitaciones) {
    const { html, visible } = renderHabitacion(h);
    if (!visible) continue;
    visibles.add(h.id);
    const div = h.parent_ubicacion ? divisiones.find((d) => d.id === h.parent_ubicacion) : undefined;
    if (!div) {
      sueltas.push(html);
      continue;
    }
    const lista = porDivision.get(div.id);
    if (lista) lista.push(html);
    else porDivision.set(div.id, [html]);
  }

  if (visibles.size === 0) {
    return htmlVacio(
      'Ninguna zona visible con los filtros actuales',
      'Activá al menos un filtro de la barra superior (Habitaciones, Muebles o Espacios / Estantes).',
    );
  }

  const bloques: { titulo: string; icono: string; htmls: string[] }[] = [];
  for (const d of divisiones) {
    const lista = porDivision.get(d.id);
    if (lista?.length) bloques.push({ titulo: d.nombre, icono: '🗂️', htmls: lista });
  }
  if (sueltas.length > 0) {
    bloques.push({
      titulo: divisiones.length > 0 ? 'Sin división' : 'Plano general',
      icono: '🏠',
      htmls: sueltas,
    });
  }

  return bloques
    .map(
      (b) => `
      <section class="mb-3 last:mb-0 sm:mb-4">
        <div class="mb-1.5 flex items-center gap-1.5 sm:mb-2 sm:gap-2">
          <span class="text-xs sm:text-sm">${b.icono}</span>
          <h3 class="truncate text-[11px] font-semibold text-gray-700 sm:text-[13px]">${escapeHtml(b.titulo)}</h3>
          <span class="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-400 sm:px-2 sm:text-[10px]">${b.htmls.length}</span>
        </div>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-2.5">${b.htmls.join('')}</div>
      </section>`,
    )
    .join('');
}
