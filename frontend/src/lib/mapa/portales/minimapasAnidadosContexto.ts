// =============================================================================
// TIRA DE MINIMAPAS DE LOS NIVELES SUPERIORES · /almacenamiento
// -----------------------------------------------------------------------------
// Dibuja, en la cima del cuadrante izquierdo, la TIRA HORIZONTAL COMPACTA de
// minimapas acumulados de los niveles POR LOS QUE YA PASÓ el operador:
//
//   Casa → (Planta con la habitación en naranja) → (Habitación con el mueble en
//   naranja) → … es decir, un mini-thumbnail por cada nivel anterior.
//
// REGLAS DURAS:
//   · MOTOR ÚNICO: no se dibuja nada acá. El HTML lo emite el módulo puro
//     lib/minimapasAnidados.ts → renderMinimapasAnidados, que delega el SVG en
//     lib/minimapa.ts (minimapaSectoresSvg / minimapaCasitaSvg). Cero geometría
//     ni estilos de dibujo duplicados.
//   · GEOMETRÍA REAL: cada miniatura es el plano del padre con el hijo de la
//     ruta relleno en NARANJA (#f97316), con la MISMA física `ui_left/ui_top/
//     ui_width/ui_height` (→ lib/sectoresMinimapa.ts → sectoresDeItems) del
//     lienzo grande. Si la cascada no trajo ese layout, se resuelve por API
//     (misma caché de portales) antes de rendir: el minimapa nunca queda en blanco.
//   · BREADCRUMB NAVEGABLE: cada miniatura viaja con `nivel` = profundidad de la
//     pila a la que vuelve un toque (portalesEnlaces.ts resuelve el clic).
//   · El nivel ACTUAL no se repite en la tira: su mapa es el lienzo grande del
//     cuadrante izquierdo. La tira sólo acumula los niveles ANTERIORES.
//
// Módulo de render PURO + resolución de datos cacheada; no toca el DOM salvo en
// `pintarMinimapasNiveles`, dueña exclusiva del host `#minimapasAnidados`.
// =============================================================================

import { ASPECTO_LIENZO } from '../../minimapa';
import { renderMinimapasAnidados } from '../../minimapasAnidados';
import type { NodoRuta } from '../../minimapasAnidados';
import { sectoresDeItems } from '../../sectoresMinimapa';
import type { ItemGeometria } from '../../sectoresMinimapa';
import { estadoPortales } from './estadoPortales';
import { aspectoDelLienzo, el } from './domPortales';
import { cargarInteriorDeNodo, datosDeNivelPlanta } from './datosNodosPortales';
import { plantaIdAncla } from './nivelRaizPortales';

/** Host ÚNICO de la tira (declarado por components/MinimapaRuta.astro). */
export const HOST_MINIMAPAS_NIVELES = 'minimapasAnidados';

/** Aspecto elástico acotado al rango real del lienzo en pantalla. */
function aspectoValido(aspecto: number): number {
  return Math.max(0.35, Math.min(1.8, Number(aspecto) || ASPECTO_LIENZO));
}

/**
 * Habitaciones REALES de la planta activa. La cascada ya las trae en
 * `estadoPortales.planta.hermanas`; si el prop llegara vacío se resuelven desde
 * la API con el MISMO resolvedor del nivel raíz (nunca un cajón inventado).
 */
async function habitacionesDeLaPlanta(): Promise<ItemGeometria[]> {
  const hermanas = estadoPortales.planta?.hermanas ?? [];
  if (hermanas.length) return hermanas;
  const plantaId = await plantaIdAncla();
  if (!plantaId) return [];
  return (await datosDeNivelPlanta(plantaId)).rooms;
}

/**
 * Resuelve la TIRA de niveles superiores como `NodoRuta[]` (formato canónico de
 * `renderMinimapasAnidados`).
 *
 * Profundidad D de la cascada → D miniaturas (una por nivel ANTERIOR):
 *   0 · Nivel raíz  → casita con el piso activo en naranja (vuelve a la raíz),
 *                     rotulada con el NOMBRE REAL de la planta activa.
 *   1 · Planta      → plano de habitaciones con la habitación elegida en naranja.
 *   k · ruta[k-1]   → plano del padre (ruta[k-2]) con ruta[k-1] en naranja.
 *
 * Devuelve [] en la raíz (no hay niveles superiores que acumular) o sin planta.
 */
export async function resolverMinimapasNiveles(aspecto: number): Promise<NodoRuta[]> {
  const ruta = [...estadoPortales.ruta];
  const planta = estadoPortales.planta;
  if (!planta || !ruta.length) return [];

  const aspectoFinal = aspectoValido(aspecto);
  const total = Math.max(1, Math.floor(Number(planta.total) || 1));
  const nodos: NodoRuta[] = [];

  // ── NIVEL 0 · CASA: silueta a dos aguas con el PISO ACTIVO en naranja. ──────
  // ETIQUETA DINÁMICA DEL NIVEL: la miniatura se rotula con el NOMBRE REAL del
  // nivel desde el que se descendió («Planta Alta», «Planta Baja», …) y no con el
  // genérico «Casa», para que la tira se lea como la ruta verdadera
  // (Planta Alta → Habitación Frente → …). Sin nombre de planta cae a «Casa».
  const nombreNivel0 = String(planta.nombre ?? '').trim() || 'Casa';
  nodos.push({
    tipo: 'estok',
    nombre: nombreNivel0,
    filaActiva: planta.fila,
    totalPlantas: total,
    // Planta única: perímetro continuo sin tejado (misma regla que el lienzo).
    sinTecho: total <= 1,
    nivel: 0,
  });

  // ── NIVELES 1..D-1 · un plano del padre con el hijo de la ruta en naranja. ──
  // Con D = 1 la tira es sólo la Casita: no hace falta resolver habitaciones.
  const habitaciones = ruta.length > 1 ? await habitacionesDeLaPlanta() : [];
  for (let k = 1; k <= ruta.length - 1; k++) {
    const nivel = ruta[k - 1];
    const padre = k === 1 ? null : ruta[k - 2];

    let layout: ItemGeometria[];
    if (padre) {
      layout = padre.hijos ?? [];
      if (!layout.length) layout = (await cargarInteriorDeNodo(padre)).geometriaHijos;
    } else {
      layout = habitaciones;
    }

    nodos.push({
      tipo: nivel.tipo === 'habitacion' ? 'habitacion' : 'mueble',
      nombre: nivel.nombre,
      sectores: sectoresDeItems(
        layout,
        nivel.id,
        undefined,
        padre ? {} : { excluirSinGeometria: true },
      ),
      aspecto: aspectoFinal,
      nivel: k,
    });
  }

  return nodos;
}

/** Token de la última pintura: descarta resoluciones asíncronas viejas. */
let tokenNiveles = 0;

/**
 * Pinta la TIRA en el host `#minimapasAnidados` con el ÚNICO motor de la app.
 * Se redispara en cada transición de nivel; oculta la tira en la raíz.
 */
export async function pintarMinimapasNiveles(): Promise<void> {
  const host = el(HOST_MINIMAPAS_NIVELES);
  if (!host) return;
  const token = ++tokenNiveles;
  const nodos = await resolverMinimapasNiveles(aspectoDelLienzo());
  if (token !== tokenNiveles) return;
  // `todosActivos`: la ruta completa se lee de un vistazo (ningún nivel atenuado)
  // y el sector del hijo se conserva en NARANJA dentro de cada miniatura.
  const html = nodos.length ? renderMinimapasAnidados(nodos, { todosActivos: true }) : '';
  host.innerHTML = html;
  host.classList.toggle('hidden', html.trim().length === 0);
}
