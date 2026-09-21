// =============================================================================
// GUARDADO DEL PLANO: COMPACTACIÓN INTELIGENTE + PERSISTENCIA (💾 Guardar)
// -----------------------------------------------------------------------------
// ÚNICO punto donde corre la física del plano (colisiones y auto-ajuste): el
// arrastre en Modo Edición es 100% libre y la física se posterga hasta que el
// usuario presiona «💾 Guardar» (o «Continuar ➜» en el plano del asistente).
//
// Por cada lienzo elástico VISIBLE ([data-lienzo-pu]) se:
//   1) leen las SILUETAS REALES de sus tarjetas (tiles del bloque fusionado o
//      caja propia del espacio común) → compactacionPlanta.compactarLienzo();
//   2) escriben las geometrías corregidas en el DOM (marco + tiles);
//   3) persisten con PUT: ítem suelto → /{recurso}/{id}/ y bloque fusionado →
//      /{recurso}/{base}/grupo/ con TODAS sus partes en una sola transacción.
// Los espacios que no cambiaron no viajan a la red: cero PUT innecesarios.
// =============================================================================

import { crearAdaptadorEspacios, type AdaptadorEspacios } from './lienzoElastico';
import { brechaEnPorcentaje, compactarLienzo } from './compactacionPlanta';
import { aplicarSilueta, cajasDeCarta, esGrupo, pct } from './lienzoCajas';
import { partesTrasMover } from './plantaUnicaGrupo';
import { toast } from './mapaJerarquico';

export interface ReporteGuardado {
  /** Espacios cuya geometría compactada viajó a la red (PUT). */
  medidas: number;
  /** Brechas mínimas absorbidas (muros perimetrales + pares de vecinos). */
  brechas: number;
  /** Espacios empujados a una zona vacía por superposición real. */
  reubicadas: number;
}

const adaptadores = new Map<string, AdaptadorEspacios>();

/** Adaptador de persistencia memoizado por recurso REST. */
function adaptadorDe(recurso: string): AdaptadorEspacios {
  let adaptador = adaptadores.get(recurso);
  if (!adaptador) {
    adaptador = crearAdaptadorEspacios(`/${recurso}`);
    adaptadores.set(recurso, adaptador);
  }
  return adaptador;
}

/** Recurso REST del lienzo al que pertenece una tarjeta (para el PUT). */
function recursoDeCarta(carta: HTMLElement): string | null {
  if (carta.closest('#visorHabitacion') || carta.closest('#visorContenedorGrande')) return 'contenedores';
  if (carta.closest('#mapaEstokPanel') || carta.closest('#onbPlanoUnico')) return 'ubicaciones';
  return null;
}

/** Tarjetas editables de primer nivel (bloques fusionados + espacios sueltos). */
function cartasDeLienzo(lienzo: HTMLElement): HTMLElement[] {
  return Array.from(lienzo.querySelectorAll<HTMLElement>(':scope > [data-inplace-card][data-id]'));
}

/** PUT de la geometría compactada de una tarjeta (ítem suelto o grupo atómico). */
async function persistirCarta(carta: HTMLElement, recurso: string, id: string): Promise<void> {
  const adaptador = adaptadorDe(recurso);
  if (esGrupo(carta)) {
    // Las partes del bloque ya fueron reescritas en el DOM por aplicarSilueta().
    const partes = partesTrasMover(carta, 0, 0);
    const ok = await adaptador.guardarGrupo(id, { partes });
    if (!ok) toast('❌ No se pudo guardar la geometría compactada del bloque fusionado.');
    return;
  }
  const caja = cajasDeCarta(carta)[0];
  if (!caja) return;
  const ok = await adaptador.guardarItem(id, {
    ui_left: pct(caja.left),
    ui_top: pct(caja.top),
    ui_width: pct(caja.width),
    ui_height: pct(caja.height),
  });
  if (!ok) toast('❌ No se pudo guardar la geometría compactada de un espacio.');
}

/**
 * COMPACTACIÓN INTELIGENTE + GUARDADO de todos los lienzos visibles:
 * superposición real → zona vacía más cercana; brechas mínimas → estirado
 * simétrico hasta los vecinos o los muros; huecos grandes → intactos.
 */
export async function compactarYGuardarLienzos(): Promise<ReporteGuardado> {
  const reporte: ReporteGuardado = { medidas: 0, brechas: 0, reubicadas: 0 };
  const tareas: Promise<void>[] = [];

  document.querySelectorAll<HTMLElement>('[data-lienzo-pu]').forEach((lienzo) => {
    const rect = lienzo.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) return; // lienzos ocultos: intactos
    const cartas = cartasDeLienzo(lienzo);
    if (!cartas.length) return;

    const resultado = compactarLienzo(
      cartas.map((carta) => ({ id: carta.dataset.id ?? '', cajas: cajasDeCarta(carta) })),
      { brecha: brechaEnPorcentaje(rect.width, rect.height) },
    );
    reporte.brechas += resultado.brechas;
    reporte.reubicadas += resultado.reubicadas;

    resultado.piezas.forEach((ajuste, i) => {
      const carta = cartas[i];
      if (!carta || (!ajuste.reubicada && !ajuste.estirada)) return;
      const id = carta.dataset.id ?? '';
      const recurso = id ? recursoDeCarta(carta) : null;
      // Sin recurso REST conocido no hay PUT posible: la geometría queda intacta.
      if (!id || !recurso) return;
      aplicarSilueta(carta, ajuste.cajas);
      reporte.medidas += 1;
      tareas.push(persistirCarta(carta, recurso, id));
    });
  });

  await Promise.all(tareas);
  return reporte;
}
