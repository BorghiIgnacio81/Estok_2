// =============================================================================
// AUTO-AJUSTE DE FILAS AL 100% (absorción del espacio muerto del layout)
// -----------------------------------------------------------------------------
// FÍSICA DE LAYOUTS: cuando una fila del plano está prácticamente llena (≥98% de
// ancho ocupado) el hueco restante es residuo del arrastre/redondeo, no un
// pasillo. Este motor lo absorbe: redistribuye proporcionalmente el ancho de los
// rectángulos de esa fila hasta que la sumatoria da EXACTAMENTE 100%, dejando el
// bloque encajado contra las paredes perimetrales del lienzo.
//
// 100% geometría pura: NO toca el DOM ni la red (no muta la entrada) y devuelve
// los anchos corregidos en % para que el script de guardado (modoLienzo.ts) los
// persista en el PUT de Django. Lo consumen todos los lienzos elásticos
// (habitaciones, muebles y estantes).
// =============================================================================

/** Ocupación mínima de una fila para disparar el auto-ajuste (98%). */
export const UMBRAL_AUTO_AJUSTE = 98;
/** Tolerancia (en % de alto) para considerar que dos cajas son de la MISMA fila. */
export const TOLERANCIA_FILA = 3;

/** Caja elástica en % del lienzo (mismos tokens que ui_left/ui_width). */
export interface CajaFila {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Resultado del auto-ajuste: índices corregidos + anchos nuevos alineados. */
export interface ResultadoAutoAjuste {
  /** Índices (mismo orden que la entrada) de las cajas cuyo ancho fue corregido. */
  indices: number[];
  /** Ancho nuevo (en %) de cada índice corregido. */
  anchos: number[];
  /** Cantidad de filas estiradas hasta el 100%. */
  filas: number;
}

interface EntradaFila {
  top: number;
  left: number;
  width: number;
  /** Índice original dentro del array de entrada. */
  i: number;
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Redistribuye proporcionalmente el ancho de las filas cuya ocupación total está
 * en el rango [98%, 100%). No muta `cajas`: devuelve las correcciones.
 */
export function autoAjustarFilas(cajas: CajaFila[]): ResultadoAutoAjuste {
  const indices: number[] = [];
  const anchos: number[] = [];
  let filas = 0;
  if (!cajas.length) return { indices, anchos, filas };

  // 1) BANDAS HORIZONTALES: se ordena por `top` y se agrupa todo lo que cae
  //    dentro de la tolerancia — una fila real del plano, nunca una columna.
  const orden: EntradaFila[] = cajas
    .map((caja, i) => ({
      top: caja.top,
      left: caja.left,
      width: Math.max(0, caja.width),
      i,
    }))
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const bandas: EntradaFila[][] = [];
  for (const entrada of orden) {
    const banda = bandas[bandas.length - 1];
    if (banda && Math.abs(entrada.top - banda[0].top) <= TOLERANCIA_FILA) banda.push(entrada);
    else bandas.push([entrada]);
  }

  // 2) BUCLE DE REDISTRIBUCIÓN PROPORCIONAL por fila (solo en el umbral exacto).
  for (const banda of bandas) {
    const suma = banda.reduce((acc, e) => acc + e.width, 0);
    if (suma < UMBRAL_AUTO_AJUSTE || suma >= 100) continue;

    const factor = 100 / suma;
    // Tope físico: ningún rectángulo puede pisar la pared derecha del lienzo.
    const corregidas = banda.map((e) => ({
      ...e,
      nueva: redondear(Math.min(e.width * factor, Math.max(0, 100 - e.left))),
    }));

    // 3) El residuo del redondeo lo absorbe la ÚLTIMA caja de la fila (la que
    //    toca la pared derecha) para garantizar la sumatoria exacta del 100%.
    let resto = redondear(100 - corregidas.reduce((acc, e) => acc + e.nueva, 0));
    for (let k = corregidas.length - 1; k >= 0 && resto > 0; k--) {
      const e = corregidas[k];
      const disponible = redondear(Math.max(0, 100 - e.left) - e.nueva);
      const extra = Math.min(resto, disponible);
      if (extra <= 0) continue;
      e.nueva = redondear(e.nueva + extra);
      resto = redondear(resto - extra);
    }

    for (const e of corregidas) {
      if (Math.abs(e.nueva - e.width) < 0.005) continue; // ya encajaba exacto
      indices.push(e.i);
      anchos.push(e.nueva);
    }
    filas += 1;
  }

  return { indices, anchos, filas };
}
