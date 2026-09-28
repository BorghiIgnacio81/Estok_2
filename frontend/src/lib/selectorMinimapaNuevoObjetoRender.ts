// =============================================================================
// RENDER DEL SELECTOR DE UBICACIÓN POR MINIMAPAS INTERACTIVOS
// -----------------------------------------------------------------------------
// Capa PURA de dibujo del navegador espacial del alta de objetos: estado del
// recorrido + derivaciones de los espacios + HTML de las siluetas elásticas.
//
// NO dibuja nada por su cuenta: reutiliza el MOTOR GLOBAL de minimapas
// (lib/minimapa.ts → minimapaCasitaSvg / minimapaSectoresSvg) y el traductor de
// geometría real (lib/sectoresMinimapa.ts → sectoresDeItems) que ya usan las
// pantallas de Almacenamiento y Objetos. El resalte NARANJA (#f97316) es el
// mismo en toda la app.
//
// La navegación (clicks, fetch, escritura de los inputs) vive en
// selectorMinimapaNuevoObjeto.ts, que importa este módulo (dependencia única
// en una sola dirección, sin ciclos).
// =============================================================================

import { minimapaSectoresSvg, ASPECTO_LIENZO } from './minimapa';
import type { SectorMinimapa } from './minimapa';
import { sectoresDeItems } from './sectoresMinimapa';
import type { ItemGeometria } from './sectoresMinimapa';
import { renderMinimapasAnidados } from './minimapasAnidados';
import type { NodoRuta } from './minimapasAnidados';
import { escapeHtml } from './mapaJerarquico';
import type { EstokConfig, UbicacionPlano } from './mapaJerarquico';
import { iconoDeHabitacion } from './planoHabitaciones';

// =============================================================================
// TIPOS Y ESTADO
// =============================================================================

/** Contenedor de PostgreSQL (mueble, estante o caja) con su geometría real. */
export interface ContenedorMinimapa extends ItemGeometria {
  ubicacion?: string | null;
  parent_contenedor?: string | null;
  tipo?: string | null;
  grid_filas?: number | null;
}

export interface EstadoSelector {
  /** Estok activo (tenant): aporta la cantidad de plantas del inmueble. */
  estok: EstokConfig | null;
  ubicaciones: UbicacionPlano[];
  contenedores: ContenedorMinimapa[];
  cargando: boolean;
  error: string | null;
  /** Nivel visible: 0 = plantas, 1 = habitaciones, 2 = muebles, 3 = cajas. */
  nivel: 0 | 1 | 2 | 3;
  planta: string;
  habitacionId: string | null;
  muebleId: string | null;
  cajaId: string | null;
}

export const estado: EstadoSelector = {
  estok: null,
  ubicaciones: [],
  contenedores: [],
  cargando: true,
  error: null,
  nivel: 0,
  planta: 'PRIMER_PISO',
  habitacionId: null,
  muebleId: null,
  cajaId: null,
};

export const IDS = {
  niveles: 'minimapaNiveles',
  lienzo: 'minimapaLienzo',
  inputUbicacion: 'ubicacionSeleccionada',
  inputContenedor: 'contenedorSeleccionado',
};

const ICONO_TIPO: Record<string, string> = {
  MUEBLE: '🗄️',
  ESTANTE: '🗃️',
  CAJA: '📦',
};

function iconoContenedor(item: ItemGeometria): string {
  const tipo = String((item as ContenedorMinimapa).tipo || '').toUpperCase();
  return ICONO_TIPO[tipo] || '📦';
}

// =============================================================================
// DERIVACIONES DE LOS ESPACIOS REALES
// =============================================================================

/**
 * Plantas navegables del inmueble.
 * `cantidad_pisos > 1` = Modo Casa (varias plantas reales); si no, planta única.
 */
export function plantasDisponibles(): Array<{ valor: string; etiqueta: string }> {
  const total = Math.max(1, Math.floor(Number(estado.estok?.cantidad_pisos) || 1));
  const usadas = new Set(estado.ubicaciones.map((u) => String(u.piso || 'PRIMER_PISO')));
  const etiquetas = ['PRIMER_PISO', 'PLANTA_BAJA'];
  const lista: Array<{ valor: string; etiqueta: string }> = [];
  for (let i = 0; i < total; i++) {
    const valor = etiquetas[i] || `PLANTA_${i + 1}`;
    lista.push({ valor, etiqueta: i === 0 ? '1er piso' : `Planta ${i + 1}` });
  }
  // Plantas con habitaciones reales que no entraron por cantidad_pisos.
  usadas.forEach((valor) => {
    if (!lista.some((p) => p.valor === valor)) {
      lista.push({
        valor,
        etiqueta: valor === 'PLANTA_BAJA' ? 'Planta baja' : 'Planta adicional',
      });
    }
  });
  return lista;
}

/** Habitaciones (Ubicaciones raíz) de un piso concreto del inmueble. */
export function habitacionesDePiso(piso: string): UbicacionPlano[] {
  return estado.ubicaciones.filter(
    (u) => String(u.piso || 'PRIMER_PISO') === piso && !u.parent_ubicacion,
  );
}

/** Habitaciones (Ubicaciones raíz) de la planta activa. */
export function habitacionesDePlanta(): UbicacionPlano[] {
  return habitacionesDePiso(estado.planta);
}

/** Muebles/estantes contenidos en una habitación (contenedores raíz del espacio). */
export function mueblesDeHabitacion(ubicacionId: string | null): ContenedorMinimapa[] {
  if (!ubicacionId) return [];
  return estado.contenedores.filter(
    (c) => String(c.ubicacion || '') === String(ubicacionId) && !c.parent_contenedor,
  );
}

/** Cajas contenidas en un mueble (sub-contenedores directos). */
export function cajasDeMueble(muebleId: string | null): ContenedorMinimapa[] {
  if (!muebleId) return [];
  return estado.contenedores.filter((c) => String(c.parent_contenedor || '') === String(muebleId));
}

export function habitacionActual(): UbicacionPlano | null {
  return estado.ubicaciones.find((u) => String(u.id) === String(estado.habitacionId)) || null;
}

export function muebleActual(): ContenedorMinimapa | null {
  return estado.contenedores.find((c) => String(c.id) === String(estado.muebleId)) || null;
}

export function cajaActual(): ContenedorMinimapa | null {
  return estado.contenedores.find((c) => String(c.id) === String(estado.cajaId)) || null;
}

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
 * PLANO A ESCALA (formato elástico del componente global).
 *
 * Monta el MISMO markup de `MinimapaRuta.astro` en su variante `plano`: un
 * `<div class="minimapa-ruta minimapa-ruta-plano">` que se amolda al ancho real
 * de la tarjeta «Ubicación de Almacenamiento» y adentro el SVG ELÁSTICO del
 * motor global (`responsive: true` → `width="100%"`, `viewBox`), donde cada
 * sector conserva su `ui_*` real y el guardado actual va en NARANJA (#f97316).
 * Con `clicable` cada silueta viaja en un `<g data-sector-id>`: el clic se
 * resuelve en selectorMinimapaNuevoObjeto.ts y hace descender un nivel.
 */
function planoEscalaHtml(
  sectores: SectorMinimapa[],
  activoId: string | null,
  clicable: boolean,
): string {
  const svg = minimapaSectoresSvg({
    sectores,
    aspecto: ASPECTO_LIENZO,
    activoId: activoId || undefined,
    responsive: true,
    clicable,
  });
  if (!svg) return '';
  return `<div class="minimapa-ruta minimapa-ruta-plano w-full">${svg}</div>`;
}


// =============================================================================
// RENDER - LIENZO INTERACTIVO DE SILUETAS ELÁSTICAS
// =============================================================================

/**
 * Nivel 0: plantas del inmueble como PLANOS A ESCALA (una tarjeta por planta).
 *
 * REGLA ÚNICA DE DIBUJO: la silueta de cada planta la aporta el MISMO motor que
 * alimenta al componente global <MinimapaRuta /> (lib/minimapa.ts →
 * minimapaSectoresSvg con `responsive: true`): cada ambiente viaja con su
 * geometría REAL (ui_left/ui_top/ui_width/ui_height persistidos en PostgreSQL),
 * los trazos negros nítidos del formato `plano` y las fusiones («Pasillo
 * Escalera») como UN solo ambiente continuo, sin línea divisoria interna.
 *
 * El botón conserva `data-nivel="planta"` + `data-id`, así el click sigue
 * mutando la selección del formulario (planta → habitación → contenedor).
 */
function lienzoPlantasHtml(): string {
  const plantas = plantasDisponibles();
  const filaActiva = Math.max(1, plantas.findIndex((p) => p.valor === estado.planta) + 1);

  const cards = plantas
    .map((planta, i) => {
      const activa = i + 1 === filaActiva;
      const plano = planoEscalaHtml(
        sectoresDeItems(habitacionesDePiso(planta.valor), null, (h) =>
          iconoDeHabitacion(String(h.nombre ?? '')),
        ),
        null,
        false,
      );
      return `
        <button type="button" data-nivel="planta" data-id="${escapeHtml(planta.valor)}"
          class="minimapa-plantas-card flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 ${
            activa ? 'border-orange-500 bg-orange-50' : 'border-gray-200 bg-white hover:border-orange-400'
          } hover:shadow-md transition-base cursor-pointer w-full">
          ${plano || '<span class="text-[10px] text-gray-400">Sin geometría</span>'}
          <span class="text-xs font-semibold text-gray-800">${escapeHtml(planta.etiqueta)}</span>
        </button>`;
    })
    .join('');

  return `<div class="minimapa-plantas-cards grid grid-cols-1 sm:grid-cols-2 gap-3">${cards}</div>`;
}





function lienzoHabitacionesHtml(): string {
  const habitaciones = habitacionesDePlanta();
  if (!habitaciones.length) {
    return '<p class="text-sm text-gray-500 py-4 text-center">👉 Esta planta todavía no tiene habitaciones. Usá «Nueva Ubicación» para crear una y volvé a elegir.</p>';
  }
  // UN plano a escala del piso completo: el sector NARANJA es la habitación ya
  // guardada (estado.habitacionId) y cualquiera se toca para entrar.
  const plano = planoEscalaHtml(
    sectoresDeItems(habitaciones, estado.habitacionId, (h) =>
      iconoDeHabitacion(String(h.nombre ?? '')),
    ),
    estado.habitacionId,
    true,
  );
  return `${plano}
    <p class="mt-2 text-[11px] text-gray-500 text-center">Tocá un ambiente del plano para entrar; el sector naranja es la ubicación guardada.</p>`;
}

function lienzoMueblesHtml(): string {
  const muebles = mueblesDeHabitacion(estado.habitacionId);
  const habitacion = habitacionActual();
  if (!muebles.length) {
    return `<p class="text-sm text-gray-500 py-4 text-center">👉 «${escapeHtml(
      habitacion?.nombre || 'La habitación',
    )}» no tiene muebles ni cajas. Podés guardar el objeto en la habitación completa o crear un contenedor con «Nuevo Contenedor».</p>`;
  }
  const plano = planoEscalaHtml(
    sectoresDeItems(muebles, estado.muebleId, iconoContenedor),
    estado.muebleId,
    true,
  );
  return `${plano}
    <p class="mt-2 text-[11px] text-gray-500 text-center">Tocá un mueble del plano para abrir sus cajas, o guardá el objeto en la habitación completa.</p>`;
}

function lienzoCajasHtml(): string {
  const cajas = cajasDeMueble(estado.muebleId);
  const mueble = muebleActual();
  if (!cajas.length) {
    return `<p class="text-sm text-gray-500 py-4 text-center">👉 «${escapeHtml(
      mueble?.nombre || 'El mueble',
    )}» no tiene cajas internas. Podés guardar el objeto en el mueble completo o crear una caja con «Nuevo Contenedor».</p>`;
  }
  const plano = planoEscalaHtml(
    sectoresDeItems(cajas, estado.cajaId, iconoContenedor),
    estado.cajaId,
    true,
  );
  return `${plano}
    <p class="mt-2 text-[11px] text-gray-500 text-center">Tocá la caja o estante exacto donde vive el objeto; el sector naranja es la ubicación guardada.</p>`;
}

// =============================================================================
// RENDER - ENSAMBLADO DEL NIVEL VISIBLE
// =============================================================================

const TITULO_NIVEL: Record<number, string> = {
  0: 'Elegí la planta del inmueble',
  1: 'Elegí la habitación',
  2: 'Elegí el mueble o guardá en la habitación',
  3: 'Elegí la caja / estante',
};

function cabeceraNivelHtml(): string {
  const volver = estado.nivel > 0
    ? '<button type="button" data-accion="volver" class="px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-base">← Volver</button>'
    : '';
  const limpiar = estado.habitacionId
    ? '<button type="button" data-accion="limpiar" class="px-2.5 py-1 text-xs font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-base">Quitar ubicación</button>'
    : '';
  return `
    <div class="flex items-center justify-between gap-2 mb-3">
      <p class="text-sm font-semibold text-gray-700">${TITULO_NIVEL[estado.nivel] || ''}</p>
      <div class="flex items-center gap-2">${volver}${limpiar}</div>
    </div>`;
}

function cuerpoNivelHtml(): string {
  if (estado.nivel === 0) return lienzoPlantasHtml();
  if (estado.nivel === 1) return lienzoHabitacionesHtml();
  if (estado.nivel === 2) return lienzoMueblesHtml();
  return lienzoCajasHtml();
}

function renderLienzo(): void {
  const host = document.getElementById(IDS.lienzo);
  if (!host) return;

  if (estado.cargando) {
    host.innerHTML = '<p class="text-sm text-gray-400 py-6 text-center">Cargando espacios del Estok…</p>';
    return;
  }
  if (estado.error) {
    host.innerHTML = `<p class="text-sm text-red-600 py-6 text-center">⚠️ ${escapeHtml(estado.error)}</p>`;
    return;
  }
  host.innerHTML = cabeceraNivelHtml() + cuerpoNivelHtml();
}

/** Repinta la cadena de orientación y el plano a escala del nivel visible. */
export function render(): void {
  renderNiveles();
  renderLienzo();
}

