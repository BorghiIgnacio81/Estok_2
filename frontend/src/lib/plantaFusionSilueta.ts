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
//
// TERCER CONSUMIDOR: los MINIMAPAS también heredan esta regla. A escala de
// miniatura no hay portadores táctiles ni celdas HTML: el bloque fusionado se
// dibuja con el CONTORNO EXTERIOR de su unión (`contornoUnion` + `pathContorno`),
// de modo que el trazo único rodea todo el bloque y ninguna arista compartida
// queda como línea divisoria interna.
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

// =============================================================================
// CONTORNO EXTERIOR DE LA UNIÓN (minimapas: un solo trazo, sin líneas internas)
// -----------------------------------------------------------------------------
// A escala de miniatura no hay celdas HTML con clases de borde: el bloque
// fusionado se dibuja con UN ÚNICO contorno cerrado. `contornoUnion` recorre la
// frontera real de la unión de las cajas (grilla comprimida sobre las
// coordenadas propias de las celdas: exacta, sin muestreo ni aproximación) y
// devuelve los lazos del contorno; `pathContorno` los serializa como `<path>`,
// aplicando el mapeo a coordenadas del destino (el viewBox del minimapa).
//
// Las aristas compartidas entre celdas hermanas NUNCA forman parte del lazo:
// sólo sobrevive la frontera exterior (y el borde de un hipotético hueco
// interno, con el sentido invertido, para que hasta el `fill-rule: nonzero` lo
// respete). 100% puro: sin DOM, sin estado, sin dependencias.
// =============================================================================

/** Punto de un contorno de bloque, en % de la caja del bloque (0..100). */
export interface PuntoBloque {
  x: number;
  y: number;
}

/** Dos medidas son la misma coordenada (absorbe el redondeo de ui_*). */
function igual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-6;
}

/** Coordenadas únicas y ordenadas de un eje (líneas de corte de la grilla). */
function cortes(valores: number[]): number[] {
  const ordenados = [...valores].sort((a, b) => a - b);
  const salida: number[] = [];
  ordenados.forEach((valor) => {
    if (!salida.length || !igual(salida[salida.length - 1], valor)) salida.push(valor);
  });
  return salida;
}

/** Índice de una coordenada dentro de sus líneas de corte. */
function indiceDe(cortesEje: number[], valor: number): number {
  return cortesEje.findIndex((v) => igual(v, valor));
}

/** Clave de un punto con el MISMO redondeo que los tokens del path (2 decimales). */
function clavePunto(x: number, y: number): string {
  return `${token(x)}|${token(y)}`;
}

/** Segmento dirigido de la frontera (el interior queda siempre del mismo lado). */
interface Segmento {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  usado: boolean;
}

/**
 * Giro en pantalla (eje Y hacia abajo) con prioridad derecha → recto →
 * izquierda: mantiene el recorrido abrazado al borde de la unión también en los
 * vértices ambiguos (dos fronteras que se tocan en un mismo punto).
 */
function elegirSegmento(segmentos: Segmento[], candidatos: number[], previo: Segmento): Segmento {
  const dx = Math.sign(previo.x2 - previo.x1);
  const dy = Math.sign(previo.y2 - previo.y1);
  const prioridad: Array<[number, number]> = [
    [-dy, dx],
    [dx, dy],
    [dy, -dx],
  ];
  for (const [px, py] of prioridad) {
    for (const i of candidatos) {
      const s = segmentos[i];
      if (Math.sign(s.x2 - s.x1) === px && Math.sign(s.y2 - s.y1) === py) return s;
    }
  }
  return segmentos[candidatos[0]];
}

/**
 * CONTORNO EXTERIOR EXACTO de la unión de varias cajas rectangulares.
 *
 * Devuelve un lazo cerrado por frontera (el contorno del bloque y, si la unión
 * encierra un hueco, también el borde interior de ese hueco) en % de la caja que
 * las cajas ocupan en conjunto (0..100). Las aristas que dos cajas comparten NO
 * aparecen: son interiores a la unión, que es exactamente el equivalente
 * vectorial de `border-*-0` entre las celdas hermanas de un espacio fusionado.
 */
export function contornoUnion(cajas: readonly CajaBloque[]): PuntoBloque[][] {
  const validas = cajas.filter((c) => c.width > 0 && c.height > 0);
  if (!validas.length) return [];
  if (validas.length === 1) {
    const c = validas[0];
    return [
      [
        { x: c.left, y: c.top },
        { x: c.left + c.width, y: c.top },
        { x: c.left + c.width, y: c.top + c.height },
        { x: c.left, y: c.top + c.height },
      ],
    ];
  }

  // 1) Grilla comprimida: una celda por rango entre las líneas de corte propias.
  const xs = cortes(validas.flatMap((c) => [c.left, c.left + c.width]));
  const ys = cortes(validas.flatMap((c) => [c.top, c.top + c.height]));
  const columnas = xs.length - 1;
  const filas = ys.length - 1;
  const cubierta: boolean[][] = Array.from({ length: columnas }, () =>
    new Array<boolean>(filas).fill(false),
  );
  validas.forEach((c) => {
    const i0 = indiceDe(xs, c.left);
    const i1 = indiceDe(xs, c.left + c.width);
    const j0 = indiceDe(ys, c.top);
    const j1 = indiceDe(ys, c.top + c.height);
    for (let i = i0; i < i1; i++) {
      for (let j = j0; j < j1; j++) cubierta[i][j] = true;
    }
  });

  // 2) Aristas de FRONTERA (celda cubierta que da a una descubierta), dirigidas
  //    de forma consistente: el interior siempre sobre el mismo lado.
  const segmentos: Segmento[] = [];
  const salidas = new Map<string, number[]>();
  const agregar = (x1: number, y1: number, x2: number, y2: number): void => {
    const i = segmentos.length;
    segmentos.push({ x1, y1, x2, y2, usado: false });
    const clave = clavePunto(x1, y1);
    const lista = salidas.get(clave) ?? [];
    lista.push(i);
    salidas.set(clave, lista);
  };
  for (let i = 0; i < columnas; i++) {
    for (let j = 0; j < filas; j++) {
      if (!cubierta[i][j]) continue;
      const x0 = xs[i];
      const x1 = xs[i + 1];
      const y0 = ys[j];
      const y1 = ys[j + 1];
      if (j === 0 || !cubierta[i][j - 1]) agregar(x0, y0, x1, y0);
      if (j === filas - 1 || !cubierta[i][j + 1]) agregar(x1, y1, x0, y1);
      if (i === 0 || !cubierta[i - 1][j]) agregar(x0, y1, x0, y0);
      if (i === columnas - 1 || !cubierta[i + 1][j]) agregar(x1, y0, x1, y1);
    }
  }

  // 3) Encadenado de lazos: cada arista se usa UNA vez y la cadena se cierra
  //    cuando su punto de salida ya no tiene aristas libres (o vuelve al inicio).
  const lazos: PuntoBloque[][] = [];
  for (let inicio = 0; inicio < segmentos.length; inicio++) {
    if (segmentos[inicio].usado) continue;
    const lazo: PuntoBloque[] = [];
    let actual: Segmento | undefined = segmentos[inicio];
    let ultimo: Segmento | null = null;
    while (actual) {
      actual.usado = true;
      lazo.push({ x: actual.x1, y: actual.y1 });
      ultimo = actual;
      const clave = clavePunto(actual.x2, actual.y2);
      const candidatos = (salidas.get(clave) ?? []).filter((i) => !segmentos[i].usado);
      if (!candidatos.length) break;
      const elegido = elegirSegmento(segmentos, candidatos, actual);
      if (igual(elegido.x1, lazo[0].x) && igual(elegido.y1, lazo[0].y)) break;
      actual = elegido;
    }
    // Lazo abierto (cadena que no volvió a su inicio): se cierra con su extremo.
    if (ultimo && !(igual(ultimo.x2, lazo[0].x) && igual(ultimo.y2, lazo[0].y))) {
      lazo.push({ x: ultimo.x2, y: ultimo.y2 });
    }
    if (lazo.length >= 3) lazos.push(lazo);
  }
  return lazos;
}

/**
 * Serializa los lazos como `<path>` SVG (`M` + tramos `H` / `V` + `Z` por lazo),
 * aplicando `mapear` a cada punto. Sin `mapear`, el path queda en el espacio
 * 0..100 del bloque.
 */
export function pathContorno(
  lazos: readonly PuntoBloque[][],
  mapear?: (punto: PuntoBloque) => PuntoBloque,
): string {
  return lazos
    .filter((lazo) => lazo.length >= 3)
    .map((lazo) => {
      const puntos = (mapear ? lazo.map(mapear) : [...lazo]).map((p) => ({
        x: Math.round(p.x * 100) / 100,
        y: Math.round(p.y * 100) / 100,
      }));
      let d = `M${token(puntos[0].x)} ${token(puntos[0].y)}`;
      for (let i = 1; i < puntos.length; i++) {
        const previo = puntos[i - 1];
        const punto = puntos[i];
        if (previo.x === punto.x && previo.y === punto.y) continue;
        if (previo.y === punto.y) d += `H${token(punto.x)}`;
        else if (previo.x === punto.x) d += `V${token(punto.y)}`;
        else d += `L${token(punto.x)} ${token(punto.y)}`;
      }
      return `${d}Z`;
    })
    .join('');
}

