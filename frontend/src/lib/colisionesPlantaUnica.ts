// =============================================================================
// PLANTA ÚNICA - GEOMETRÍA COMPUTACIONAL (puro, sin DOM ni red)
// -----------------------------------------------------------------------------
// Motor de FÍSICA DE COLISIONES (AABB - Axis-Aligned Bounding Box) y de
// AJUSTE MAGNÉTICO INTELIGENTE (auto-snapping a huecos libres entre dos
// habitaciones ya consolidadas) para el lienzo del Modo Planta Única.
//
// Todas las medidas están expresadas en PORCENTAJE (0..100) del contenedor del
// departamento, que es la unidad de persistencia real (ui_left/ui_top/
// ui_width/ui_height) enviada a PostgreSQL.
// =============================================================================

export interface Caja {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ResultadoAjuste {
  caja: Caja;
  /** true si el auto-ajuste ESTIRÓ el ancho para encajar exacto en el hueco. */
  ajustoAncho: boolean;
  /** true si el auto-ajuste ESTIRÓ el alto para encajar exacto en el hueco. */
  ajustoAlto: boolean;
  huecoHorizontal: boolean;
  huecoVertical: boolean;
}

/** Lado mínimo de un espacio (en % del lienzo). */
export const LADO_MIN = 8;

/** Tolerancia (en %) por debajo de la cual dos cajas deben considerarse pegadas. */
const TOL_COLISION = 0.75;

function acotar(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Detección de solapamiento AABB (Axis-Aligned Bounding Box).
 * `tolerancia` (en %) absorbe el contacto borde-con-borde para que dos cajas
 * EXACTAMENTE pegadas no se consideren superpuestas.
 */
export function cajasSolapan(a: Caja, b: Caja, tolerancia = TOL_COLISION): boolean {
  return (
    a.left < b.left + b.width - tolerancia &&
    a.left + a.width - tolerancia > b.left &&
    a.top < b.top + b.height - tolerancia &&
    a.top + a.height - tolerancia > b.top
  );
}

/** true si la caja candidata pisa alguna de las cajas ocupadas. */
export function colisionaConAlguna(cand: Caja, ocupados: Caja[], tolerancia = TOL_COLISION): boolean {
  for (const caja of ocupados) {
    if (cajasSolapan(cand, caja, tolerancia)) return true;
  }
  return false;
}

/** Recorta una caja al lienzo 0..100 manteniendo el lado mínimo. */
export function acotarAlLienzo(caja: Caja): Caja {
  const width = acotar(caja.width, LADO_MIN, 100);
  const height = acotar(caja.height, LADO_MIN, 100);
  return {
    width,
    height,
    left: acotar(caja.left, 0, 100 - width),
    top: acotar(caja.top, 0, 100 - height),
  };
}

/**
 * Tolerancias DINÁMICAS: proporcionales al tamaño del elemento arrastrado, de
 * modo que un espacio chico exija precisión fina y uno grande sea más tolerante.
 */
export function toleranciasDinamicas(caja: Caja): { x: number; y: number; tamano: number } {
  return {
    x: acotar(caja.width * 0.18, 2.5, 6),
    y: acotar(caja.height * 0.18, 2.5, 6),
    tamano: acotar(Math.min(caja.width, caja.height) * 0.3, 5, 12),
  };
}

/** Vecinos que se solapan verticalmente (candidatos a formar un hueco horizontal). */
function vecinosVerticales(cand: Caja, ocupados: Caja[]): Caja[] {
  return ocupados.filter(
    (o) => o.top < cand.top + cand.height - 0.5 && o.top + o.height > cand.top + 0.5,
  );
}

/** Vecinos que se solapan horizontalmente (candidatos a un hueco vertical). */
function vecinosHorizontales(cand: Caja, ocupados: Caja[]): Caja[] {
  return ocupados.filter(
    (o) => o.left < cand.left + cand.width - 0.5 && o.left + o.width > cand.left + 0.5,
  );
}

/**
 * AJUSTE MAGNÉTICO INTELIGENTE.
 *
 * Si la caja entrante cae dentro de un hueco libre flanqueado por DOS vecinos
 * (izquierda + derecha, o arriba + abajo) y su tamaño es "casi" el del hueco,
 * la posición y el lado correspondiente se corrigen para encajar EXACTO.
 *
 * Devuelve la caja corregida junto con las banderas de lo que se ajustó, para
 * que el llamador lo persista en el PUT hacia el backend.
 */
export function ajustarAHuecos(cand: Caja, ocupados: Caja[]): ResultadoAjuste {
  const base = acotarAlLienzo(cand);
  let { left, top, width, height } = base;
  const tol = toleranciasDinamicas(base);
  let ajustoAncho = false;
  let ajustoAlto = false;
  let huecoHorizontal = false;
  let huecoVertical = false;

  // ---------------- Hueco HORIZONTAL (entre dos vecinos lado a lado) ---------
  const vy = vecinosVerticales(base, ocupados);
  if (vy.length >= 2) {
    const centroX = left + width / 2;
    let bordeIzq = 0;
    let bordeDer = 100;
    let hayIzq = false;
    let hayDer = false;
    for (const o of vy) {
      const cx = o.left + o.width / 2;
      if (cx < centroX) {
        bordeIzq = Math.max(bordeIzq, o.left + o.width);
        hayIzq = true;
      } else {
        bordeDer = Math.min(bordeDer, o.left);
        hayDer = true;
      }
    }
    const hueco = bordeDer - bordeIzq;
    if (hayIzq && hayDer && hueco >= LADO_MIN) {
      const pegado = Math.abs(left - bordeIzq) <= tol.x && Math.abs(left + width - bordeDer) <= tol.x;
      const tamanoSimilar = Math.abs(width - hueco) <= tol.tamano;
      if (pegado && tamanoSimilar) {
        left = bordeIzq;
        width = hueco;
        ajustoAncho = true;
        huecoHorizontal = true;
      }
    }
  }

  // ---------------- Hueco VERTICAL (entre dos vecinos apilados) --------------
  const vx = vecinosHorizontales(base, ocupados);
  if (vx.length >= 2) {
    const centroY = top + height / 2;
    let bordeSup = 0;
    let bordeInf = 100;
    let hayArriba = false;
    let hayAbajo = false;
    for (const o of vx) {
      const cy = o.top + o.height / 2;
      if (cy < centroY) {
        bordeSup = Math.max(bordeSup, o.top + o.height);
        hayArriba = true;
      } else {
        bordeInf = Math.min(bordeInf, o.top);
        hayAbajo = true;
      }
    }
    const hueco = bordeInf - bordeSup;
    if (hayArriba && hayAbajo && hueco >= LADO_MIN) {
      const pegado = Math.abs(top - bordeSup) <= tol.y && Math.abs(top + height - bordeInf) <= tol.y;
      const tamanoSimilar = Math.abs(height - hueco) <= tol.tamano;
      if (pegado && tamanoSimilar) {
        top = bordeSup;
        height = hueco;
        ajustoAlto = true;
        huecoVertical = true;
      }
    }
  }

  return {
    caja: acotarAlLienzo({ left, top, width, height }),
    ajustoAncho,
    ajustoAlto,
    huecoHorizontal,
    huecoVertical,
  };
}
