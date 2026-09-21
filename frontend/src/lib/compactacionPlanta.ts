// =============================================================================
// COMPACTACIÓN INTELIGENTE DEL PLANO 2D (geometría pura: sin DOM ni red)
// -----------------------------------------------------------------------------
// Motor que corre EXCLUSIVAMENTE cuando el usuario presiona «💾 Guardar» (o el
// «Continuar ➜» del plano del asistente de bienvenida):
//
//   1) SUPERPOSICIÓN REAL → si una pieza pisa drásticamente a otra, se la empuja
//      a la ZONA VACÍA MÁS CERCANA (vector mínimo de separación AABB y, si no
//      alcanza, barrido ordenado por distancia) ANTES del PUT a Django.
//   2) BRECHAS MÍNIMAS → los huecos residuales del arrastre (≤ BRECHA_PX medidos
//      en píxeles reales del lienzo) se absorben estirando SIMÉTRICAMENTE los
//      rectángulos hasta pegarlos entre sí o contra los muros perimetrales.
//   3) ESPACIOS VACÍOS GRANDES → intactos: los pasillos/patios deliberados se
//      respetan tal cual los dibujó el usuario (jamás se cierran).
//
// Una `Pieza` es la SILUETA REAL visible del espacio: 1 caja para un espacio
// común y N cajas (tiles) para un bloque fusionado. El bounding box de un bloque
// en «L» NUNCA se usa como cuerpo físico: la esquina vacía de la L queda libre y
// no bloquea a los ambientes vecinos ni impide absorber las brechas linderas.
// Todas las medidas están en % (0..100) del lienzo.
// =============================================================================

/** Caja elástica en % del lienzo (mismos tokens que ui_left/ui_top/ui_width/ui_height). */
export interface Caja {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Silueta real de un espacio: 1 caja suelta o N tiles de un bloque fusionado. */
export interface Pieza {
  id: string;
  cajas: Caja[];
}

/** Resultado de la compactación para una pieza (mismo orden que la entrada). */
export interface AjustePieza {
  id: string;
  cajas: Caja[];
  /** true si la pieza fue empujada a una zona vacía por superposición real. */
  reubicada: boolean;
  /** true si la pieza fue estirada para absorber una brecha mínima. */
  estirada: boolean;
}

/** Umbral de brecha por eje (los % de x e y no equivalen a los mismos px). */
export interface Brecha {
  x: number;
  y: number;
}

export interface OpcionesCompactacion {
  brecha: Brecha;
  /** Proporción de solape sobre la pieza menor que define «pisa drásticamente». */
  umbralSolape?: number;
}

export interface ResultadoCompactacion {
  piezas: AjustePieza[];
  /** Cantidad de brechas mínimas absorbidas (muros + pares de vecinos). */
  brechas: number;
  /** Cantidad de piezas empujadas a una zona vacía por superposición real. */
  reubicadas: number;
}

/** Lado mínimo de un espacio (en % del lienzo). */
export const LADO_MIN = 8;
/** Hueco residual máximo (px reales del lienzo) que se considera «brecha». */
export const BRECHA_PX = 20;
/** Piso y techo del umbral de brecha (en %) para lienzos gigantes o diminutos. */
const BRECHA_MIN = 1.6;
const BRECHA_MAX = 3.2;
/** Tolerancia de comparaciones geométricas (en %). */
const EPS = 0.05;
/** Solape sobre la pieza menor que define «pisa drásticamente» a otro espacio. */
const UMBRAL_SOLAPE = 0.5;

function acotar(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function dos(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Convierte el hueco residual tolerado (BRECHA_PX) a porcentaje del lienzo
 * MEDIDO EN VIVO, eje por eje: un lienzo de 880 px de ancho tolera 2.27% de x y
 * uno de 520 px de alto tolera 3.2% de y. Así la tolerancia física (px) es
 * idéntica en cualquier pantalla, en vez de crecer/encogerse con el layout.
 */
export function brechaEnPorcentaje(anchoPx: number, altoPx: number): Brecha {
  return {
    x: acotar((BRECHA_PX / Math.max(1, anchoPx)) * 100, BRECHA_MIN, BRECHA_MAX),
    y: acotar((BRECHA_PX / Math.max(1, altoPx)) * 100, BRECHA_MIN, BRECHA_MAX),
  };
}

/** Bounding box exacto de una silueta (se usa para MEDIR, nunca como cuerpo). */
export function bboxDe(cajas: Caja[]): Caja {
  const left = Math.min(...cajas.map((c) => c.left));
  const top = Math.min(...cajas.map((c) => c.top));
  const right = Math.max(...cajas.map((c) => c.left + c.width));
  const bottom = Math.max(...cajas.map((c) => c.top + c.height));
  return { left, top, width: Math.max(0.01, right - left), height: Math.max(0.01, bottom - top) };
}

// =============================================================================
// FASE 1 - SUPERPOSICIÓN REAL: empuje a la ZONA VACÍA MÁS CERCANA
// =============================================================================

function area(c: Caja): number {
  return Math.max(0, c.width) * Math.max(0, c.height);
}

/** Área de intersección AABB entre dos cajas (0 si no se tocan). */
function solape(a: Caja, b: Caja): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** true si alguna caja de A PISA DRÁSTICAMENTE a alguna caja de B. */
function invasiva(a: Caja[], b: Caja[], umbral: number): boolean {
  for (const x of a) {
    for (const y of b) {
      const s = solape(x, y);
      if (s <= 0) continue;
      const menor = Math.min(area(x), area(y));
      if (menor > 0 && s / menor >= umbral) return true;
    }
  }
  return false;
}

/** true si la silueta pisa drásticamente a alguna de las siluetas ocupadas. */
function invasivaConAlguna(cajas: Caja[], ocupadas: Caja[][], umbral: number): boolean {
  return ocupadas.some((o) => invasiva(cajas, o, umbral));
}

/** true si la silueta toca (cualquier roce real) a alguna silueta ocupada. */
function tocaAlguna(cajas: Caja[], ocupadas: Caja[][]): boolean {
  return ocupadas.some((o) => o.some((otra) => cajas.some((c) => solape(c, otra) > EPS * EPS)));
}

/** Siluetas de todas las piezas menos la indicada. */
function otrasSiluetas(piezas: AjustePieza[], excluida: AjustePieza): Caja[][] {
  return piezas.filter((p) => p !== excluida).map((p) => p.cajas);
}

function trasladar(cajas: Caja[], dL: number, dT: number): Caja[] {
  return cajas.map((c) => ({ ...c, left: c.left + dL, top: c.top + dT }));
}

function dentroDelLienzo(cajas: Caja[]): boolean {
  return cajas.every(
    (c) =>
      c.left >= -EPS &&
      c.top >= -EPS &&
      c.left + c.width <= 100 + EPS &&
      c.top + c.height <= 100 + EPS,
  );
}

function redondearCajas(cajas: Caja[]): Caja[] {
  return cajas.map((c) => ({
    left: dos(c.left),
    top: dos(c.top),
    width: dos(c.width),
    height: dos(c.height),
  }));
}

/** Encaja la silueta entre los muros 0..100 desplazándola (sin deformarla). */
function encajarEnLienzo(cajas: Caja[]): Caja[] {
  const b = bboxDe(cajas);
  let dL = 0;
  let dT = 0;
  if (b.left < -EPS) dL = -b.left;
  else if (b.left + b.width > 100 + EPS) dL = 100 - (b.left + b.width);
  if (b.top < -EPS) dT = -b.top;
  else if (b.top + b.height > 100 + EPS) dT = 100 - (b.top + b.height);
  return dL || dT ? trasladar(cajas, dL, dT) : cajas;
}

function modulo(dL: number, dT: number): number {
  return Math.sqrt(dL * dL + dT * dT);
}

/** Primer candidato de traslación que deja la pieza en una zona 100% libre. */
function probarCandidatos(
  candidatos: Array<[number, number]>,
  cajas: Caja[],
  fijas: Caja[][],
): Caja[] | null {
  candidatos.sort((a, b) => modulo(a[0], a[1]) - modulo(b[0], b[1]));
  for (const [dL, dT] of candidatos) {
    if (!dL && !dT) continue;
    const prueba = trasladar(cajas, dL, dT);
    if (!dentroDelLienzo(prueba)) continue;
    if (tocaAlguna(prueba, fijas)) continue;
    return redondearCajas(prueba);
  }
  return null;
}

/** Barrido del lienzo (paso de 2%) ordenado por distancia a la posición actual. */
function barridoZonaLibre(cajas: Caja[], fijas: Caja[][]): Caja[] | null {
  const b = bboxDe(cajas);
  const candidatos: Array<[number, number]> = [];
  for (let l = 0; l <= 100 - b.width + EPS; l += 2) {
    for (let t = 0; t <= 100 - b.height + EPS; t += 2) {
      candidatos.push([l - b.left, t - b.top]);
    }
  }
  return probarCandidatos(candidatos, cajas, fijas);
}

/**
 * Empuja la pieza invasora a la zona vacía más cercana:
 *  1) vectores mínimos de separación (arriba/abajo/izquierda/derecha) contra
 *     cada caja con la que se solapa, ordenados por distancia;
 *  2) si ninguno la deja limpia, barrido del lienzo por cercanía.
 */
function empujarAZonaLibre(cajas: Caja[], fijas: Caja[][]): Caja[] | null {
  const candidatos: Array<[number, number]> = [];
  for (const f of fijas) {
    for (const o of f) {
      for (const c of cajas) {
        if (solape(c, o) <= 0) continue;
        candidatos.push([o.left + o.width - c.left, 0]); // a la derecha del vecino
        candidatos.push([-(c.left + c.width - o.left), 0]); // a la izquierda
        candidatos.push([0, o.top + o.height - c.top]); // debajo
        candidatos.push([0, -(c.top + c.height - o.top)]); // encima
      }
    }
  }
  const directo = probarCandidatos(candidatos, cajas, fijas);
  if (directo) return directo;
  return barridoZonaLibre(cajas, fijas);
}

// =============================================================================
// FASE 2 - BRECHAS MÍNIMAS: absorción por estirado simétrico
// =============================================================================

type Lado = 'left' | 'right' | 'top' | 'bottom';

interface Proyeccion {
  pieza: AjustePieza;
  ini: number;
  transIni: number;
  transFin: number;
}

function proyectar(piezas: AjustePieza[], horizontal: boolean): Proyeccion[] {
  return piezas.map((pieza) => {
    const b = bboxDe(pieza.cajas);
    return horizontal
      ? { pieza, ini: b.left, transIni: b.top, transFin: b.top + b.height }
      : { pieza, ini: b.top, transIni: b.left, transFin: b.left + b.width };
  });
}

function inicioDe(pieza: AjustePieza, horizontal: boolean): number {
  const b = bboxDe(pieza.cajas);
  return horizontal ? b.left : b.top;
}

function finDe(pieza: AjustePieza, horizontal: boolean): number {
  const b = bboxDe(pieza.cajas);
  return horizontal ? b.left + b.width : b.top + b.height;
}

/** Filas (o columnas) lógicas: piezas que se solapan en el eje transversal. */
function bandas(proy: Proyeccion[]): Proyeccion[][] {
  const orden = proy.slice().sort((a, b) => a.transIni - b.transIni);
  const grupos: Proyeccion[][] = [];
  let actual: Proyeccion[] = [];
  let fin = Number.NEGATIVE_INFINITY;
  for (const p of orden) {
    if (actual.length && p.transIni < fin - EPS) {
      actual.push(p);
      fin = Math.max(fin, p.transFin);
    } else {
      if (actual.length) grupos.push(actual);
      actual = [p];
      fin = p.transFin;
    }
  }
  if (actual.length) grupos.push(actual);
  return grupos;
}

/** Expande la silueta `delta` % por el lado indicado moviendo SOLO su borde. */
function expandir(cajas: Caja[], lado: Lado, delta: number): Caja[] {
  if (delta <= 0) return cajas;
  const b = bboxDe(cajas);
  const right = b.left + b.width;
  const bottom = b.top + b.height;
  return cajas.map((c) => {
    if (lado === 'right' && Math.abs(c.left + c.width - right) <= EPS) {
      return { ...c, width: c.width + delta };
    }
    if (lado === 'left' && Math.abs(c.left - b.left) <= EPS) {
      return { ...c, left: c.left - delta, width: c.width + delta };
    }
    if (lado === 'bottom' && Math.abs(c.top + c.height - bottom) <= EPS) {
      return { ...c, height: c.height + delta };
    }
    if (lado === 'top' && Math.abs(c.top - b.top) <= EPS) {
      return { ...c, top: c.top - delta, height: c.height + delta };
    }
    return c;
  });
}

/**
 * Intenta absorber `delta` % estirando la pieza por `lado`. Devuelve el delta
 * REALMENTE absorbido (0 si el muro o un vecino lo impiden) y deja la silueta
 * ya estirada: el estirado JAMÁS pisa a otro espacio ni sale del lienzo.
 */
function intentarEstirar(
  pieza: AjustePieza,
  lado: Lado,
  delta: number,
  todas: AjustePieza[],
): number {
  let d = dos(delta);
  for (let intento = 0; intento < 3 && d > EPS; intento += 1, d = dos(d / 2)) {
    const nuevas = expandir(pieza.cajas, lado, d);
    if (!dentroDelLienzo(nuevas)) continue;
    if (tocaAlguna(nuevas, otrasSiluetas(todas, pieza))) continue;
    pieza.cajas = redondearCajas(nuevas);
    pieza.estirada = true;
    return d;
  }
  return 0;
}

/**
 * Absorción de brechas mínimas en un eje (horizontal = izquierda/derecha,
 * vertical = techo/piso): muro perimetral de arranque, pares de vecinos
 * consecutivos (mitad y mitad) y muro perimetral final. Los huecos mayores al
 * umbral quedan INTACTOS (pasillos y patios deliberados).
 */
function cerrarBrechas(piezas: AjustePieza[], horizontal: boolean, brecha: number): number {
  const ini: Lado = horizontal ? 'left' : 'top';
  const finLado: Lado = horizontal ? 'right' : 'bottom';
  let cerradas = 0;
  for (const banda of bandas(proyectar(piezas, horizontal))) {
    const orden = banda.slice().sort((a, b) => a.ini - b.ini);
    const primero = orden[0].pieza;
    const brechaInicial = dos(inicioDe(primero, horizontal));
    if (
      brechaInicial > EPS &&
      brechaInicial <= brecha &&
      intentarEstirar(primero, ini, brechaInicial, piezas)
    ) {
      cerradas += 1;
    }
    for (let i = 0; i < orden.length - 1; i += 1) {
      const a = orden[i].pieza;
      const b = orden[i + 1].pieza;
      const hueco = dos(inicioDe(b, horizontal) - finDe(a, horizontal));
      if (hueco <= EPS || hueco > brecha) continue;
      const mitad = dos(hueco / 2);
      const izq = intentarEstirar(a, finLado, mitad, piezas);
      const der = intentarEstirar(b, ini, dos(hueco - izq), piezas);
      if (izq || der) cerradas += 1;
    }
    const ultimo = orden[orden.length - 1].pieza;
    const brechaFinal = dos(100 - finDe(ultimo, horizontal));
    if (
      brechaFinal > EPS &&
      brechaFinal <= brecha &&
      intentarEstirar(ultimo, finLado, brechaFinal, piezas)
    ) {
      cerradas += 1;
    }
  }
  return cerradas;
}

// =============================================================================
// API PÚBLICA
// =============================================================================

/**
 * Compacta el plano completo. Devuelve las siluetas corregidas EN EL MISMO
 * ORDEN que la entrada (con banderas de qué se movió y qué se estiró) más los
 * contadores para el reporte del guardado.
 */
export function compactarLienzo(
  piezas: Pieza[],
  opciones: OpcionesCompactacion,
): ResultadoCompactacion {
  const umbral = opciones.umbralSolape ?? UMBRAL_SOLAPE;
  const ajustes: AjustePieza[] = piezas.map((p) => ({
    id: p.id,
    cajas: redondearCajas(p.cajas.map((c) => ({ ...c }))),
    reubicada: false,
    estirada: false,
  }));

  // 1) SUPERPOSICIÓN REAL: la pieza invasora va a la zona vacía más cercana.
  let reubicadas = 0;
  for (let i = 0; i < ajustes.length; i += 1) {
    const fijas = ajustes.slice(0, i).map((a) => a.cajas);
    if (!invasivaConAlguna(ajustes[i].cajas, fijas, umbral)) continue;
    const movida = empujarAZonaLibre(ajustes[i].cajas, fijas);
    if (!movida) continue;
    ajustes[i].cajas = movida;
    ajustes[i].reubicada = true;
    reubicadas += 1;
  }

  // 2) BRECHAS MÍNIMAS: se absorben en ambos ejes; los huecos grandes siguen.
  const brechas =
    cerrarBrechas(ajustes, true, opciones.brecha.x) + cerrarBrechas(ajustes, false, opciones.brecha.y);

  // 3) Red de seguridad: ninguna silueta fuera de los muros perimetrales.
  for (const ajuste of ajustes) ajuste.cajas = redondearCajas(encajarEnLienzo(ajuste.cajas));

  return { piezas: ajustes, brechas, reubicadas };
}
