// =============================================================================
// MINIMAPA GRÁFICO PADRE · CONTEXTO SUPERIOR DE /almacenamiento
// -----------------------------------------------------------------------------
// Dibuja, en la ZONA SUPERIOR del cuadrante izquierdo, el vector/SVG del NIVEL
// ANTERIOR (el contenedor PADRE) con el piso/cuarto/mueble ACTIVO pintado en
// NARANJA (#f97316). Convive con el plano grande del nivel y con su título:
// acá NO se borra ningún nombre, sólo se aporta la silueta de orientación.
//
//   Nivel 2 (Planta)      → casita a dos aguas con la planta activa en naranja.
//   Nivel 3 (Habitación)  → plano de la PLANTA con el cuarto activo en naranja.
//   Nivel 4 (Mueble)      → plano de la HABITACIÓN con el mueble activo naranja.
//   Nivel 5 (Caja/Estante)→ plano del MUEBLE con la caja/estante activo naranja.
//   Nivel 1 (Casa raíz)   → sin minimapa superior (no hay padre).
//
// GEOMETRÍA REAL: el dibujo NO inventa cajas. Consume el MISMO layout del padre
// que ya viaja en la cascada (`NodoPortal.hijos` / `estadoPortales.planta.
// hermanas`, ambos `ui_left/ui_top/ui_width/ui_height`). Si ese prop llegara
// vacío, se resuelve el layout desde la API (contenedores raíz de la habitación
// o interior del mueble) antes de rendir: el minimapa NUNCA queda en blanco.
//
// El motor de dibujo es el global (lib/minimapa.ts → minimapaSectoresSvg /
// minimapaCasitaSvg), el mismo de la cadena de minimapas de Objetos y Mudanza.
// Módulo de render PURO + resolución de datos cacheada; no toca el DOM.
// =============================================================================

import { ASPECTO_LIENZO, minimapaCasitaSvg, minimapaSectoresSvg } from '../../minimapa';
import { sectoresDeItems } from '../../sectoresMinimapa';
import type { ItemGeometria } from '../../sectoresMinimapa';
import { escapeHtml } from '../../mapaJerarquico';
import { estadoPortales, nodoActual, nodoPadre } from './estadoPortales';
import type { NodoPortal } from './estadoPortales';
import { aspectoDelLienzo, el } from './domPortales';
import {
  cargarInteriorDeNodo,
  contenedoresRaizDeUbicacion,
  datosDeNivelPlanta,
  geometriaDe,
} from './datosNodosPortales';
import { plantaIdAncla } from './nivelRaizPortales';

/** Nivel geométrico que representa el minimapa. */
export type TipoMinimapaPadre = 'casa' | 'planta' | 'habitacion' | 'mueble';

/** Contexto resuelto del nivel padre (todo lo necesario para dibujarlo). */
export interface ContextoMinimapaPadre {
  tipo: TipoMinimapaPadre;
  /** Nombre real del nivel padre (Planta Alta · Habitación Frente · Cama…). */
  nombre: string;
  /** Planta activa (1-based) del gráfico de la casita. */
  filaActiva?: number | null;
  /** Total de plantas del inmueble (filas del gráfico de la casita). */
  totalPlantas?: number;
  /** Layout REAL del padre (hijos con ui_*) → el motor dibuja sus siluetas. */
  sectores?: ReturnType<typeof sectoresDeItems>;
  /** Relación alto/ancho del lienzo real, para no deformar las proporciones. */
  aspecto?: number;
  /** Id real del nodo ACTIVO: su sector se pinta en naranja. */
  activoId?: string | null;
}

/** Icono de referencia del nivel padre (sólo decorativo). */
const ICONO: Record<TipoMinimapaPadre, string> = {
  casa: '🏠',
  planta: '🏠',
  habitacion: '🚪',
  mueble: '🗄️',
};


/** Envoltorio común: cabecera con el nombre del padre + plano SVG. */
function bloqueHtml(
  ctx: ContextoMinimapaPadre,
  svg: string,
  claseMarco: string,
  estiloMarco = '',
): string {
  const icono = ICONO[ctx.tipo] ?? '🧭';
  return `<section class="minimapa-padre-contexto" data-minimapa-padre="${ctx.tipo}"
    aria-label="Minimapa del nivel superior: ${escapeHtml(ctx.nombre)}">
    <header class="minimapa-padre-cab">
      <span class="minimapa-padre-ico" aria-hidden="true">${icono}</span>
      <span class="minimapa-padre-nombre">${escapeHtml(ctx.nombre)}</span>
    </header>
    <div class="${claseMarco}"${estiloMarco ? ` style="${estiloMarco}"` : ''}>${svg}</div>
  </section>`;
}

/**
 * HTML del minimapa padre. Devuelve '' cuando no hay padre (Nivel 1 de la Casa)
 * o cuando el padre no tiene ninguna silueta que dibujar.
 */
export function minimapaPadreHtml(ctx: ContextoMinimapaPadre | null): string {
  if (!ctx) return '';

  if (ctx.tipo === 'casa') {
    const total = Math.max(1, Math.round(Number(ctx.totalPlantas) || 1));
    const fila = Math.max(1, Math.min(total, Math.round(Number(ctx.filaActiva) || 1)));
    const svg = minimapaCasitaSvg({ filas: total, filaActiva: fila });
    return bloqueHtml(ctx, svg, 'minimapa-padre-marco minimapa-padre-marco-casa');
  }

  const aspecto = Number(ctx.aspecto) > 0 ? Number(ctx.aspecto) : ASPECTO_LIENZO;
  const svg = minimapaSectoresSvg({
    sectores: ctx.sectores ?? [],
    aspecto,
    ancho: 140,
    responsive: true,
    // Resalte por IDENTIDAD: el hijo activo va en naranja aunque la cadena de
    // sectores venga sin la marca `activo`.
    activoId: ctx.activoId ?? null,
  });
  if (!svg) return '';
  const ratio = 1 / aspecto;
  return bloqueHtml(
    ctx,
    svg,
    'minimapa-padre-marco',
    `aspect-ratio:${ratio.toFixed(3)} / 1`,
  );
}

/**
 * Resuelve el contexto del nivel padre a partir de la PILA de la cascada.
 *
 * @param activo   Nodo activo (tope de la pila). `null` = nivel raíz.
 * @param superior Nodo del nivel anterior (padre). `null` = la planta.
 * @param aspecto  Relación alto/ancho del lienzo visible.
 */
export async function resolverMinimapaPadre(
  activo: NodoPortal | null,
  superior: NodoPortal | null,
  aspecto: number,
): Promise<ContextoMinimapaPadre | null> {
  // ── NIVEL 2 · PLANTA: el padre es la CASA (gráfico a dos aguas). ───────────
  if (!activo) {
    const planta = estadoPortales.planta;
    if (!planta?.fila) return null; // Nivel 1 (Casa raíz): no tiene padre.
    return {
      tipo: 'casa',
      nombre: 'Casa',
      filaActiva: planta.fila,
      totalPlantas: planta.total,
    };
  }

  // ── NIVEL 3 · HABITACIÓN: el padre es la PLANTA. ──────────────────────────
  if (activo.tipo === 'habitacion') {
    let layout: ItemGeometria[] = estadoPortales.planta?.hermanas ?? [];
    if (!layout.length) {
      // Prop ausente en la cascada → se resuelve el layout real de la planta.
      const plantaId = await plantaIdAncla();
      if (plantaId) layout = (await datosDeNivelPlanta(plantaId)).rooms;
    }
    return {
      tipo: 'planta',
      nombre: estadoPortales.planta?.nombre || 'Planta',
      sectores: sectoresDeItems(layout, activo.id),
      activoId: activo.id,
      aspecto,
    };
  }

  // ── NIVEL 4/5 · CONTENEDOR: el padre es la HABITACIÓN o el MUEBLE. ────────
  if (!superior) return null;
  let layout: ItemGeometria[] = superior.hijos ?? [];
  if (!layout.length) {
    // Prop ausente en la cascada → se resuelve el layout real del padre:
    //   · padre HABITACIÓN → sus contenedores raíz (muebles/espacios).
    //   · padre CONTENEDOR → su interior jerárquico (estantes/cajas).
    layout =
      superior.tipo === 'habitacion'
        ? geometriaDe(await contenedoresRaizDeUbicacion(superior.id))
        : (await cargarInteriorDeNodo(superior)).geometriaHijos;
  }
  return {
    tipo: superior.tipo === 'habitacion' ? 'habitacion' : 'mueble',
    nombre: superior.nombre,
    sectores: sectoresDeItems(layout, activo.id),
    activoId: activo.id,
    aspecto,
  };
}

// -----------------------------------------------------------------------------
// MONTAJE EN PANTALLA (host `#minimapaPadreContexto`)
// -----------------------------------------------------------------------------

/** Token de la última pintura: descarta resoluciones asíncronas viejas. */
let tokenMinimapaPadre = 0;

/**
 * Pinta el MINIMAPA GRÁFICO PADRE en el host `#minimapaPadreContexto`
 * (zona superior del cuadrante izquierdo): la silueta del nivel ANTERIOR con el
 * piso/cuarto/mueble activo relleno en NARANJA (#f97316).
 *
 * Se redispara en CADA transición de nivel. No borra el título ni los nombres:
 * el minimapa convive con la cabecera del nivel actual y con su plano.
 */
export async function pintarMinimapaPadreContexto(): Promise<void> {
  const host = el('minimapaPadreContexto');
  if (!host) return;
  const token = ++tokenMinimapaPadre;
  const activo = nodoActual();
  const superior = activo ? nodoPadre() : null;
  const ctx = await resolverMinimapaPadre(activo, superior, aspectoDelLienzo());
  if (token !== tokenMinimapaPadre) return;
  const html = minimapaPadreHtml(ctx);
  host.innerHTML = html;
  host.classList.toggle('hidden', html.trim().length === 0);
}
