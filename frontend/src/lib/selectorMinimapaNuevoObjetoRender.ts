// =============================================================================
// RENDER DEL SELECTOR DE UBICACIÓN POR MINIMAPAS INTERACTIVOS (Objetos)
// -----------------------------------------------------------------------------
// Capa PURA de dibujo del navegador espacial del alta y la edición de objetos.
//
// NO dibuja nada por su cuenta: reutiliza el MOTOR GLOBAL de minimapas
// (lib/minimapa.ts → minimapaSectoresSvg con `responsive: true`) y el traductor
// de geometría real (lib/sectoresMinimapa.ts → sectoresDeItems). El resalte
// NARANJA (#f97316) del ambiente/contenedor ACTUAL es el mismo en toda la app.
//
// El estado del recorrido y las derivaciones de los espacios viven en
// selectorMinimapaUbicacionEstado.ts; la navegación (fetch, clicks y escritura
// de los inputs) en selectorMinimapaNuevoObjeto.ts. Dependencia en una sola
// dirección, sin ciclos.
// =============================================================================

import { ASPECTO_LIENZO, minimapaSectoresSvg } from './minimapa';
import type { SectorMinimapa } from './minimapa';
import { sectoresDeItems } from './sectoresMinimapa';
import { renderMinimapasAnidados } from './minimapasAnidados';
import type { NodoRuta } from './minimapasAnidados';
import { escapeHtml } from './mapaJerarquico';
import { iconoDeHabitacion } from './planoHabitaciones';
// Fuente ÚNICA de estado, IDs del DOM y derivaciones de los espacios reales.
import {
  estado,
  IDS,
  iconoContenedor,
  plantasDisponibles,
  habitacionesDePlanta,
  mueblesDeHabitacion,
  cajasDeMueble,
  habitacionActual,
  muebleActual,
  cajaActual,
} from './selectorMinimapaUbicacionEstado';

export { estado, IDS } from './selectorMinimapaUbicacionEstado';
export type { ContenedorMinimapa, EstadoSelector } from './selectorMinimapaUbicacionEstado';

// =============================================================================
// RENDER - BARRA DE MINIMAPAS ANIDADOS (migaja de procedencia)
// =============================================================================

/** Cadena de nodos de la ruta actual (la consume el motor global de minimapas). */
function nodosDeRuta(): NodoRuta[] {
  const plantas = plantasDisponibles();
  const fila = Math.max(1, plantas.findIndex((p) => p.valor === estado.planta) + 1);
  const nodos: NodoRuta[] = [
    {
      tipo: 'estok',
      nombre: estado.estok?.nombre || 'Mi Estok',
      id: estado.estok?.id ?? null,
      filaActiva: fila,
      totalPlantas: plantas.length,
    },
  ];

  const habitacion = habitacionActual();
  if (habitacion) {
    nodos.push({
      tipo: 'habitacion',
      nombre: habitacion.nombre,
      id: String(habitacion.id),
      sectores: sectoresDeItems(habitacionesDePlanta(), String(habitacion.id)),
      aspecto: ASPECTO_LIENZO,
    });
  }

  const mueble = muebleActual();
  if (mueble) {
    nodos.push({
      tipo: 'mueble',
      nombre: mueble.nombre || 'Mueble',
      id: String(mueble.id),
      sectores: sectoresDeItems(
        mueblesDeHabitacion(estado.habitacionId),
        String(mueble.id),
        iconoContenedor,
      ),
      aspecto: ASPECTO_LIENZO,
      filas: Math.max(1, Number(mueble.grid_filas) || 1),
    });
  }

  const caja = cajaActual();
  if (caja) {
    nodos.push({
      tipo: 'caja',
      nombre: caja.nombre || 'Caja',
      id: String(caja.id),
      sectores: sectoresDeItems(cajasDeMueble(estado.muebleId), String(caja.id), iconoContenedor),
      aspecto: ASPECTO_LIENZO,
    });
  }

  return nodos;
}

function renderNiveles(): void {
  const host = document.getElementById(IDS.niveles);
  if (!host) return;
  host.innerHTML = renderMinimapasAnidados(nodosDeRuta(), { todosActivos: true });
}

/**
 * SVG ELÁSTICO DEL PLANO (lo monta el componente global `MinimapaRuta.astro`).
 *
 * Devuelve SOLO el `<svg>` del motor (`responsive: true`), porque el host ya es
 * el contenedor canónico del componente (`.minimapa-ruta.minimapa-ruta-plano`):
 * fondo crema suave, borde negro de puntas redondeadas y el ambiente actual en
 * NARANJA (#f97316). Cada ambiente conserva su `ui_*` REAL, y las fusiones
 * («Pasillo Escalera») salen como UN solo contorno, sin divisorias internas.
 * Con `clicable` cada silueta viaja en `<g data-sector-id>`: el clic desciende
 * un nivel (lo resuelve selectorMinimapaNuevoObjeto.ts).
 */
function planoSvgHtml(
  sectores: SectorMinimapa[],
  activoId: string | null,
  clicable: boolean,
): string {
  return minimapaSectoresSvg({
    sectores,
    aspecto: ASPECTO_LIENZO,
    activoId: activoId || undefined,
    responsive: true,
    clicable,
  });
}


// =============================================================================
// RENDER - PLANO ELÁSTICO DEL NIVEL VISIBLE (único motor: componente global)
// =============================================================================
//
// DEMOLICIÓN DEL SELECTOR RÍGIDO DE PLANTAS: ya NO existe el nivel 0 de
// «elegí la planta» con una tarjeta/cajón por planta (los «1er piso» /
// «Planta 2» amarillos que no representaban nada). El recorrido arranca
// SIEMPRE en el PLANO REAL de la planta activa (nivel 1): cada ambiente es un
// sector proporcional con su geometría real (ui_left/ui_top/ui_width/
// ui_height persistidos en PostgreSQL) y el contenedor guardado se pinta en
// NARANJA ESTRICTO (#f97316). Se toca directamente la habitación o el mueble
// para fijar la ubicación del objeto.

interface CuerpoNivel {
  /** `<svg>` elástico del plano (lo inyecta el host del componente global). */
  svg: string;
  /** Aviso cuando el nivel visible no tiene espacios que dibujar. */
  aviso: string;
}

/** Nivel 1: plano a escala de las habitaciones REALES de la planta activa. */
function planoHabitaciones(): CuerpoNivel {
  const habitaciones = habitacionesDePlanta();
  if (!habitaciones.length) {
    return {
      svg: '',
      aviso:
        '👉 Esta planta todavía no tiene habitaciones. Usá «Nueva Ubicación» para crear una: aparecerá dibujada a escala en este plano.',
    };
  }
  return {
    svg: planoSvgHtml(
      sectoresDeItems(habitaciones, estado.habitacionId, (h) =>
        iconoDeHabitacion(String(h.nombre ?? '')),
      ),
      estado.habitacionId,
      true,
    ),
    aviso: '',
  };
}

/** Nivel 2: plano a escala de los muebles REALES de la habitación activa. */
function planoMuebles(): CuerpoNivel {
  const muebles = mueblesDeHabitacion(estado.habitacionId);
  if (!muebles.length) {
    return {
      svg: '',
      aviso: `👉 «${escapeHtml(
        habitacionActual()?.nombre || 'La habitación',
      )}» no tiene muebles ni cajas. Podés guardar el objeto en la habitación completa o crear un contenedor con «Nuevo Contenedor».`,
    };
  }
  return {
    svg: planoSvgHtml(sectoresDeItems(muebles, estado.muebleId, iconoContenedor), estado.muebleId, true),
    aviso: '',
  };
}

/** Nivel 3: plano a escala de las cajas/estantes REALES del mueble activo. */
function planoCajas(): CuerpoNivel {
  const cajas = cajasDeMueble(estado.muebleId);
  if (!cajas.length) {
    return {
      svg: '',
      aviso: `👉 «${escapeHtml(
        muebleActual()?.nombre || 'El mueble',
      )}» no tiene cajas internas. Podés guardar el objeto en el mueble completo o crear una caja con «Nuevo Contenedor».`,
    };
  }
  return {
    svg: planoSvgHtml(sectoresDeItems(cajas, estado.cajaId, iconoContenedor), estado.cajaId, true),
    aviso: '',
  };
}

/** Cuerpo del nivel visible (siempre un plano proporcional, nunca una grilla). */
function cuerpoNivel(): CuerpoNivel {
  if (estado.nivel === 2) return planoMuebles();
  if (estado.nivel === 3) return planoCajas();
  return planoHabitaciones();
}

// =============================================================================
// RENDER - ENSAMBLADO DEL NIVEL VISIBLE (cabecera + plano + pie)
// =============================================================================

const TITULO_NIVEL: Record<1 | 2 | 3, string> = {
  1: 'Tocá la habitación en el plano de tu casa',
  2: 'Tocá el mueble, o guardá en la habitación completa',
  3: 'Tocá la caja / estante exacto',
};

const PIE_NIVEL: Record<1 | 2 | 3, string> = {
  1: 'El plano es el dibujo a escala de tu casa: el ambiente naranja es la ubicación guardada.',
  2: 'Tocá un mueble del plano para abrir sus cajas, o guardá el objeto en la habitación completa.',
  3: 'Tocá la caja o estante exacto donde vive el objeto; el sector naranja es la ubicación guardada.',
};

/**
 * Planta activa del plano: es un DATO de contexto, nunca un selector de mapas.
 * Con una sola planta se muestra como etiqueta; en Modo Casa (varias plantas)
 * se ofrece un `<select>` nativo compacto para cambiar de piso — jamás los
 * cajones vacíos «1er piso» / «Planta 2».
 */
function plantaEtiquetaHtml(): string {
  const plantas = plantasDisponibles();
  const etiqueta = plantas.find((p) => p.valor === estado.planta)?.etiqueta || 'Planta activa';
  if (plantas.length <= 1) {
    return `<span class="text-[11px] text-gray-500">🏠 ${escapeHtml(etiqueta)}</span>`;
  }
  const opciones = plantas
    .map(
      (p) =>
        `<option value="${escapeHtml(p.valor)}"${p.valor === estado.planta ? ' selected' : ''}>${escapeHtml(p.etiqueta)}</option>`,
    )
    .join('');
  return `<label class="flex items-center gap-1 text-[11px] text-gray-500">🏠 Planta
    <select data-accion="planta" class="px-1.5 py-0.5 text-[11px] text-gray-700 bg-white border border-gray-300 rounded-md">${opciones}</select>
  </label>`;
}

function cabeceraNivelHtml(): string {
  const volver =
    estado.nivel > 1
      ? '<button type="button" data-accion="volver" class="px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-base">← Volver</button>'
      : '';
  const limpiar = estado.habitacionId
    ? '<button type="button" data-accion="limpiar" class="px-2.5 py-1 text-xs font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-base">Quitar ubicación</button>'
    : '';
  return `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <p class="text-sm font-semibold text-gray-700">${TITULO_NIVEL[estado.nivel]}</p>
      <div class="flex items-center gap-2">${plantaEtiquetaHtml()}${volver}${limpiar}</div>
    </div>`;
}

/**
 * Reparte el nivel visible en sus TRES hosts: cabecera (`IDS.texto`), plano
 * (`IDS.lienzo`, host del componente global) y pie (`IDS.pie`). Así el plano es
 * literalmente el componente `<MinimapaRuta />` y nada más.
 */
function renderLienzo(): void {
  const plano = document.getElementById(IDS.lienzo);
  const texto = document.getElementById(IDS.texto);
  const pie = document.getElementById(IDS.pie);

  const mensaje = estado.cargando
    ? '<p class="text-sm text-gray-400 py-6 text-center">Cargando espacios del Estok…</p>'
    : estado.error
      ? `<p class="text-sm text-red-600 py-6 text-center">⚠️ ${escapeHtml(estado.error)}</p>`
      : '';
  if (mensaje) {
    if (plano) plano.innerHTML = '';
    if (texto) texto.innerHTML = mensaje;
    if (pie) pie.innerHTML = '';
    return;
  }

  const cuerpo = cuerpoNivel();
  if (texto) {
    texto.innerHTML =
      cabeceraNivelHtml() +
      (cuerpo.aviso ? `<p class="text-sm text-gray-500 py-3 text-center">${cuerpo.aviso}</p>` : '');
  }
  if (plano) plano.innerHTML = cuerpo.svg;
  if (pie) {
    pie.innerHTML = cuerpo.svg
      ? `<p class="mt-2 text-[11px] text-gray-500 text-center">${PIE_NIVEL[estado.nivel]}</p>`
      : '';
  }
}

/** Repinta la cadena de orientación y el plano elástico del nivel visible. */
export function render(): void {
  renderNiveles();
  renderLienzo();
}

