// =============================================================================
// PLANO VECTORIAL DE LAS SUBDIVISIONES DEL ESPACIO ACTIVO (cuadrante izquierdo)
// -----------------------------------------------------------------------------
// Al ingresar a un mueble/espacio que posee subdivisiones internas (ej. las 4
// subdivisiones de «Armario Espejo») el cuadrante izquierdo dibuja el PLANO 2D de
// ESE espacio: UNA silueta vectorial por cada subdivisión real del padrón, con su
// nombre e icono, sobre su geometría `ui_left/ui_top/ui_width/ui_height` real.
//
// Cada silueta es, a la vez:
//   · DROPZONE (`data-drop-contenedor`) → recibe el objeto/caja arrastrado desde
//     el panel derecho (o desde la canasta) y lo guarda DENTRO de esa
//     subdivisión (lib/mapa/portales/dropZonasAncla.ts →
//     transitoInterno.guardarEnContenedor). El `data-drop-divisiones` reproduce
//     la MISMA regla jerárquica del Drop sobre tarjetas.
//   · PORTAL (`data-portal-abrir`) → al tocarla se ingresa a su interior
//     (descenso N+1 resuelto por portalesEnlaces.ts con el ID REAL de la pieza).
//
// NO dibuja CAJAS: una caja es CONTENIDO del inventario, nunca una subdivisión
// arquitectónica del espacio (misma regla que el lienzo de la habitación).
//
// Módulo de RENDER + pintura del host `#planoSubdivisionesPanel`; no hace fetch ni
// duplica geometría: la resuelve el motor único `sectoresDeItems`/`minimapa.ts`
// a través de `lienzoAmpliadoHtml` (lib/mapa/portales/lienzoHijos.ts).
// =============================================================================

import { escapeHtml } from '../../escapeHtml';
import { iconoDeEspacio } from '../../iconosFisicos';
import { esCajaDeInventario } from '../../taxonomiaContenedor';
import type { ItemGeometria } from '../../sectoresMinimapa';
import { aspectoDelLienzo, el } from './domPortales';
import type { InteriorNodo } from './datosNodosPortales';
import type { NodoPortal } from './estadoPortales';
import { lienzoAmpliadoHtml } from './lienzoHijos';
import type { PiezaLienzo } from './lienzoHijos';
import { HOSTS } from './panelesPortales';

/**
 * Atributos `data-*` de CADA subdivisión dibujada en el plano izquierdo:
 * portal de descenso + zona de suelta. Todo valor va escapado (viene de la base).
 */
function atributosDeSubdivision(pieza: PiezaLienzo): string {
  return [
    `data-portal-abrir="${escapeHtml(pieza.id)}"`,
    'data-portal-tipo="contenedor"',
    `data-portal-nombre="${escapeHtml(pieza.nombre)}"`,
    // DROP INTER-CUADRANTES (derecha → izquierda): la silueta recibe el bulto y lo
    // guarda DENTRO de esta subdivisión (misma física que el Drop sobre tarjetas).
    `data-drop-contenedor="${escapeHtml(pieza.id)}"`,
    `data-drop-nombre="${escapeHtml(pieza.nombre)}"`,
    `data-drop-divisiones="${pieza.conDivisiones ? '1' : '0'}"`,
    'tabindex="0"',
  ].join(' ');
}

/**
 * ¿La pieza es una CAJA del inventario? Se resuelve con el TIPO FÍSICO real del
 * contenedor (nunca con `NodoPortal.tipo`, que es la naturaleza del NODO:
 * 'planta' | 'habitacion' | 'contenedor'). Misma regla que el lienzo del cuarto.
 */
function esCajaDeLaPieza(pieza: {
  tipoFisico?: string | null;
  esInmueble?: boolean;
  nombre: string;
}): boolean {
  return esCajaDeInventario({
    tipo: pieza.tipoFisico ?? null,
    es_inmueble: pieza.esInmueble === true,
    nombre: pieza.nombre,
  });
}

/**
 * Convierte las piezas reales del interior del nodo activo en las siluetas que
 * dibuja el motor. Descarta cajas de inventario (contenido, no arquitectura) y
 * conserva la geometría persistida de cada pieza.
 */
function subdivisionesDibujables(interior: InteriorNodo | null): PiezaLienzo[] {
  if (!interior) return [];
  return interior.piezas
    .filter((pieza) => !esCajaDeLaPieza(pieza))
    .map((pieza) => {
      const geometria: ItemGeometria = {
        id: pieza.id,
        nombre: pieza.nombre,
        ui_left: null,
        ui_top: null,
        ui_width: null,
        ui_height: null,
        fusion_grupo: null,
      };
      const real = interior.geometriaHijos.find((g) => String(g.id) === String(pieza.id));
      return {
        id: String(pieza.id),
        nombre: pieza.nombre,
        etiqueta: pieza.nombre,
        icono: iconoDeEspacio(pieza.nombre),
        geometria: real ?? geometria,
        conDivisiones: Boolean(pieza.conDivisiones),
      };
    });
}

/**
 * Nombre legible del nivel para el encabezado del plano («4 subdivisiones»).
 * Singular/plural explícitos: el operador lee la cantidad REAL del padrón.
 */
function cuentaLegible(total: number): string {
  return total === 1 ? '1 subdivisión' : `${total} subdivisiones`;
}

/**
 * Pinta (o limpia) el PLANO IZQUIERDO de subdivisiones del espacio activo.
 *
 * Se invoca en CADA transición de nivel de la cascada. Sin subdivisiones
 * arquitectónicas (Espacio Final, hoja, habitación, raíz) el bloque se vacía y se
 * oculta: el cuadrante izquierdo conserva su comportamiento anterior.
 */
export function pintarPlanoSubdivisiones(
  nodo: NodoPortal | null,
  interior: InteriorNodo | null,
): void {
  const host = el(HOSTS.planoSubdivisiones);
  if (!host) return;
  // Sólo los CONTENEDORES exponen subdivisiones internas: una habitación dibuja
  // su plano en el editor del cuadrante derecho (no se duplica el mapa).
  const piezas = nodo && nodo.tipo === 'contenedor' ? subdivisionesDibujables(interior) : [];
  if (!piezas.length) {
    host.innerHTML = '';
    host.classList.add('hidden');
    return;
  }
  const nombre = String(nodo?.nombre ?? '').trim() || 'el espacio activo';
  const lienzo = lienzoAmpliadoHtml(piezas, aspectoDelLienzo(), nombre, {
    tip: `🧭 <strong>Plano de «${escapeHtml(nombre)}»</strong>: soltá un objeto sobre la subdivisión de destino o tocá su silueta para entrar a su interior.`,
    atributosSector: atributosDeSubdivision,
  });
  host.innerHTML = `<div class="portal-plano-subdivisiones" data-plano-subdivisiones="${escapeHtml(nodo?.id ?? '')}">
      <header class="portal-plano-subdivisiones-cab">
        <span class="portal-plano-subdivisiones-titulo">🧭 Plano de «${escapeHtml(nombre)}»</span>
        <span class="portal-plano-subdivisiones-meta">${cuentaLegible(piezas.length)}</span>
      </header>
      ${lienzo}
    </div>`;
  host.classList.remove('hidden');
}
