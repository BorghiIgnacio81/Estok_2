// =============================================================================
// RENDER DEL LIENZO «MAPA ESTOK» (Nivel 1 = casa · Nivel 2 = editor elástico)
// -----------------------------------------------------------------------------
// Funciones PURAS de vista: reciben los datos por parámetro y devuelven HTML.
// No tocan el DOM ni hacen fetch. El enlace de eventos vive en el orquestador.
//
//   Nivel 1 → silueta perimetral de la casa (techo puntiagudo) con la PLANTA
//             SELECCIONADA resaltada en naranja (.casita-piso-activo).
//   Nivel 2 → Editor Elástico de Habitaciones: minimapa de la casita (planta
//             activa en naranja) + lienzo elástico con botón «➕ Habitación»,
//             comandos y el disyuntor canónico «Espacio Único» en la cabecera.
// =============================================================================

import { escapeHtml } from '../mapaJerarquico';
import type { UbicacionPlano } from '../mapaJerarquico';
import type { ItemElastico } from '../lienzoElastico';
import { minimapaCasitaSvg } from '../minimapa';
import { renderLienzoElastico } from '../mapaPlantaUnica';
import { iconoDeHabitacion } from '../planoHabitaciones';
import { checkboxEspacioUnicoHtml } from '../espacioUnico';
import { habitacionesDePlanta, nombreDePlanta } from './dominioCasita';

/** Nivel 1: la casa con techo puntiagudo y sus plantas como botones (planta activa en naranja). */
export function renderCasaHtml(params: {
  total: number;
  divisiones: UbicacionPlano[];
  habitaciones: UbicacionPlano[];
  filaActiva: number | null;
}): string {
  const { total, divisiones, habitaciones, filaActiva } = params;
  const pisos: string[] = [];
  for (let f = 1; f <= total; f++) {
    const div = divisiones.find((d) => d.parent_grid_row === f);
    const nombre = nombreDePlanta(divisiones, f);
    const habs = habitacionesDePlanta(divisiones, habitaciones, f);
    const meta = div
      ? `${habs.length} hab${habs.length === 1 ? '' : 's'}`
      : 'Sin estructura';
    pisos.push(`
      <button type="button" class="casita-piso${filaActiva === f ? ' casita-piso-activo' : ''}" data-casita-piso="${f}" title="Ver las habitaciones de «${escapeHtml(nombre)}»">
        <span class="casita-piso-izq">
          <span class="casita-piso-ico">${f === 1 ? '🛏️' : '🛋️'}</span>
          <span class="casita-piso-titulo">${escapeHtml(nombre)}</span>
        </span>
        <span class="casita-piso-meta">${escapeHtml(meta)}<span class="casita-piso-flecha">›</span></span>
      </button>`);
  }
  return `
  <div class="casita-lienzo" data-vista="casa">
    <div class="casita-silhouette">
      <svg class="casita-techo-svg" viewBox="0 0 320 96" role="img" aria-label="Techo puntiagudo de la casa de Estok">
        <defs>
          <linearGradient id="casitaTechoGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#9a3412" />
            <stop offset="100%" stop-color="#7c2d12" />
          </linearGradient>
        </defs>
        <clipPath id="casitaTechoClip"><path d="M4 96 L160 6 L316 96 Z" /></clipPath>
        <path d="M4 96 L160 6 L316 96 Z" fill="url(#casitaTechoGrad)" stroke="#5b1f0a" stroke-width="4" stroke-linejoin="round" />
        <path d="M160 6 L160 96" stroke="rgba(255,255,255,0.16)" stroke-width="2" />
        <g clip-path="url(#casitaTechoClip)">
          <path d="M0 34 L320 34" stroke="rgba(255,255,255,0.14)" stroke-width="2" />
          <path d="M0 58 L320 58" stroke="rgba(255,255,255,0.12)" stroke-width="2" />
          <path d="M0 80 L320 80" stroke="rgba(255,255,255,0.10)" stroke-width="2" />
        </g>
      </svg>
      <div class="casita-cuerpo">${pisos.join('')}</div>
    </div>
    <p class="casita-leyenda">Tocá una planta de la casa para navegar a sus habitaciones.</p>
  </div>`;
}

/** Nivel 2: minimapa ultra-mini de la casita + plano elástico + disyuntor del sub-nivel. */
export function renderHabitacionesHtml(params: {
  fila: number;
  total: number;
  divisiones: UbicacionPlano[];
  habitaciones: UbicacionPlano[];
}): string {
  const { fila, total, divisiones, habitaciones } = params;
  const nombre = nombreDePlanta(divisiones, fila);
  const habs = habitacionesDePlanta(divisiones, habitaciones, fila);
  const div = divisiones.find((d) => d.parent_grid_row === fila) ?? null;

  // UNIFICACIÓN DEL RENDERIZADO: TODAS las habitaciones (encastradas o legacy
  // sin encastre matricial) se dibujan como RECTÁNGULOS ELÁSTICOS LIBRES con su
  // geometría nativa ui_left/ui_top/ui_width/ui_height, mediante el MISMO motor
  // 2D que las plantas. Se conservan los iconos contextuales (🚽 🛏️ 🗄️ 🏠).
  const items: ItemElastico[] = habs.map((h) => ({
    ...h,
    icono: iconoDeHabitacion(h.nombre),
  }));

  const sinEstructura = `<div class="casita-hab-vacia">
        <span class="casita-hab-vacia-ico">🛏️</span>
        <p>Esta planta aún no tiene una división configurada.</p>
        <p class="casita-hab-vacia-sub">Definí la sub-grilla de la planta desde el modelador del Mapa Estok al crear o editar tu Estok.</p>
      </div>`;

  const plano = div
    ? renderLienzoElastico({
        items,
        etiquetaCrear: 'Habitación',
        textoVacio:
          'Esta planta no tiene habitaciones todavía. En modo «✏️ Editar» usá «➕ Habitación» para inyectar la primera.',
        // HOMOLOGACIÓN DEL EDITOR: misma guía contextual que el editor premium del
        // Onboarding (idéntico motor 2D), para que la interfaz se vea consistente.
        tip: '🧩 <strong>Editor de espacios</strong> · inyectá cada habitación con «➕ Habitación», arrastrala para acomodarla, estirá de su esquina para cambiar su tamaño y <strong>seleccioná 2+ para fusionarlas</strong> en un único bloque en «L».',
      })
    : sinEstructura;

  // DISYUNTOR CANÓNICO EN LA CABECERA DEL SUB-NIVEL: el mismo control
  // reutilizable (lib/espacioUnico.ts) declara la planta activa como bloque
  // monolítico. La persistencia la conecta el orquestador (enlazar()).
  const disyuntor = div
    ? checkboxEspacioUnicoHtml({
        id: 'casitaEspacioUnico',
        marcado: Boolean(div.espacio_unico),
        valor: div.id,
      })
    : '';

  return `
  <div class="casita-lienzo" data-vista="habitaciones">
    <div class="nav-jerarquica nav-jerarquica--extremos">
      <button type="button" class="nav-volver" data-casita-volver title="Volver a la vista general de la casa">⬅ Volver</button>
      <span class="flex items-center gap-3">
        <span class="nav-jerarquica__titulo">🏠 ${escapeHtml(nombre)}</span>
        ${disyuntor}
      </span>
    </div>
    <div class="casita-minimapa-wrap" title="Minimapa de la casita: la planta activa está en naranja">
      <div class="casita-minimapa-casilla">${minimapaCasitaSvg({ filas: total, filaActiva: fila })}</div>
      <div class="casita-minimapa-info">
        <span class="casita-minimapa-leyenda">Estás en</span>
        <strong>${escapeHtml(nombre)}</strong>
        <span class="casita-minimapa-hint">Tocá un piso del minimapa para saltar</span>
      </div>
    </div>
    <div class="casita-plano">${plano}</div>
  </div>`;
}
