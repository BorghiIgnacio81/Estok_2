// =============================================================================
// PLANTA ÚNICA - INTERACCIÓN Y PERSISTENCIA EN CALIENTE
// -----------------------------------------------------------------------------
// Motor de edición del Modo Planta Única (departamento de 1 sola planta).
// Reutiliza la auth centralizada (services/auth) y el rename in-place del motor
// recursivo (lienzoInteractivo.conectarRenombradoEnVivo). Aporta:
//   - Inyección elástica de espacios libres (botón /nueva ubicacion.png).
//   - Arrastre libre por todo el lienzo  → PUT ui_left / ui_top.
//   - Resizing elástico desde la esquina → PUT ui_width / ui_height.
//   - Selección múltiple + "🔗 Fusionar Espacios" → POST /fusionar/ (grupo en L).
// Todo persiste de forma REAL en PostgreSQL vía la API multi-tenant.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { guardarUbicacion, toast } from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';
import { conectarRenombradoEnVivo } from './lienzoInteractivo';
import { pctValor } from './mapaPlantaUnica';

const ANCHO_MIN = 8;
const ALTO_MIN = 8;

function acotar(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** POST JSON con auth centralizada (JWT + X-Estok-Id). Devuelve true si fue 2xx. */
async function postJson(url: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

export interface OpcionesPlantaUnica {
  scope: ParentNode;
  rooms: () => UbicacionPlano[];
  apartamentoId: () => string | null;
  /** Crea el contenedor «Departamento» si aún no existe y devuelve su id. */
  asegurarApartamento: () => Promise<string | null>;
  notificarCambios: () => void;
}

/** Conecta TODAS las capacidades de edición del lienzo de Planta Única. */
export function conectarPlantaUnica(opts: OpcionesPlantaUnica): void {
  conectarRenombrado(opts);
  conectarCreacion(opts);
  conectarArrastreLibre(opts);
  conectarResizeLibre(opts);
  conectarSeleccionYFusion(opts);
}

// =============================================================================
// CLIC PARA RENOMBRAR (in-place, reutiliza el motor recursivo)
// =============================================================================

function conectarRenombrado(opts: OpcionesPlantaUnica): void {
  conectarRenombradoEnVivo(opts.scope, async (id, nombre) => {
    const room = opts.rooms().find((r) => r.id === id);
    if (!room) return false;
    if (nombre === room.nombre) return true;
    const ok = await guardarUbicacion(id, { nombre });
    if (!ok) {
      toast('❌ No se pudo renombrar el espacio.');
      return false;
    }
    room.nombre = nombre;
    toast(`✅ Espacio renombrado a «${nombre}».`);
    opts.notificarCambios();
    return true;
  });
}

// =============================================================================
// INYECCIÓN ELÁSTICA DE HABITACIONES LIBRES
// =============================================================================

function conectarCreacion(opts: OpcionesPlantaUnica): void {
  opts.scope.querySelectorAll<HTMLElement>('[data-nueva-ubicacion]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.creando === '1') return;
      btn.dataset.creando = '1';
      btn.classList.add('pu-creando');
      try {
        const apartamento = opts.apartamentoId() ?? (await opts.asegurarApartamento());
        if (!apartamento) {
          toast('⚠️ No se pudo preparar el contenedor del departamento.');
          return;
        }
        const n = opts.rooms().length;
        const izquierda = 6 + (n % 5) * 12;
        const arriba = 8 + (n % 4) * 16;
        const ok = await postJson(`${API_BASE_URL}/ubicaciones/`, {
          nombre: `Espacio ${n + 1}`,
          parent_ubicacion: apartamento,
          piso: 'PLANTA_BAJA',
          ui_left: `${izquierda}%`,
          ui_top: `${arriba}%`,
          ui_width: '28%',
          ui_height: '24%',
        });
        if (!ok) {
          toast('❌ No se pudo inyectar la ubicación libre.');
          return;
        }
        toast('✅ Espacio libre inyectado. Arrastralo para acomodarlo.');
        opts.notificarCambios();
      } finally {
        delete btn.dataset.creando;
        btn.classList.remove('pu-creando');
      }
    });
  });
}

// =============================================================================
// ARRASTRE LIBRE POR TODO EL LIENZO (persiste ui_left / ui_top)
// =============================================================================

function conectarArrastreLibre(opts: OpcionesPlantaUnica): void {
  opts.scope.querySelectorAll<HTMLElement>('[data-libre-drag]').forEach((card) => {
    card.addEventListener('pointerdown', (evDown) => {
      const e = evDown as PointerEvent;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-fusion-check],[data-inplace-renombrar],[data-libre-resize],[data-separar]')) return;
      const lienzo = card.closest<HTMLElement>('[data-lienzo-pu]');
      if (!lienzo) return;
      e.preventDefault();
      const rect = lienzo.getBoundingClientRect();
      const x0 = e.clientX;
      const y0 = e.clientY;
      const baseLeft = pctValor(card.style.left, 0);
      const baseTop = pctValor(card.style.top, 0);
      const ancho = pctValor(card.style.width, 28);
      const alto = pctValor(card.style.height, 24);
      let arrastrado = false;
      card.classList.add('pu-arrastrando');
      try {
        card.setPointerCapture(e.pointerId);
      } catch {
        /* sin captura: el seguimiento continúa igual */
      }

      const enMovimiento = (m: PointerEvent): void => {
        m.preventDefault();
        arrastrado = true;
        const dL = ((m.clientX - x0) / Math.max(1, rect.width)) * 100;
        const dT = ((m.clientY - y0) / Math.max(1, rect.height)) * 100;
        card.style.left = `${acotar(baseLeft + dL, 0, 100 - ancho)}%`;
        card.style.top = `${acotar(baseTop + dT, 0, 100 - alto)}%`;
      };

      const alSoltar = (): void => {
        card.removeEventListener('pointermove', enMovimiento);
        card.removeEventListener('pointerup', alSoltar);
        card.removeEventListener('pointercancel', alSoltar);
        card.classList.remove('pu-arrastrando');
        if (!arrastrado) return;
        // Delta REALMENTE aplicado (ya acotado al lienzo): así el grupo fusionado
        // conserva su geometría relativa al moverse en bloque.
        const dLa = pctValor(card.style.left, baseLeft) - baseLeft;
        const dTa = pctValor(card.style.top, baseTop) - baseTop;
        if (card.dataset.fusionGrupo) {
          void persistirGrupo(card, dLa, dTa, opts);
        } else {
          void persistirSuelto(card, baseLeft, baseTop, ancho, alto, dLa, dTa, opts);
        }
      };

      card.addEventListener('pointermove', enMovimiento);
      card.addEventListener('pointerup', alSoltar);
      card.addEventListener('pointercancel', alSoltar);
    });
  });
}

async function persistirSuelto(
  card: HTMLElement,
  baseLeft: number,
  baseTop: number,
  ancho: number,
  alto: number,
  dL: number,
  dT: number,
  opts: OpcionesPlantaUnica,
): Promise<void> {
  const id = card.dataset.id ?? '';
  if (!id) return;
  const left = Math.round(acotar(baseLeft + dL, 0, 100 - ancho));
  const top = Math.round(acotar(baseTop + dT, 0, 100 - alto));
  const ok = await guardarUbicacion(id, { ui_left: `${left}%`, ui_top: `${top}%` });
  if (!ok) {
    toast('❌ No se pudo guardar la posición del espacio.');
    return;
  }
  const room = opts.rooms().find((r) => r.id === id);
  if (room) {
    room.ui_left = `${left}%`;
    room.ui_top = `${top}%`;
  }
  toast(`✅ Espacio reubicado en X:${left}% · Y:${top}%.`);
  opts.notificarCambios();
}

async function persistirGrupo(
  card: HTMLElement,
  dL: number,
  dT: number,
  opts: OpcionesPlantaUnica,
): Promise<void> {
  const tiles = Array.from(card.querySelectorAll<HTMLElement>('[data-tile-id]'));
  let todoOk = true;
  for (const tile of tiles) {
    const id = tile.dataset.tileId ?? '';
    if (!id) continue;
    const baseL = parseFloat(tile.dataset.tileLeft || '0');
    const baseT = parseFloat(tile.dataset.tileTop || '0');
    const left = Math.round(acotar(baseL + dL, 0, 100));
    const top = Math.round(acotar(baseT + dT, 0, 100));
    const ok = await guardarUbicacion(id, { ui_left: `${left}%`, ui_top: `${top}%` });
    if (!ok) {
      todoOk = false;
      continue;
    }
    const room = opts.rooms().find((r) => r.id === id);
    if (room) {
      room.ui_left = `${left}%`;
      room.ui_top = `${top}%`;
    }
  }
  toast(todoOk ? '✅ Espacio fusionado reubicado.' : '⚠️ Algunos módulos no se pudieron reposicionar.');
  opts.notificarCambios();
}

// =============================================================================
// RESIZING ELÁSTICO (persiste ui_width / ui_height en %)
// =============================================================================

function conectarResizeLibre(opts: OpcionesPlantaUnica): void {
  opts.scope.querySelectorAll<HTMLElement>('[data-libre-resize]').forEach((handle) => {
    handle.addEventListener('pointerdown', (evDown) => {
      const e = evDown as PointerEvent;
      if (e.button !== 0) return;
      const card = handle.closest<HTMLElement>('[data-inplace-card]');
      const lienzo = handle.closest<HTMLElement>('[data-lienzo-pu]');
      // Un espacio fusionado mueve en bloque, no se redimensiona por módulo.
      if (!card || !lienzo || card.dataset.fusionGrupo) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = lienzo.getBoundingClientRect();
      const x0 = e.clientX;
      const y0 = e.clientY;
      const baseLeft = pctValor(card.style.left, 0);
      const baseTop = pctValor(card.style.top, 0);
      const baseW = pctValor(card.style.width, 28);
      const baseH = pctValor(card.style.height, 24);
      const topeW = Math.max(ANCHO_MIN, 100 - baseLeft);
      const topeH = Math.max(ALTO_MIN, 100 - baseTop);
      let redimensionado = false;
      card.classList.add('pu-redimensionando');
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* sin captura: el seguimiento continúa igual */
      }

      const enMovimiento = (m: PointerEvent): void => {
        m.preventDefault();
        redimensionado = true;
        const dW = ((m.clientX - x0) / Math.max(1, rect.width)) * 100;
        const dH = ((m.clientY - y0) / Math.max(1, rect.height)) * 100;
        card.style.width = `${acotar(baseW + dW, ANCHO_MIN, topeW)}%`;
        card.style.height = `${acotar(baseH + dH, ALTO_MIN, topeH)}%`;
      };

      const alSoltar = async (): Promise<void> => {
        handle.removeEventListener('pointermove', enMovimiento);
        handle.removeEventListener('pointerup', alSoltar);
        handle.removeEventListener('pointercancel', alSoltar);
        card.classList.remove('pu-redimensionando');
        if (!redimensionado) return;
        const id = card.dataset.id ?? '';
        if (!id) return;
        const w = Math.round(pctValor(card.style.width, baseW));
        const h = Math.round(pctValor(card.style.height, baseH));
        const ok = await guardarUbicacion(id, { ui_width: `${w}%`, ui_height: `${h}%` });
        if (!ok) {
          toast('❌ No se pudo guardar el nuevo tamaño.');
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

// =============================================================================
// SELECCIÓN MÚLTIPLE + MOTOR DE FUSIÓN (espacios en "L")
// =============================================================================

function conectarSeleccionYFusion(opts: OpcionesPlantaUnica): void {
  const seleccion = new Set<string>();
  const btnFusionar = opts.scope.querySelector<HTMLButtonElement>('[data-fusionar]');
  const contador = opts.scope.querySelector<HTMLElement>('[data-fusion-contador]');

  const refrescar = (): void => {
    if (contador) contador.textContent = `${seleccion.size} seleccionado${seleccion.size === 1 ? '' : 's'}`;
    if (btnFusionar) btnFusionar.disabled = seleccion.size < 2;
  };

  opts.scope.querySelectorAll<HTMLInputElement>('[data-fusion-check]').forEach((chk) => {
    chk.addEventListener('change', () => {
      const id = chk.dataset.id ?? '';
      if (!id) return;
      if (chk.checked) seleccion.add(id);
      else seleccion.delete(id);
      refrescar();
    });
  });
  refrescar();

  btnFusionar?.addEventListener('click', async () => {
    const ids = Array.from(seleccion);
    if (ids.length < 2) return;
    const [base, ...resto] = ids;
    btnFusionar.disabled = true;
    const ok = await postJson(`${API_BASE_URL}/ubicaciones/${base}/fusionar/`, {
      ubicacion_ids: resto,
    });
    if (!ok) {
      toast('❌ No se pudieron fusionar los espacios.');
      refrescar();
      return;
    }
    toast('🔗 Espacios fusionados en un único espacio en «L».');
    opts.notificarCambios();
  });

  opts.scope.querySelectorAll<HTMLElement>('[data-separar]').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id ?? '';
      if (!id) return;
      const ok = await postJson(`${API_BASE_URL}/ubicaciones/${id}/separar/`, {});
      if (!ok) {
        toast('❌ No se pudo separar el espacio fusionado.');
        return;
      }
      toast('✂️ Espacio separado en rectángulos independientes.');
      opts.notificarCambios();
    });
  });
}
