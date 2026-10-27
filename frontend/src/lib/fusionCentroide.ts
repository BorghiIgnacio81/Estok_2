// =============================================================================
// GEOMETRÍA DE UN BLOQUE FUSIONADO — FUENTE ÚNICA DE CENTROIDE Y ANCLA
// -----------------------------------------------------------------------------
// Un espacio fusionado («Pasillo Escalera», una «L») vive dentro del BOUNDING
// BOX de sus celdas, pero la forma real NO ocupa ese rectángulo: la esquina
// vacía del bbox queda fuera de la silueta. Si la etiqueta o la casilla de
// selección se centran en el bbox «a ciegas», quedan flotando por fuera del
// ambiente (encima del cuarto vecino).
//
// Este módulo concentra el cálculo en UN solo lugar para que lo compartan:
//   · el lienzo grande de /almacenamiento (lib/mapaPlantaUnica.ts),
//   · el plano del selector de ubicación del formulario de Objetos
//     (lib/minimapaEtiquetas.ts, capa de etiquetas de lib/minimapa.ts).
//
// Reglas (idénticas en toda la app):
//   · CENTRO: baricentro ponderado por área de las celdas reales. Se sondea a
//     MARGEN_CENTRO hacia los 4 lados; si algún sondeo cae fuera de la silueta
//     el centro colisiona con una arista externa y se usa el centro de la celda
//     de MAYOR área (interior visible garantizado).
//   · ANCLA: celda MÁS ALTA (y entre las empatadas la más a la IZQUIERDA), con
//     margen acotado a medio tile para que la casilla nunca se salga.
//   · Salida en % RELATIVO a la caja del bloque, acotada a 15..85 % para que
//     nada quede pegado a un borde.
//
// 100% puro: sin DOM, sin estado, sin dependencias (no puede generar ciclos).
// =============================================================================

/** Rectángulo en % del lienzo (o relativo a un bbox, según el contexto). */
export interface CajaFusion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Punto expresado en % RELATIVO a la caja del bloque fusionado. */
export interface PuntoFusion {
  x: number;
  y: number;
}

/**
 * Margen de RESGUARDO (en unidades de la geometría recibida) que la etiqueta
 * debe dejar libre hacia el borde perimetral del bloque. Si el baricentro queda
 * más cerca que esto de una arista EXTERNA, se relocaliza.
 */
export const MARGEN_CENTRO_FUSION = 5;

/** True si (px,py) cae dentro de alguna celda de la silueta fusionada. */
function dentroDelBloque(px: number, py: number, geos: readonly CajaFusion[]): boolean {
  return geos.some(
    (geo) =>
      px >= geo.left && px <= geo.left + geo.width && py >= geo.top && py <= geo.top + geo.height,
  );
}

/** Acota la coordenada relativa al 15..85 % (nunca se sale de la superficie). */
function acotarPct(valor: number): number {
  return Math.max(15, Math.min(85, valor));
}

/** Convierte una coordenada absoluta a % relativo a la caja del bloque. */
function relativo(valor: number, inicio: number, tamano: number): number {
  return ((valor - inicio) / Math.max(1e-6, tamano)) * 100;
}

/** Celda de MAYOR área (interior siempre visible de la silueta). */
function celdaMayor(geos: readonly CajaFusion[]): CajaFusion {
  return geos.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
}

/**
 * PUNTO CENTRAL del bloque en las MISMAS unidades que `geos` (absolutas):
 * baricentro ponderado por área con RESGUARDO anticolisión. Si el baricentro
 * está a menos de MARGEN_CENTRO_FUSION de una arista externa, se devuelve el
 * centro de la celda de mayor área.
 */
function puntoCentral(geos: readonly CajaFusion[]): PuntoFusion {
  if (!geos.length) return { x: 50, y: 50 };

  let area = 0;
  let sx = 0;
  let sy = 0;
  geos.forEach((geo) => {
    const a = Math.max(1e-6, geo.width * geo.height);
    area += a;
    sx += a * (geo.left + geo.width / 2);
    sy += a * (geo.top + geo.height / 2);
  });
  if (area <= 0) return { x: 50, y: 50 };

  const cx = sx / area;
  const cy = sy / area;
  const resguardado =
    dentroDelBloque(cx - MARGEN_CENTRO_FUSION, cy, geos) &&
    dentroDelBloque(cx + MARGEN_CENTRO_FUSION, cy, geos) &&
    dentroDelBloque(cx, cy - MARGEN_CENTRO_FUSION, geos) &&
    dentroDelBloque(cx, cy + MARGEN_CENTRO_FUSION, geos);
  if (resguardado) return { x: cx, y: cy };

  const mayor = celdaMayor(geos);
  return { x: mayor.left + mayor.width / 2, y: mayor.top + mayor.height / 2 };
}

/**
 * CENTRO del bloque fusionado (baricentro del área real de sus celdas).
 * Devuelve el punto en % relativo a `caja`, acotado a 15..85 %.
 */
export function centroDeFusion(
  geos: readonly CajaFusion[],
  caja: CajaFusion,
): PuntoFusion {
  if (!geos.length) return { x: 50, y: 50 };
  const centro = puntoCentral(geos);
  return {
    x: acotarPct(relativo(centro.x, caja.left, caja.width)),
    y: acotarPct(relativo(centro.y, caja.top, caja.height)),
  };
}

/**
 * CELDA de la silueta que CONTIENE el centro del bloque, expresada en % relativo
 * a `caja`.
 *
 * Es el rectángulo donde debe dibujarse la etiqueta de una habitación fusionada:
 * al pertenecer a la propia forma, el texto nunca puede quedar flotando sobre la
 * esquina vacía del bounding box ni fuera de los límites del ambiente.
 */
export function celdaDelCentro(
  geos: readonly CajaFusion[],
  caja: CajaFusion,
): CajaFusion {
  if (!geos.length) return { left: 0, top: 0, width: 100, height: 100 };

  const centro = puntoCentral(geos);
  const contiene =
    geos.find(
      (geo) =>
        centro.x >= geo.left &&
        centro.x <= geo.left + geo.width &&
        centro.y >= geo.top &&
        centro.y <= geo.top + geo.height,
    ) ?? celdaMayor(geos);

  return {
    left: relativo(contiene.left, caja.left, caja.width),
    top: relativo(contiene.top, caja.top, caja.height),
    width: relativo(contiene.width, 0, caja.width),
    height: relativo(contiene.height, 0, caja.height),
  };
}

/**
 * ANCLA de la casilla de selección del bloque fusionado (fix del «checkbox
 * flotante»): esquina superior izquierda de la celda MÁS ALTA del bloque —entre
 * las empatadas, la más a la IZQUIERDA— con un margen acotado a medio tile.
 * Devuelve el punto en % relativo a `caja`.
 */
export function anclaDeFusion(
  geos: readonly CajaFusion[],
  caja: CajaFusion,
): PuntoFusion {
  if (!geos.length) return { x: 0, y: 0 };

  const ancla = geos.reduce((a, b) => {
    if (b.top < a.top - 0.5) return b;
    if (Math.abs(b.top - a.top) <= 0.5 && b.left < a.left) return b;
    return a;
  });

  const relLeft = relativo(ancla.left, caja.left, caja.width);
  const relTop = relativo(ancla.top, caja.top, caja.height);
  const relAncho = relativo(ancla.width, 0, caja.width);
  const relAlto = relativo(ancla.height, 0, caja.height);
  return {
    x: relLeft + Math.min(2, relAncho / 2),
    y: relTop + Math.min(3, relAlto / 2),
  };
}
