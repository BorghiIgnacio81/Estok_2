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

/** Opciones del lienzo ampliado: es lo ÚNICO que cambia entre niveles. */
export interface OpcionesLienzo {
  /** Micro-texto de ayuda del nivel (siempre en español). */
  tip: string;
  /** Atributos `data-*` de cada silueta navegable (portal y/o zona de suelta). */
  atributosSector: (pieza: PiezaLienzo) => string;
  /** Id del sector que va resaltado en NARANJA (Ley 2: selección in-place). */
  activoId?: string | null;
}

/**
 * LIENZO ELÁSTICO AMPLIADO: motor ÚNICO del Panel Derecho a CUALQUIER nivel (el
 * interior recursivo de los contenedores y el nivel inicial de la Planta).
 *
 * Dibuja las siluetas sobre su geometría real en la escala máxima del motor
 * (`ANCHO_LIENZO_INTERIOR`), con el NOMBRE y el ICONO de cada pieza rotulados
 * ENCIMA de su polígono, clicables y con los atributos que el nivel necesite.
 * Sin piezas cae al estado vacío explicativo.
 */
export function lienzoAmpliadoHtml(
  piezas: PiezaLienzo[],
  aspecto: number,
  nombreNivel: string,
  opts: OpcionesLienzo,
): string {
  if (!piezas.length) return estadoVacioInteriorHtml(nombreNivel);
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
    // Resalte naranja del nodo seleccionado (por identidad, no por posición).
    activoId: opts.activoId ?? null,
    // Rótulos de lectura (icono + nombre) encima de CADA silueta real.
    etiquetas: true,
    // Atributos de la silueta navegable, resueltos por identidad de la pieza.
    atributosSector: (sector) => {
      const pieza = porId.get(sector.id);
      return pieza ? opts.atributosSector(pieza) : '';
    },
  });
  if (!svg) return estadoVacioInteriorHtml(nombreNivel);
  // El marco impone el MISMO aspecto del `viewBox`: el SVG lo llena al 100% y las
  // etiquetas caen clavadas sobre su silueta (sin letterboxing ni desalineación).
  const ratio = 1 / (aspecto > 0 ? aspecto : ASPECTO_LIENZO);
  return `<div class="portal-lienzo-interior" data-portal-lienzo="${escapeHtml(nombreNivel)}">
      <p class="portal-lienzo-tip">${opts.tip}</p>
      <div class="portal-lienzo-marco" style="aspect-ratio:${ratio.toFixed(3)} / 1">${svg}</div>
    </div>`;
}

/** Micro-texto del interior jerárquico (idéntico al del Lote 11). */
const TIP_INTERIOR =
  '🗺️ <strong>Plano elástico del interior</strong>: tocá una silueta para bajar de nivel y soltá un bulto de la canasta encima para guardarlo adentro.';

/**
 * LIENZO ELÁSTICO DEL INTERIOR: wrapper del motor para los sub-espacios del nodo
 * activo. Cada silueta es PORTAL (`data-portal-abrir`) y DROP ZONE
 * (`data-portal-drop`, con «En Tránsito Interno» si la pieza tiene divisiones
 * internas y no se eligió estante fino).
 */
export function lienzoInteriorHtml(
  piezas: PiezaLienzo[],
  aspecto: number,
  nombrePadre: string,
): string {
  return lienzoAmpliadoHtml(piezas, aspecto, nombrePadre, {
    tip: TIP_INTERIOR,
    atributosSector: (pieza) => [
      `data-portal-abrir="${escapeHtml(pieza.id)}"`,
      'data-portal-tipo="contenedor"',
      // El nombre viaja LIMPIO (sin los contadores de la etiqueta) para los avisos.
      `data-portal-nombre="${escapeHtml(pieza.nombre)}"`,
      `data-portal-drop="${escapeHtml(pieza.id)}"`,
      `data-portal-divisiones="${pieza.conDivisiones ? '1' : '0'}"`,
    ].join(' '),
  });
}
