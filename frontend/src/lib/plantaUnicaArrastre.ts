// =============================================================================
// PLANTA ÚNICA - ARRASTRE Y RESIZING CON FÍSICA DE COLISIONES Y SNAPPING
// -----------------------------------------------------------------------------
// Conecta el puntero a las tarjetas del lienzo (espacios sueltos y bloques
// fusionados) aplicando:
//   - ANTI-SUPERPOSICIÓN: mientras se arrastra se marca en rojo la colisión
//     (AABB en caliente); al soltar, si el elemento pisa a otro, REBOTA a su
//     posición válida anterior (no se persiste nada inválido).
//   - AJUSTE MAGNÉTICO: al soltar, si el espacio cae en un hueco libre entre
//     dos habitaciones consolidadas y "casi" coincide, se corrige la posición
//     y el ancho/alto para encajar EXACTO; las dimensiones corregidas viajan en
//     el mismo PUT asincrónico.
//   - CONSOLIDACIÓN DE FUSIONES: mover/redimensionar un bloque fusionado
//     recalcula todas sus partes y las persiste en un ÚNICO PUT atómico.
// =============================================================================

import { toast } from './mapaJerarquico';
import { pctValor } from './mapaPlantaUnica';
import { ajustarAHuecos, colisionaConAlguna, LADO_MIN, type Caja } from './colisionesPlantaUnica';
import { partesTrasEscalar, partesTrasMover } from './plantaUnicaGrupo';
import { adaptadorUbicaciones, type AdaptadorEspacios, type ItemElastico } from './lienzoElastico';

// =============================================================================
// CONTRATO COMPARTIDO CON EL ORQUESTADOR (plantaUnicaInteractivo.ts)
// =============================================================================

export interface OpcionesPlantaUnica {
  scope: ParentNode;
  rooms: () => ItemElastico[];
  /** Id del contenedor padre (Planta Única). Opcional para visores de Nivel 2/3/4. */
  apartamentoId?: () => string | null;
  /** Garantiza el contenedor padre antes de crear (Planta Única). Opcional. */
  asegurarApartamento?: () => Promise<string | null>;
  notificarCambios: () => void;
  /** Persistencia del recurso espacial (por defecto: Ubicación, Nivel 1/2). */
  adaptador?: AdaptadorEspacios;
  /** Crea un nuevo rectángulo en el lienzo. Por defecto: Ubicación de Planta Única. */
  crearItem?: () => Promise<boolean>;
}

/** Adaptador de persistencia efectivo (Ubicación por defecto). */
export function adaptadorDe(opts: OpcionesPlantaUnica): AdaptadorEspacios {
  return opts.adaptador ?? adaptadorUbicaciones();
}

// =============================================================================
// HELPERS DE CAJA / DOM
// =============================================================================

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

function acotar(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Lee la caja (% del lienzo) desde los estilos inline de una tarjeta. */
function leerCaja(el: HTMLElement): Caja {
  return {
    left: pctValor(el.style.left, 0),
    top: pctValor(el.style.top, 0),
    width: pctValor(el.style.width, 28),
    height: pctValor(el.style.height, 24),
  };
}

/** Vuelca una caja a los estilos inline de una tarjeta. */
function aplicarCaja(card: HTMLElement, caja: Caja): void {
  card.style.left = `${redondear(caja.left)}%`;
  card.style.top = `${redondear(caja.top)}%`;
  card.style.width = `${redondear(caja.width)}%`;
  card.style.height = `${redondear(caja.height)}%`;
}

/** Cajas ocupadas del lienzo (todas menos el elemento que se está editando). */
function leerOcupadas(scope: ParentNode, excluir: HTMLElement | null): Caja[] {
  const cajas: Caja[] = [];
  scope.querySelectorAll<HTMLElement>('[data-inplace-card]').forEach((el) => {
    if (el !== excluir) cajas.push(leerCaja(el));
  });
  return cajas;
}

/** Rebote limpio: anima el retorno a la caja válida anterior y avisa visualmente. */
function rebotar(card: HTMLElement, cajaValida: Caja): void {
  card.classList.add('pu-rebote');
  aplicarCaja(card, cajaValida);
  window.setTimeout(() => card.classList.remove('pu-rebote'), 300);
}

// =============================================================================
// ARRASTRE LIBRE (espacios sueltos + bloques fusionados)
// =============================================================================

export function conectarArrastreLibre(opts: OpcionesPlantaUnica): void {
  opts.scope.querySelectorAll<HTMLElement>('[data-libre-drag]').forEach((card) => {
    card.addEventListener('pointerdown', (evDown) => {
      const e = evDown as PointerEvent;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (
        target.closest(
          '[data-fusion-check],[data-inplace-renombrar],[data-libre-resize],[data-grupo-resize],[data-eliminar-grupo]',
        )
      ) {
        return;
      }
      const lienzo = card.closest<HTMLElement>('[data-lienzo-pu]');
      if (!lienzo) return;
      e.preventDefault();
      const rect = lienzo.getBoundingClientRect();
      const x0 = e.clientX;
      const y0 = e.clientY;
      const base = leerCaja(card);
      const esGrupo = Boolean(card.dataset.fusionGrupo);
      let arrastrado = false;
      card.classList.add('pu-arrastrando');
      try {
        card.setPointerCapture(e.pointerId);
      } catch {
        /* sin captura: el seguimiento continúa igual */
      }
      // Los demás espacios no se mueven durante este gesto → se leen UNA vez.
      const ocupadas = leerOcupadas(opts.scope, card);

      const enMovimiento = (m: PointerEvent): void => {
        m.preventDefault();
        arrastrado = true;
        const dL = ((m.clientX - x0) / Math.max(1, rect.width)) * 100;
        const dT = ((m.clientY - y0) / Math.max(1, rect.height)) * 100;
        aplicarCaja(card, {
          left: acotar(base.left + dL, 0, 100 - base.width),
          top: acotar(base.top + dT, 0, 100 - base.height),
          width: base.width,
          height: base.height,
        });
        // Colisión en caliente (feedback visual inmediato).
        const pisa = colisionaConAlguna(leerCaja(card), ocupadas);
        card.classList.toggle('pu-en-colision', pisa);
      };

      const alSoltar = (): void => {
        card.removeEventListener('pointermove', enMovimiento);
        card.removeEventListener('pointerup', alSoltar);
        card.removeEventListener('pointercancel', alSoltar);
        card.classList.remove('pu-arrastrando', 'pu-en-colision');
        if (!arrastrado) return;
        const cand = leerCaja(card);
        if (esGrupo) {
          void soltarGrupo(card, base, cand, ocupadas, opts);
        } else {
          void soltarSuelto(card, base, cand, ocupadas, opts);
        }
      };

      card.addEventListener('pointermove', enMovimiento);
      card.addEventListener('pointerup', alSoltar);
      card.addEventListener('pointercancel', alSoltar);
    });
  });
}

// =============================================================================
// DROP DE UN ESPACIO SUELTO: snapping → colisión → rebote → PUT elástico
// =============================================================================

async function soltarSuelto(
  card: HTMLElement,
  base: Caja,
  cand: Caja,
  ocupadas: Caja[],
  opts: OpcionesPlantaUnica,
): Promise<void> {
  const id = card.dataset.id ?? '';
  if (!id) return;

  // 1) AJUSTE MAGNÉTICO a huecos (puede corregir posición y ancho/alto).
  const ajuste = ajustarAHuecos(cand, ocupadas);
  const caja = ajuste.caja;

  // 2) ANTI-SUPERPOSICIÓN: si aún se pisa con otro espacio, rebota a lo válido.
  if (colisionaConAlguna(caja, ocupadas)) {
    rebotar(card, base);
    toast('⛔ Ese espacio se superpone con otro. Rebotó a su posición válida.');
    return;
  }

  aplicarCaja(card, caja);
  const valores = {
    ui_left: `${redondear(caja.left)}%`,
    ui_top: `${redondear(caja.top)}%`,
    ui_width: `${redondear(caja.width)}%`,
    ui_height: `${redondear(caja.height)}%`,
  };
  const ok = await adaptadorDe(opts).guardarItem(id, valores);
  if (!ok) {
    toast('❌ No se pudo guardar la posición del espacio.');
    rebotar(card, base);
    return;
  }
  const room = opts.rooms().find((r) => r.id === id);
  if (room) Object.assign(room, valores);

  if (ajuste.ajustoAncho || ajuste.ajustoAlto) {
    toast('🧲 Encaje magnético: el espacio se ajustó exacto al hueco libre.');
  } else {
    toast('✅ Espacio reubicado.');
  }
  opts.notificarCambios();
}

// =============================================================================
// DROP DE UN BLOQUE FUSIONADO: colisión del bloque → único PUT a todas partes
// =============================================================================

async function soltarGrupo(
  card: HTMLElement,
  base: Caja,
  cand: Caja,
  ocupadas: Caja[],
  opts: OpcionesPlantaUnica,
): Promise<void> {
  const baseId = card.dataset.id ?? '';
  if (!baseId) return;

  if (colisionaConAlguna(cand, ocupadas)) {
    rebotar(card, base);
    toast('⛔ El bloque fusionado choca con otro espacio. Rebotó a su posición válida.');
    return;
  }

  const partes = partesTrasMover(card, cand.left - base.left, cand.top - base.top);
  const ok = await adaptadorDe(opts).guardarGrupo(baseId, { partes });
  if (!ok) {
    toast('❌ No se pudo mover el espacio fusionado.');
    rebotar(card, base);
    return;
  }
  toast('🔗 Bloque fusionado reubicado: todas sus partes en un solo PUT.');
  opts.notificarCambios();
}

// =============================================================================
// RESIZING ELÁSTICO (espacio suelto + bloque fusionado consolidado)
// =============================================================================

export function conectarResizeLibre(opts: OpcionesPlantaUnica): void {
  conectarResizeSuelto(opts);
  conectarResizeGrupo(opts);
}

function conectarResizeSuelto(opts: OpcionesPlantaUnica): void {
  opts.scope.querySelectorAll<HTMLElement>('[data-libre-resize]').forEach((handle) => {
    handle.addEventListener('pointerdown', (evDown) => {
      const e = evDown as PointerEvent;
      if (e.button !== 0) return;
      const card = handle.closest<HTMLElement>('[data-inplace-card]');
      const lienzo = handle.closest<HTMLElement>('[data-lienzo-pu]');
      if (!card || !lienzo || card.dataset.fusionGrupo) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = lienzo.getBoundingClientRect();
      const x0 = e.clientX;
      const y0 = e.clientY;
      const base = leerCaja(card);
      const ocupadas = leerOcupadas(opts.scope, card);
      let cambió = false;
      card.classList.add('pu-redimensionando');
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* sin captura: el seguimiento continúa igual */
      }

      const enMovimiento = (m: PointerEvent): void => {
        m.preventDefault();
        cambió = true;
        const dW = ((m.clientX - x0) / Math.max(1, rect.width)) * 100;
        const dH = ((m.clientY - y0) / Math.max(1, rect.height)) * 100;
        aplicarCaja(card, {
          left: base.left,
          top: base.top,
          width: acotar(base.width + dW, LADO_MIN, 100 - base.left),
          height: acotar(base.height + dH, LADO_MIN, 100 - base.top),
        });
        card.classList.toggle('pu-en-colision', colisionaConAlguna(leerCaja(card), ocupadas));
      };

      const alSoltar = async (): Promise<void> => {
        handle.removeEventListener('pointermove', enMovimiento);
        handle.removeEventListener('pointerup', alSoltar);
        handle.removeEventListener('pointercancel', alSoltar);
        card.classList.remove('pu-redimensionando', 'pu-en-colision');
        if (!cambió) return;
        const nueva = leerCaja(card);
        if (colisionaConAlguna(nueva, ocupadas)) {
          rebotar(card, base);
          toast('⛔ El nuevo tamaño se superpone con otro espacio. Rebotó al anterior.');
          return;
        }
        const id = card.dataset.id ?? '';
        if (!id) return;
        const w = redondear(nueva.width);
        const h = redondear(nueva.height);
        const ok = await adaptadorDe(opts).guardarItem(id, { ui_width: `${w}%`, ui_height: `${h}%` });
        if (!ok) {
          toast('❌ No se pudo guardar el nuevo tamaño.');
          rebotar(card, base);
          return;
        }
        const room = opts.rooms().find((r) => r.id === id);
        if (room) {
          room.ui_width = `${w}%`;
          room.ui_height = `${h}%`;
        }
        toast(`✅ Tamaño actualizado (${w}% × ${h}%).`);
        opts.notificarCambios();
      };

      handle.addEventListener('pointermove', enMovimiento);
      handle.addEventListener('pointerup', alSoltar);
      handle.addEventListener('pointercancel', alSoltar);
    });
  });
}

function conectarResizeGrupo(opts: OpcionesPlantaUnica): void {
  opts.scope.querySelectorAll<HTMLElement>('[data-grupo-resize]').forEach((handle) => {
    handle.addEventListener('pointerdown', (evDown) => {
      const e = evDown as PointerEvent;
      if (e.button !== 0) return;
      const card = handle.closest<HTMLElement>('.pu-grupo');
      const lienzo = handle.closest<HTMLElement>('[data-lienzo-pu]');
      if (!card || !lienzo) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = lienzo.getBoundingClientRect();
      const x0 = e.clientX;
      const y0 = e.clientY;
      const base = leerCaja(card);
      const ocupadas = leerOcupadas(opts.scope, card);
      let cambió = false;
      card.classList.add('pu-redimensionando');
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* sin captura: el seguimiento continúa igual */
      }

      const enMovimiento = (m: PointerEvent): void => {
        m.preventDefault();
        cambió = true;
        const dW = ((m.clientX - x0) / Math.max(1, rect.width)) * 100;
        const dH = ((m.clientY - y0) / Math.max(1, rect.height)) * 100;
        aplicarCaja(card, {
          left: base.left,
          top: base.top,
          width: acotar(base.width + dW, LADO_MIN, 100 - base.left),
          height: acotar(base.height + dH, LADO_MIN, 100 - base.top),
        });
        card.classList.toggle('pu-en-colision', colisionaConAlguna(leerCaja(card), ocupadas));
      };

      const alSoltar = async (): Promise<void> => {
        handle.removeEventListener('pointermove', enMovimiento);
        handle.removeEventListener('pointerup', alSoltar);
        handle.removeEventListener('pointercancel', alSoltar);
        card.classList.remove('pu-redimensionando', 'pu-en-colision');
        if (!cambió) return;
        const baseId = card.dataset.id ?? '';
        if (!baseId) return;
        const nueva = leerCaja(card);
        if (colisionaConAlguna(nueva, ocupadas)) {
          rebotar(card, base);
          toast('⛔ El bloque fusionado redimensionado se superpone con otro espacio. Rebotó.');
          return;
        }
        // CONSOLIDACIÓN: se escala cada módulo y se persiste TODO en un único PUT.
        const escala = {
          x: nueva.width / Math.max(1, base.width),
          y: nueva.height / Math.max(1, base.height),
        };
        const partes = partesTrasEscalar(card, { left: base.left, top: base.top }, escala);
        const ok = await adaptadorDe(opts).guardarGrupo(baseId, { partes });
        if (!ok) {
          toast('❌ No se pudo redimensionar el bloque fusionado.');
          rebotar(card, base);
          return;
        }
        toast('🔗 Bloque fusionado redimensionado: todas sus partes en un solo PUT.');
        opts.notificarCambios();
      };

      handle.addEventListener('pointermove', enMovimiento);
      handle.addEventListener('pointerup', alSoltar);
      handle.addEventListener('pointercancel', alSoltar);
    });
  });
}
