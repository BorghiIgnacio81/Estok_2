// =============================================================================
// PERÍMETRO ELÁSTICO DEL PLANO - contenedor perimetral redimensionable
// -----------------------------------------------------------------------------
// El recuadro texturizado que envuelve TODOS los ambientes (`.planta-unica-lienzo`)
// deja de ser un contenedor rígido: en MODO EDICIÓN expone tiradores en el borde
// derecho, en el borde inferior y en la esquina inferior derecha para ajustar el
// ancho y el alto del plano COMPLETO de la casa/departamento.
//
// La medida se aplica EN CALIENTE sobre los estilos inline (feedback inmediato
// mientras se arrastra) y al soltar se persiste con UN ÚNICO PUT
// (ui_width/ui_height en px) sobre la Ubicación que oficia de perímetro: la
// división «Departamento» en Modo Planta Única, o el contenedor padre del lienzo
// en los visores anidados. Nunca se escribe un valor «auto».
//
// Módulo 100% geometría + DOM: la persistencia entra por `AdaptadorEspacios`
// (auth centralizada) o por el callback `guardar` del consumidor, sin duplicar
// fetch ni headers en cada pantalla.
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

/**
 * Tolerancia de arrastre: por debajo de 3 px el gesto se considera un clic
 * accidental y NO se dispara ningún PUT (evita escrituras ruidosas).
 */
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
  return opts.adaptador.guardarItem(id, {
    ui_width: `${medida.ancho}px`,
    ui_height: `${medida.alto}px`,
  });
}

/** Aplica la medida en caliente sobre los estilos inline del perímetro. */
function aplicarMedida(lienzo: HTMLElement, medida: MedidaPerimetro): void {
  lienzo.style.width = `${medida.ancho}px`;
  lienzo.style.height = `${medida.alto}px`;
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
          toast('❌ No se pudo guardar el tamaño del plano. Volvió al anterior.');
          return;
        }
        toast(`📐 Plano redimensionado a ${medida.ancho} × ${medida.alto} px.`);
        opts.alGuardar?.();
      };

      handle.addEventListener('pointermove', enMovimiento);
      handle.addEventListener('pointerup', alSoltar);
      handle.addEventListener('pointercancel', alSoltar);
    });
  });
}

