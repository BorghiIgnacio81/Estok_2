// =============================================================================
// PERÍMETRO ELÁSTICO DEL PLANO - contenedor perimetral redimensionable
// -----------------------------------------------------------------------------
// El recuadro ámbar (`.planta-unica-lienzo`) expone en MODO EDICIÓN tiradores
// (derecho, inferior y esquina) para estirar el plano de CUALQUIER planta: se
// aplica EN CALIENTE y se persiste al soltar con UN ÚNICO PUT (ui_width/ui_height
// px) sobre la Ubicación perimetral (persistencia vía `AdaptadorEspacios`/`guardar`).
// =============================================================================

import type { AdaptadorEspacios } from './lienzoElastico';
import { toast } from './mapaJerarquico';

/** Límites elásticos del perímetro (px): nunca colapsa ni se vuelve infinito. */
export const PERIMETRO_MIN_ANCHO = 320;
export const PERIMETRO_MIN_ALTO = 240;
export const PERIMETRO_MAX_ANCHO = 2400;
export const PERIMETRO_MAX_ALTO = 1800;

/** Alto vivo por defecto del lienzo (coincide con el `min-height` del CSS). */
export const PERIMETRO_ALTO_DEFECTO = 480;

/** Medida efectiva del perímetro en píxeles. */
export interface MedidaPerimetro {
  ancho: number;
  alto: number;
}

/** Dueño persistente de la medida general del plano (`ui_width`/`ui_height`). */
export interface DuenioPerimetro {
  ui_width?: string | null;
  ui_height?: string | null;
}

function acotar(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Acota una medida a los límites elásticos del perímetro. */
export function acotarMedida(medida: MedidaPerimetro): MedidaPerimetro {
  return {
    ancho: acotar(Math.round(medida.ancho), PERIMETRO_MIN_ANCHO, PERIMETRO_MAX_ANCHO),
    alto: acotar(Math.round(medida.alto), PERIMETRO_MIN_ALTO, PERIMETRO_MAX_ALTO),
  };
}

/** Parsea un token CSS de medida fija ('820px' → 820). null si no es una medida. */
export function medidaPx(token?: string | null): number | null {
  const s = (token ?? '').trim();
  const m = /^(\d{1,4}(?:\.\d+)?)px$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** true si el token todavía no define una medida propia ('auto', '100%', vacío). */
export function sinMedidaPropia(token?: string | null): boolean {
  return medidaPx(token) === null;
}

/**
 * Medida efectiva del perímetro: la persistida (px) o, mientras no exista, la
 * medida VIVA del contenedor en pantalla (nunca 'auto' → cero saltos visuales).
 */
export function medidaDePerimetro(
  duenio: DuenioPerimetro | null | undefined,
  vivo: MedidaPerimetro,
): MedidaPerimetro {
  return acotarMedida({
    ancho: medidaPx(duenio?.ui_width) ?? vivo.ancho,
    alto: medidaPx(duenio?.ui_height) ?? vivo.alto,
  });
}

/**
 * Atributo `style` del perímetro (solo cuando hay una medida propia persistida:
 * sin esto el lienzo conserva su ancho fluido del CSS y su alto mínimo).
 */
export function estiloPerimetro(duenio: DuenioPerimetro | null | undefined): string {
  const ancho = medidaPx(duenio?.ui_width);
  const alto = medidaPx(duenio?.ui_height);
  const partes: string[] = [];
  if (ancho) partes.push(`width:${ancho}px`);
  if (alto) partes.push(`height:${alto}px`);
  return partes.length ? ` style="${partes.join(';')}"` : '';
}

/**
 * Tiradores del perímetro, SIEMPRE presentes en el marcado y visibles solo en
 * Modo Edición (`body.modo-edicion`, ver styles/lienzo-perimetro.css).
 */
export function tiradoresPerimetro(): string {
  return `
      <span class="pu-perimetro-tirador pu-perimetro-borde-derecho" data-perimetro-resize="ancho"
        title="Arrastrá para cambiar el ANCHO del plano completo (se guarda solo)"></span>
      <span class="pu-perimetro-tirador pu-perimetro-borde-inferior" data-perimetro-resize="alto"
        title="Arrastrá para cambiar el ALTO del plano completo (se guarda solo)"></span>
      <span class="pu-perimetro-tirador pu-perimetro-esquina" data-perimetro-resize="ambos"
        title="Arrastrá para cambiar el ANCHO y el ALTO del plano completo (se guarda solo)"></span>`;
}

/**
 * Inyecta el perímetro elástico (marca `data-perimetro-elastico` + medida + tiradores)
 * en un lienzo ya renderizado que no lo declaró (`renderLienzoElastico`), para que el
 * borde ámbar sea estirable en CUALQUIER planta antes y después de guardar.
 */
export function inyectarPerimetroElastico(html: string, duenio: DuenioPerimetro | null): string {
  const marca = 'data-lienzo-pu>';
  if (!html.includes(marca)) return html;
  return html.replace(marca, `data-lienzo-pu data-perimetro-elastico${estiloPerimetro(duenio)}>${tiradoresPerimetro()}`);
}

/** Aviso opcional de guardado (los consumidores refrescan su pantalla). */
export interface OpcionesPerimetro {
  /** Subárbol donde viven los tiradores (el panel del plano). */
  scope: ParentNode;
  /** Id del dueño persistente de la medida (Ubicación perímetro). */
  id?: () => string | null;
  /** Garantiza el dueño antes de persistir (crea «Departamento» si falta). */
  asegurar?: () => Promise<string | null>;
  /** Persistencia estándar del proyecto (PUT /api/ubicaciones/{id}/). */
  adaptador?: AdaptadorEspacios;
  /** Persistencia alternativa para lienzos sin Ubicación propia. */
  guardar?: (id: string, medida: MedidaPerimetro) => Promise<boolean>;
  /** Callback posterior al guardado (refresco de la pantalla). */
  alGuardar?: () => void;
}

/** Persistencia canónica de la MEDIDA del perímetro (px) para un adaptador dado. */
export const guardarMedidaCon =
  (adaptador: AdaptadorEspacios) =>
  (id: string, medida: MedidaPerimetro): Promise<boolean> =>
    adaptador.guardarItem(id, { ui_width: `${medida.ancho}px`, ui_height: `${medida.alto}px` });

/** Tolerancia de arrastre: < 3 px = clic accidental, sin PUT (evita ruido). */
const UMBRAL_ARRASTRE_PX = 3;

/** Persiste la medida general del plano con un PUT limpio (px). */
async function persistirMedida(opts: OpcionesPerimetro, medida: MedidaPerimetro): Promise<boolean> {
  const id = opts.id?.() ?? (await opts.asegurar?.()) ?? null;
  if (!id) {
    toast('⚠️ No se pudo preparar el contenedor del plano para guardar su tamaño.');
    return false;
  }
  if (opts.guardar) return opts.guardar(id, medida);
  if (!opts.adaptador) return false;
  return guardarMedidaCon(opts.adaptador)(id, medida);
}

/** Aplica la medida en caliente sobre los estilos inline del perímetro. */
function aplicarMedida(lienzo: HTMLElement, medida: MedidaPerimetro): void {
  lienzo.style.width = `${medida.ancho}px`;
  lienzo.style.height = `${medida.alto}px`;
}

// =============================================================================
// GEOMETRÍA ABSOLUTA DEL PERÍMETRO (las tarjetas NO se deforman al estirar)
// -----------------------------------------------------------------------------
// El marco ámbar es el sistema de coordenadas (%) de las tarjetas: REBASE ABSOLUTO
// Y ADITIVO —cada tarjeta conserva sus PÍXELES y el terreno nuevo queda LIBRE—.
// =============================================================================

/** Caja en % del lienzo leída de los estilos inline de una tarjeta. */
interface CajaPct {
  left: number;
  top: number;
  width: number;
  height: number;
}

const red2 = (n: number): number => Math.round(n * 100) / 100;

function pctDe(valor: string | null | undefined): number | null {
  const m = /^(-?\d{1,3}(?:\.\d+)?)%$/.exec((valor ?? '').trim());
  return m ? parseFloat(m[1]) : null;
}

/** Lee la caja (%) de una tarjeta; null si su geometría no está en % todavía. */
function leerCajaPct(card: HTMLElement): CajaPct | null {
  const left = pctDe(card.style.left);
  const top = pctDe(card.style.top);
  const width = pctDe(card.style.width);
  const height = pctDe(card.style.height);
  if (left === null || top === null || width === null || height === null) return null;
  return { left, top, width, height };
}

/** Tarjetas editables de primer nivel del lienzo (bloques fusionados + sueltas). */
function tarjetasDeLienzo(lienzo: HTMLElement): HTMLElement[] {
  return Array.from(
    lienzo.querySelectorAll<HTMLElement>(':scope > [data-inplace-card][data-id]'),
  );
}

/** Snapshot inmutable de una tarjeta al iniciar el gesto (base del rebase). */
interface TarjetaBase {
  card: HTMLElement;
  caja: CajaPct;
  tiles: Array<{ el: SVGElement; data: Record<string, string> }>;
}

/** Captura la geometría ORIGINAL de una tarjeta (caja + memorias de sus tiles). */
function capturarTarjeta(card: HTMLElement): TarjetaBase | null {
  const caja = leerCajaPct(card);
  if (!caja) return null;
  const tiles = Array.from(card.querySelectorAll<SVGElement>('[data-tile-id]')).map((el) => ({
    el,
    data: {
      tileLeft: el.dataset.tileLeft ?? '',
      tileTop: el.dataset.tileTop ?? '',
      tileWidth: el.dataset.tileWidth ?? '',
      tileHeight: el.dataset.tileHeight ?? '',
    },
  }));
  return { card, caja, tiles };
}

/** Reexpresa la tarjeta conservando sus PÍXELES (base: el snapshot original). */
function rebasarTarjeta(t: TarjetaBase, fx: number, fy: number): CajaPct {
  const caja: CajaPct = {
    left: red2(t.caja.left * fx),
    top: red2(t.caja.top * fy),
    width: red2(t.caja.width * fx),
    height: red2(t.caja.height * fy),
  };
  t.card.style.left = `${caja.left}%`;
  t.card.style.top = `${caja.top}%`;
  t.card.style.width = `${caja.width}%`;
  t.card.style.height = `${caja.height}%`;
  // El bloque fusionado guarda las memorias data-tile-* en % del lienzo: se
  // reexpresan desde el snapshot para que la persistencia del grupo sea coherente.
  t.tiles.forEach(({ el, data }) => {
    const num = (s: string): number => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : Number.NaN;
    };
    const set = (k: string, v: number): void => {
      if (Number.isFinite(v)) el.dataset[k] = String(red2(v));
    };
    set('tileLeft', num(data.tileLeft) * fx);
    set('tileTop', num(data.tileTop) * fy);
    set('tileWidth', num(data.tileWidth) * fx);
    set('tileHeight', num(data.tileHeight) * fy);
  });
  return caja;
}

/** Rollback visual: restaura la geometría EXACTA capturada al iniciar el gesto. */
function restaurarTarjeta(t: TarjetaBase): void {
  t.card.style.left = `${t.caja.left}%`;
  t.card.style.top = `${t.caja.top}%`;
  t.card.style.width = `${t.caja.width}%`;
  t.card.style.height = `${t.caja.height}%`;
  t.tiles.forEach(({ el, data }) => {
    el.dataset.tileLeft = data.tileLeft;
    el.dataset.tileTop = data.tileTop;
    el.dataset.tileWidth = data.tileWidth;
    el.dataset.tileHeight = data.tileHeight;
  });
}

/** true si la tarjeta es un bloque fusionado (tiles SVG internos). */
function esBloqueFusionado(card: HTMLElement): boolean {
  return Boolean(card.dataset.fusionGrupo) || Boolean(card.querySelector('[data-tile-id]'));
}

/**
 * Persiste la geometría rebasada (ítem suelto → PUT propio; bloque → PUT de grupo).
 */
async function persistirHijosRebasados(
  opts: OpcionesPerimetro,
  tarjetas: Array<{ card: HTMLElement; caja: CajaPct }>,
): Promise<void> {
  const adaptador = opts.adaptador;
  if (!adaptador || !tarjetas.length) return;
  await Promise.all(
    tarjetas.map(async ({ card, caja }) => {
      const id = card.dataset.id ?? '';
      if (!id) return;
      if (esBloqueFusionado(card)) {
        const partes = Array.from(card.querySelectorAll<SVGElement>('[data-tile-id]'))
          .map((t) => ({
            id: t.dataset.tileId ?? '',
            ui_left: `${t.dataset.tileLeft ?? '0'}%`,
            ui_top: `${t.dataset.tileTop ?? '0'}%`,
            ui_width: `${t.dataset.tileWidth ?? '0'}%`,
            ui_height: `${t.dataset.tileHeight ?? '0'}%`,
          }))
          .filter((p) => p.id);
        if (partes.length) await adaptador.guardarGrupo(id, { partes });
        return;
      }
      await adaptador.guardarItem(id, {
        ui_left: `${caja.left}%`,
        ui_top: `${caja.top}%`,
        ui_width: `${caja.width}%`,
        ui_height: `${caja.height}%`,
      });
    }),
  );
}

/**
 * Conecta los tiradores del perímetro: arrastre elástico en caliente (ancho,
 * alto o ambos según el tirador) y UN ÚNICO PUT al soltar. El ancho se acota al
 * marco visible para que el plano jamás desborde su panel.
 */
export function conectarPerimetroElastico(opts: OpcionesPerimetro): void {
  opts.scope.querySelectorAll<HTMLElement>('[data-perimetro-resize]').forEach((handle) => {
    handle.addEventListener('pointerdown', (evDown) => {
      const e = evDown as PointerEvent;
      if (e.button !== 0) return;
      const lienzo = handle.closest<HTMLElement>('[data-lienzo-pu]');
      if (!lienzo) return;
      e.preventDefault();
      e.stopPropagation();
      const modo = handle.dataset.perimetroResize ?? 'ambos';
      const rect = lienzo.getBoundingClientRect();
      const marco = lienzo.parentElement?.getBoundingClientRect();
      const maxAncho = Math.max(
        PERIMETRO_MIN_ANCHO,
        Math.floor(marco?.width ?? PERIMETRO_MAX_ANCHO),
      );
      const base: MedidaPerimetro = { ancho: rect.width, alto: rect.height };
      // Sistema de coordenadas real de las tarjetas: la PADDING BOX del lienzo
      // (clientWidth/Height descuenta el borde). El % de ui_* se mide contra ella.
      const bordeX = Math.max(0, rect.width - lienzo.clientWidth);
      const bordeY = Math.max(0, rect.height - lienzo.clientHeight);
      const baseInterno = {
        ancho: Math.max(1, rect.width - bordeX),
        alto: Math.max(1, rect.height - bordeY),
      };
      // Snapshot ORIGINAL de las tarjetas: base absoluta del rebase (nunca deforma).
      const tarjetas = tarjetasDeLienzo(lienzo)
        .map((card) => capturarTarjeta(card))
        .filter((t): t is TarjetaBase => t !== null);
      // Caja REBASADA vigente de cada tarjeta (es la que se persiste al soltar).
      const resultado = tarjetas.map((t) => ({ card: t.card, caja: t.caja }));
      const x0 = e.clientX;
      const y0 = e.clientY;
      let medida = base;
      let movido = false;
      lienzo.classList.add('pu-perimetro-redimensionando');
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* sin captura: el seguimiento continúa igual */
      }

      const enMovimiento = (m: PointerEvent): void => {
        m.preventDefault();
        if (
          Math.abs(m.clientX - x0) > UMBRAL_ARRASTRE_PX ||
          Math.abs(m.clientY - y0) > UMBRAL_ARRASTRE_PX
        ) {
          movido = true;
        }
        medida = acotarMedida({
          ancho:
            modo === 'alto' ? base.ancho : Math.min(base.ancho + (m.clientX - x0), maxAncho),
          alto: modo === 'ancho' ? base.alto : base.alto + (m.clientY - y0),
        });
        aplicarMedida(lienzo, medida);
        // REBASE ABSOLUTO Y ADITIVO: las tarjetas conservan sus PÍXELES (quedan
        // quietas) y el terreno nuevo se agrega libre a la derecha/abajo.
        const fx = baseInterno.ancho / Math.max(1, medida.ancho - bordeX);
        const fy = baseInterno.alto / Math.max(1, medida.alto - bordeY);
        tarjetas.forEach((t, i) => {
          resultado[i].caja = rebasarTarjeta(t, fx, fy);
        });
      };

      const alSoltar = async (): Promise<void> => {
        handle.removeEventListener('pointermove', enMovimiento);
        handle.removeEventListener('pointerup', alSoltar);
        handle.removeEventListener('pointercancel', alSoltar);
        lienzo.classList.remove('pu-perimetro-redimensionando');
        if (!movido) return;
        const ok = await persistirMedida(opts, medida);
        if (!ok) {
          aplicarMedida(lienzo, base);
          tarjetas.forEach((t) => restaurarTarjeta(t));
          toast('❌ No se pudo guardar el tamaño del plano. Volvió al anterior.');
          return;
        }
        // La geometría rebasada se persiste para que el re-render de la pantalla
        // (que relee del backend) conserve EXACTAMENTE lo modelado, sin deformar.
        await persistirHijosRebasados(opts, resultado);
        toast(`📐 Plano redimensionado a ${medida.ancho} × ${medida.alto} px.`);
        opts.alGuardar?.();
      };

      handle.addEventListener('pointermove', enMovimiento);
      handle.addEventListener('pointerup', alSoltar);
      handle.addEventListener('pointercancel', alSoltar);
    });
  });
}

