// =============================================================================
// LIENZO ELÁSTICO DEL INTERIOR (Panel Derecho recursivo) · RENDER PURO
// -----------------------------------------------------------------------------
// MUERTE AL MODO LISTA DE TEXTO: al descender de nivel el Panel Derecho ya no
// muestra una lista vaga del tipo «📦 Espacio 1 → 📦 Espacio 2 →», sino EL MISMO
// MAPA ELÁSTICO del interior activo, dibujado a ESCALA AMPLIADA y a pantalla
// completa del panel, con el NOMBRE y el ICONO de cada sub-espacio estampados
// directamente sobre su silueta geométrica real (`ui_left`/`ui_top`/`ui_width`/
// `ui_height` → lib/sectoresMinimapa.ts → lib/minimapa.ts). Experiencia 100%
// visual, también en el responsive móvil (el lienzo se amolda al ancho real).
//
// Cada silueta es, a la vez:
//   · PORTAL (`data-portal-abrir`)   → al tocarla, el sub-espacio pasa al Panel
//     Izquierdo y abre su propio nivel (recursión sin límite de profundidad).
//   · DROP ZONE (`data-portal-drop`) → al soltar un bulto de la canasta encima,
//     se guarda DENTRO de esa pieza («En Tránsito Interno» si tiene divisiones).
//
// Módulo PURO (devuelve string HTML, no toca el DOM ni hace fetch): el clic y el
// drop los conecta el orquestador por delegación en portalesEnlaces.ts.
// =============================================================================

import { escapeHtml } from '../../mapaJerarquico';
import { ASPECTO_LIENZO, minimapaSectoresSvg } from '../../minimapa';
import { sectoresDeItems } from '../../sectoresMinimapa';
import type { ItemGeometria } from '../../sectoresMinimapa';

/**
 * ESCALA AMPLIADA del lienzo del interior: el ancho `viewBox` máximo que admite
 * el motor (140) dibuja las siluetas —y por lo tanto sus rótulos— más grandes y
 * nítidas que cualquier miniatura de la cadena.
 */
export const ANCHO_LIENZO_INTERIOR = 140;

/** Pieza del interior, ya resuelta para el dibujo (sin dependencias de datos). */
export interface PiezaLienzo {
  /** UUID real (Contenedor) de la pieza. */
  id: string;
  /** Nombre real de la pieza (lo usan los avisos al soltar un bulto). */
  nombre: string;
  /** Texto rotulado sobre la silueta (nombre + contadores útiles del padrón). */
  etiqueta: string;
  /** Emoji de la taxonomía física (📦 caja, 🗄️ estantería, 🧱 monolito, …). */
  icono: string;
  /** Geometría real de la pieza dentro del lienzo del padre (puede faltar). */
  geometria: ItemGeometria | null;
  /** Tiene sub-divisiones propias (define el «En Tránsito Interno» del Drop). */
  conDivisiones: boolean;
}

/** Geometría mínima que consume el motor de sectores, con la etiqueta rotulada. */
function itemsDelLienzo(piezas: PiezaLienzo[]): ItemGeometria[] {
  return piezas.map((p) => ({
    id: p.id,
    nombre: p.etiqueta,
    ui_left: p.geometria?.ui_left ?? null,
    ui_top: p.geometria?.ui_top ?? null,
    ui_width: p.geometria?.ui_width ?? null,
    ui_height: p.geometria?.ui_height ?? null,
    fusion_grupo: p.geometria?.fusion_grupo ?? null,
  }));
}

/** Estado vacío del interior (nunca un panel mudo). */
export function estadoVacioInteriorHtml(nombrePadre: string): string {
  return `<div class="portal-vacio">
      <span class="portal-vacio-ico" aria-hidden="true">🧺</span>
      <p class="portal-vacio-texto">«${escapeHtml(nombrePadre)}» todavía no tiene sub-contenedores. Fundá un estante en la grilla de la izquierda o soltá una caja desde la canasta para que aparezca acá.</p>
    </div>`;
}

/**
 * LIENZO ELÁSTICO DEL INTERIOR: dibuja los sub-espacios del nodo activo sobre su
 * geometría real, rotulados con icono + nombre, clicables (portal) y listos para
 * recibir un Drop de la canasta. Si no hay geometría que dibujar cae al estado
 * vacío explicativo.
 */
export function lienzoInteriorHtml(
  piezas: PiezaLienzo[],
  aspecto: number,
  nombrePadre: string,
): string {
  if (!piezas.length) return estadoVacioInteriorHtml(nombrePadre);
  const porId = new Map<string, PiezaLienzo>(piezas.map((p) => [p.id, p]));
  const sectores = sectoresDeItems(
    itemsDelLienzo(piezas),
    null,
    (item) => porId.get(String(item.id ?? ''))?.icono ?? null,
  );
  const svg = minimapaSectoresSvg({
    sectores,
    aspecto,
    ancho: ANCHO_LIENZO_INTERIOR,
    responsive: true,
    clicable: true,
    // Rótulos de lectura (icono + nombre) encima de CADA silueta real.
    etiquetas: true,
    // Atributos de la silueta navegable: portal + zona de suelta + metadatos.
    atributosSector: (sector) => {
      const pieza = porId.get(sector.id);
      // El nombre viaja LIMPIO (sin los contadores de la etiqueta) para los avisos.
      const nombre = pieza?.nombre ?? sector.nombre;
      return [
        `data-portal-abrir="${escapeHtml(sector.id)}"`,
        'data-portal-tipo="contenedor"',
        `data-portal-nombre="${escapeHtml(nombre)}"`,
        `data-portal-drop="${escapeHtml(sector.id)}"`,
        `data-portal-divisiones="${pieza?.conDivisiones ? '1' : '0'}"`,
      ].join(' ');
    },
  });
  if (!svg) return estadoVacioInteriorHtml(nombrePadre);
  // El marco impone el MISMO aspecto del `viewBox`: el SVG lo llena al 100% y las
  // etiquetas caen clavadas sobre su silueta (sin letterboxing ni desalineación).
  const ratio = 1 / (aspecto > 0 ? aspecto : ASPECTO_LIENZO);
  return `<div class="portal-lienzo-interior" data-portal-lienzo="${escapeHtml(nombrePadre)}">
      <p class="portal-lienzo-tip">🗺️ <strong>Plano elástico del interior</strong>: tocá una silueta para bajar de nivel y soltá un bulto de la canasta encima para guardarlo adentro.</p>
      <div class="portal-lienzo-marco" style="aspect-ratio:${ratio.toFixed(3)} / 1">${svg}</div>
    </div>`;
}
