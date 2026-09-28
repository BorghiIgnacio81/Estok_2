// =============================================================================
// SILUETA CONTINUA DEL ESPACIO FUSIONADO - bordes internos según ADYACENCIA
// -----------------------------------------------------------------------------
// Un espacio fusionado (`fusion_grupo`) es la UNIÓN de sus celdas hermanas: el
// bloque debe leerse como UNA sola superficie homogénea, sin ninguna línea
// divisoria interna entre las celdas que lo conforman.
//
// Este módulo es 100% puro (sin DOM, sin estado) y resuelve la evaluación de
// vecindad que necesita el render de la grilla interactiva:
//   - Borde INFERIOR (`border-b-0`): hay una hermana del mismo espacio
//     fusionado exactamente en la fila de abajo → se fusiona la arista.
//   - Borde SUPERIOR (`border-t-0`): hay una hermana arriba → se fusiona.
//   - Borde DERECHO  (`border-r-0`): hay una hermana a la derecha → se fusiona.
//   - Borde IZQUIERDO(`border-l-0`): hay una hermana a la izquierda → se fusiona.
//
// CÓMO SE APLICA EN EL PLANO: los bloques fusionados se dibujan en UN único SVG
// (no hay celdas HTML a las que colgar clases de borde de Tailwind), por lo que
// el equivalente exacto de `border-*-0` es doble:
//   1) las aristas compartidas por hermanas se funden en la MISMA coordenada
//      (más el solapamiento mínimo que absorbe el redondeo de ui_*), y
//   2) la superficie se emite como UNA sola forma (`<path>` con un subcamino
//      rectangular por celda), así el rasterizador rellena la unión en una
//      única pasada: sin costuras de antialias, sin huecos sub-pixel, sin
//      doble alpha en los solapes y sin ninguna línea de ningún grosor.
//
// Todas las medidas son % del bounding box del bloque (0..100), igual que el
// espacio de usuario del SVG del grupo.
// =============================================================================

/** Caja relativa de una celda dentro del bounding box del bloque (0..100 %). */
export interface CajaBloque {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Celda del bloque con sus cuatro aristas internas ya evaluadas por vecindad. */
export interface CeldaBloque extends CajaBloque {
  /** Hermana pegada arriba (borde superior removido: `border-t-0`). */
  hermanaArriba: boolean;
  /** Hermana pegada abajo (borde inferior removido: `border-b-0`). */
  hermanaAbajo: boolean;
  /** Hermana pegada a la izquierda (borde izquierdo removido: `border-l-0`). */
  hermanaIzquierda: boolean;
  /** Hermana pegada a la derecha (borde derecho removido: `border-r-0`). */
  hermanaDerecha: boolean;
}

/**
 * Tolerancia (en % del bloque) para considerar dos celdas ENCASTADAS.
 *
 * Absorbe el redondeo a 2 decimales de ui_left/ui_top/ui_width/ui_height y las
 * costuras sub-pixel que delatan las líneas divisorias internas, pero es lo
 * bastante chica como para NO puentear separaciones deliberadas entre celdas.
 */
export const TOL_ADYACENCIA = 1;

/** Lado mínimo resultante de una fusión de aristas (nunca colapsa una celda). */
const LADO_MINIMO_BLOQUE = 0.01;

/** true si dos rangos [inicio, fin] se solapan realmente (contacto > 0). */
function solapan(inicioA: number, finA: number, inicioB: number, finB: number): boolean {
  return Math.min(finA, finB) - Math.max(inicioA, inicioB) > 0;
}

/**
 * Funde los bordes internos de las celdas hermanas de un mismo espacio
 * fusionado: cuando dos celdas son vecinas (se solapan en el eje perpendicular y
 * sus aristas enfrentadas coinciden dentro de la tolerancia), ambas aristas se
 * llevan a la MISMA coordenada y se marcan los cuatro flags de adyacencia.
 *
 * Devuelve celdas nuevas (no muta la entrada) en el mismo orden de entrada.
 */
export function unirCeldasAdyacentes(
  cajas: readonly CajaBloque[],
  tolerancia = TOL_ADYACENCIA,
): CeldaBloque[] {
  const celdas: CeldaBloque[] = cajas.map((caja) => ({
    left: caja.left,
    top: caja.top,
    width: caja.width,
    height: caja.height,
    hermanaArriba: false,
    hermanaAbajo: false,
    hermanaIzquierda: false,
    hermanaDerecha: false,
  }));

  for (let i = 0; i < celdas.length; i++) {
    for (let j = 0; j < celdas.length; j++) {
      if (i === j) continue;
      const actual = celdas[i];
      const hermana = celdas[j];

      // --- Vecindad VERTICAL: la hermana está en la fila de abajo ------------
      if (
        solapan(actual.left, actual.left + actual.width, hermana.left, hermana.left + hermana.width) &&
        Math.abs(hermana.top - (actual.top + actual.height)) <= tolerancia
      ) {
        const arista = (actual.top + actual.height + hermana.top) / 2;
        hermana.height = Math.max(LADO_MINIMO_BLOQUE, hermana.top + hermana.height - arista);
        hermana.top = arista;
        actual.height = Math.max(LADO_MINIMO_BLOQUE, arista - actual.top);
        actual.hermanaAbajo = true;
        hermana.hermanaArriba = true;
      }

      // --- Vecindad HORIZONTAL: la hermana está a la derecha -----------------
      if (
        solapan(actual.top, actual.top + actual.height, hermana.top, hermana.top + hermana.height) &&
        Math.abs(hermana.left - (actual.left + actual.width)) <= tolerancia
      ) {
        const arista = (actual.left + actual.width + hermana.left) / 2;
        hermana.width = Math.max(LADO_MINIMO_BLOQUE, hermana.left + hermana.width - arista);
        hermana.left = arista;
        actual.width = Math.max(LADO_MINIMO_BLOQUE, arista - actual.left);
        actual.hermanaDerecha = true;
        hermana.hermanaIzquierda = true;
      }
    }
  }

  return celdas;
}

/** Token numérico del path SVG (2 decimales, mismo redondeo que ui_*). */
function token(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Silueta CONTINUA del bloque: UN solo `<path>` con un subcamino rectangular por
 * celda. Al ser UNA única forma rellenable, las aristas compartidas entre
 * celdas hermanas dejan de ser fronteras (no hay borde que pintar): el fondo
 * queda homogéneo de extremo a extremo.
 */
export function siluetaContinua(celdas: readonly CajaBloque[]): string {
  return celdas
    .map(
      (c) =>
        `M${token(c.left)} ${token(c.top)}h${token(c.width)}v${token(c.height)}h${token(-c.width)}Z`,
    )
    .join('');
}
