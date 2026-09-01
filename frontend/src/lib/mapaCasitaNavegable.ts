// =============================================================================
// LIENZO NAVEGABLE "MAPA ESTOK" - CASA CON TECHO PUNTIAGUDO (Nivel 1 → Nivel 2)
// -----------------------------------------------------------------------------
// Reemplaza el mapa matricial con inputs numéricos por un lienzo puramente
// gráfico y táctil por niveles en cascada:
//   Nivel 1 (La Casa)  : silueta de casa con techo puntiagudo (trazado SVG).
//                         Cada planta es una macro-división persistida en
//                         PostgreSQL ("Primer Piso" arriba, "Planta Baja"
//                         abajo). Al hacer clic se registra el estado activo
//                         y se conmuta el mapa de forma reactiva.
//   Nivel 2 (Habitaciones): minimapa de la casita en ULTRA-MINI (4× más chico)
//                         con la planta seleccionada en NARANJA (#f97316) +
//                         botón "⬅ Volver". Cada habitación alimenta al
//                         "Visor de la Habitación Seleccionada"
//                         (visorHabitacion.ts) vía el evento
//                         'estok:habitacion-seleccionada'.
// La configuración numérica de la estructura vive ÚNICAMENTE dentro del wizard
// "✏️ Editar Estructura" (mapaEstokWizardUI.ts). Aquí NO hay inputs numéricos.
// Estado inicial forzado: la navegación NACE en el Nivel 1 y la casa se pinta
// de forma SÍNCRONA al iniciar (el lienzo nunca queda vacío esperando datos).
// =============================================================================

import {
  PISO_PRIMERO,
  PISO_BAJA,
  ETIQUETAS_PISO,
  escapeHtml,
  fetchEstokConfig,
  fetchUbicacionesPlano,
  esDivisionUbicacion,
} from './mapaJerarquico';
import type { EstokConfig, UbicacionPlano } from './mapaJerarquico';
import { COLOR_NARANJA } from './minimapa';

// =============================================================================
// ESTADO DEL LIENZO
// =============================================================================

interface RefsCasita {
  mapa: HTMLElement | null;
  badge: HTMLElement | null;
}

let refs: RefsCasita = { mapa: null, badge: null };
let estok: EstokConfig | null = null;
let divisiones: UbicacionPlano[] = [];
let habitaciones: UbicacionPlano[] = [];
/** Planta activa (parent_grid_row). null = vista general sin filtro. */
let filaActiva: number | null = null;
/** Nivel de navegación: 1 = casa general, 2 = habitaciones de una planta.
 *  NACE estrictamente en el Nivel 1 para que la casa se dibuje apenas carga. */
let nivelActual: 1 | 2 = 1;

// =============================================================================
// HELPERS DE DOMINIO
// =============================================================================

function totalPlantas(): number {
  const desdeDatos = divisiones.reduce(
    (max, d) => Math.max(max, d.parent_grid_row || 1),
    1,
  );
  return Math.max(estok?.grid_filas || desdeDatos, desdeDatos);
}

function nombreDePlanta(fila: number): string {
  const div = divisiones.find((d) => d.parent_grid_row === fila);
  if (div) return div.nombre;
  if (fila === 1) return ETIQUETAS_PISO[PISO_PRIMERO];
  if (fila === 2) return ETIQUETAS_PISO[PISO_BAJA];
  return `División ${fila}`;
}

/** Habitaciones de una planta: encastradas en su división + sueltas legacy. */
function habitacionesDePlanta(fila: number): UbicacionPlano[] {
  const div = divisiones.find((d) => d.parent_grid_row === fila);
  const divisionId = div?.id ?? '__sin_division__';
  const encastradas = habitaciones.filter((h) => h.parent_ubicacion === divisionId);
  const sueltas = habitaciones.filter((h) => !h.parent_ubicacion && h.parent_grid_row === fila);
  return [...encastradas, ...sueltas].sort((a, b) => {
    const ra = a.parent_grid_row || 0;
    const rb = b.parent_grid_row || 0;
    const ca = a.parent_grid_col || 0;
    const cb = b.parent_grid_col || 0;
    return ra - rb || ca - cb;
  });
}

/** Dispara el evento de planta seleccionada para filtrar la cascada en caliente. */
function notificarPlanta(): void {
  const div = divisiones.find((d) => d.parent_grid_row === filaActiva);
  window.dispatchEvent(
    new CustomEvent('estok:planta-seleccionada', {
      detail: {
        fila: filaActiva,
        nombre: filaActiva ? div?.nombre || nombreDePlanta(filaActiva) : null,
      },
    }),
  );
}

// =============================================================================
// RENDER
// =============================================================================

/** Minimapa de la casita en ULTRA-MINI (celda 9px, 4× más chico) con techo. */
function casitaMinimapaSvg(opts: { filas: number; filaActiva: number }): string {
  const { filas, filaActiva } = opts;
  const cell = 9;
  const gap = 2;
  const pad = 3;
  const techoAlto = 11;
  const ancho = pad * 2 + cell;
  const altoCuerpo = pad * 2 + filas * cell + (filas - 1) * gap;
  const h = techoAlto + altoCuerpo;

  let celdas = '';
  for (let r = 1; r <= filas; r++) {
    const y = techoAlto + pad + (r - 1) * (cell + gap);
    const activa = r === filaActiva;
    celdas += `<rect data-mini-fila="${r}" x="${pad}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${activa ? COLOR_NARANJA : '#fef3c7'}" stroke="${activa ? '#c2410c' : '#d1d5db'}" stroke-width="0.5" />`;
  }
  const techo = `<path d="M${ancho / 2} 0 L${ancho} ${techoAlto} L0 ${techoAlto} Z" fill="#9a3412" stroke="#7c2d12" stroke-width="0.5" />`;

  return `<svg class="casita-minimapa-svg" width="${ancho}" height="${h + 2}" viewBox="0 0 ${ancho} ${h + 2}" role="img" aria-label="Minimapa de la casita">${techo}${celdas}</svg>`;
}

/** Nivel 1: la casa con techo puntiagudo y sus plantas como botones. */
function renderCasa(): string {
  const total = totalPlantas();
  const pisos: string[] = [];
  for (let f = 1; f <= total; f++) {
    const div = divisiones.find((d) => d.parent_grid_row === f);
    const nombre = nombreDePlanta(f);
    const habs = habitacionesDePlanta(f);
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
        <rect x="216" y="16" width="20" height="34" rx="3" fill="#7c2d12" stroke="#5b1f0a" stroke-width="2" />
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

async function cargarDatos(): Promise<void> {
  const todas = await fetchUbicacionesPlano();
  divisiones = todas.filter((u) => esDivisionUbicacion(u));
  habitaciones = todas.filter((u) => !esDivisionUbicacion(u));
}

/** Nivel 2: minimapa ultra-mini de la casita + habitaciones de la planta. */
function renderHabitaciones(): string {
  const fila = filaActiva || 1;
  const nombre = nombreDePlanta(fila);
  const habs = habitacionesDePlanta(fila);
  const total = totalPlantas();

  const tarjetas = habs.length
    ? habs.map((h) => {
        const coord =
          h.parent_grid_row && h.parent_grid_col
            ? `F${h.parent_grid_row}·C${h.parent_grid_col}`
            : 'Suelta';
        const meta = [
          coord,
          (h.contenedores_count || 0) > 0 ? `${h.contenedores_count} cont` : null,
          (h.objetos_count || 0) > 0 ? `${h.objetos_count} obj` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return `
        <button type="button" class="casita-habitacion" data-casita-habitacion="${h.id}" title="Abrir «${escapeHtml(h.nombre)}» en el Visor de la derecha">
          <span class="casita-hab-ico">🏠</span>
          <span class="casita-hab-nombre">${escapeHtml(h.nombre)}</span>
          ${meta ? `<span class="casita-hab-meta">${escapeHtml(meta)}</span>` : ''}
        </button>`;
      }).join('')
    : `<div class="casita-hab-vacia">
        <span class="casita-hab-vacia-ico">🛏️</span>
        <p>No hay habitaciones en esta planta todavía.</p>
        <p class="casita-hab-vacia-sub">Usá «✏️ Editar Estructura» para cargar las habitaciones de «${escapeHtml(nombre)}».</p>
      </div>`;

  return `
  <div class="casita-lienzo" data-vista="habitaciones">
    <div class="casita-nivel2-cab">
      <button type="button" class="casita-volver" data-casita-volver title="Volver a la vista general de la casa">⬅ Volver</button>
      <span class="casita-nivel2-titulo">🏠 ${escapeHtml(nombre)}</span>
    </div>
    <div class="casita-minimapa-wrap" title="Minimapa de la casita: la planta activa está en naranja">
      <div class="casita-minimapa-casilla">${casitaMinimapaSvg({ filas: total, filaActiva: fila })}</div>
      <div class="casita-minimapa-info">
        <span class="casita-minimapa-leyenda">Estás en</span>
        <strong>${escapeHtml(nombre)}</strong>
        <span class="casita-minimapa-hint">Tocá un piso del minimapa para saltar</span>
      </div>
    </div>
    <div class="casita-habitaciones">${tarjetas}</div>
  </div>`;
}

function render(): void {
  if (!refs.mapa) return;
  refs.mapa.innerHTML = `<div class="casita-raiz">${nivelActual === 1 ? renderCasa() : renderHabitaciones()}</div>`;
  if (refs.badge) {
    refs.badge.textContent =
      nivelActual === 1
        ? `Nivel 1 · ${estok?.nombre || 'Casa de Estok'}`
        : `Nivel 2 · ${nombreDePlanta(filaActiva || 1)}`;
  }
}

// =============================================================================
// INTERACCIÓN (registro de estado activo + conmutación reactiva)
// =============================================================================

function enlazar(): void {
  if (!refs.mapa) return;

  // Nivel 1: clic en una planta → registra estado activo + conmuta al Nivel 2.
  refs.mapa.querySelectorAll<HTMLElement>('[data-casita-piso]').forEach((el) => {
    el.addEventListener('click', () => {
      const fila = Number(el.dataset.casitaPiso);
      if (!fila) return;
      filaActiva = fila;
      nivelActual = 2;
      render();
      enlazar();
      notificarPlanta();
    });
  });

  // Nivel 2: botón "⬅ Volver" → regresa a la vista general de la casa.
  refs.mapa.querySelectorAll<HTMLElement>('[data-casita-volver]').forEach((el) => {
    el.addEventListener('click', () => {
      nivelActual = 1;
      render();
      enlazar();
      notificarPlanta();
    });
  });

  // Nivel 2: saltar a otra planta tocando el minimapa ultra-mini de la casita.
  refs.mapa.querySelectorAll<HTMLElement>('[data-mini-fila]').forEach((el) => {
    el.addEventListener('click', () => {
      const fila = Number(el.getAttribute('data-mini-fila'));
      if (!fila || fila === filaActiva) return;
      filaActiva = fila;
      render();
      enlazar();
      notificarPlanta();
    });
  });

  // Nivel 2: clic en una habitación → alimenta el Visor de la columna derecha.
  refs.mapa.querySelectorAll<HTMLElement>('[data-casita-habitacion]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.casitaHabitacion;
      const room = habitaciones.find((h) => h.id === id);
      if (!room) return;
      window.dispatchEvent(new CustomEvent('estok:habitacion-seleccionada', { detail: { room } }));
    });
  });
}

// =============================================================================
// ENTRADA
// =============================================================================

export function initMapaCasita(opts: {
  mapa?: HTMLElement | null;
  badge?: HTMLElement | null;
}): void {
  refs = { mapa: opts.mapa ?? null, badge: opts.badge ?? null };
  if (!refs.mapa) return;

  // Estado inicial estricto: la navegación NACE en el Nivel 1 (casa general).
  // La silueta con techo puntiagudo se dibuja de forma INSTANTÁNEA y luego,
  // al llegar los datos del Estok activo, se re-renderiza con las divisiones
  // raíz reales (Planta Alta arriba, Planta Baja abajo).
  filaActiva = null;
  nivelActual = 1;
  pintarCasaInicial();

  // Carga asíncrona de las macro-divisiones del Estok activo. Si el fetch
  // falla de forma transitoria (p. ej. sesión aún restaurándose), se reintenta
  // SIN que el lienzo quede vacío: la casa ya quedó pintada por defecto.
  void cargarConReintentos();

  // Refresco en vivo ante mutaciones externas (wizard "Editar Estructura",
  // movimientos/eliminaciones): se recarga SIN re-enlazar controles fijos.
  window.addEventListener('estok:espacios-cambiados', () => {
    void cargarYRefrescar();
  });
}

/** Pinta el Nivel 1 (casa) de forma síncrona e inmediata con los datos actuales. */
function pintarCasaInicial(): void {
  render();
  enlazar();
}

/** Carga config del Estok + divisiones/habitaciones y re-renderiza. */
async function cargarYRefrescar(): Promise<boolean> {
  const conf = await fetchEstokConfig();
  if (!conf) return false;
  estok = conf;
  await cargarDatos();
  render();
  enlazar();
  notificarPlanta();
  return true;
}

/** Reintentos acotados ante fallos transitorios de la inicialización. */
async function cargarConReintentos(intentosMax = 6, esperaMs = 700): Promise<void> {
  for (let intento = 1; intento <= intentosMax; intento++) {
    if (await cargarYRefrescar()) return;
    await new Promise((resolve) => setTimeout(resolve, esperaMs));
  }
  if (refs.badge) refs.badge.textContent = 'Nivel 1 · Sin datos';
}


