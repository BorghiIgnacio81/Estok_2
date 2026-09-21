// =============================================================================
// MODO EDICIÓN ⟷ MODO NAVEGACIÓN DE LOS PLANOS
// -----------------------------------------------------------------------------
// Cada plano (panel) expone en su cabezal dos botones intercambiables:
//   "✏️ Editar"  → habilita la edición in-place de la grilla (renombrar, arrastrar
//                  para reacomodar, fusionar por checkbox y resizing elástico).
//   "💾 Guardar" → BLOQUEA la grilla: persiste las dimensiones ui_width/ui_height
//                  vía PUT a la API de Django y deja el clic libre para actuar
//                  estrictamente como disparador (PORTAL) de navegación.
//
// El bloqueo se implementa SIN tocar los motores de edición: en modo navegación
// se intercepta el pointerdown en fase de CAPTURA sobre los asideros de edición
// (arrastre/resize/fusión) y se ocultan esos controles vía CSS
// (almacenamiento-portales.css). El clic sobre la tarjeta queda intacto para que
// el portal de niveles pueda dispararse.
//
// Estado global del documento (una sola fuente de verdad para ambos paneles) y
// broadcast `estok:modo-lienzo` para cualquier módulo que quiera reaccionar.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { toast } from './mapaJerarquico';
import { pctValor } from './mapaPlantaUnica';
import { autoAjustarFilas } from './autoAjusteFilas';
import type { CajaFila } from './autoAjusteFilas';

export type ModoLienzo = 'navegacion' | 'edicion';

let modo: ModoLienzo = 'navegacion';

/** Modo vigente del lienzo (navegación por defecto). */
export function modoLienzoActual(): ModoLienzo {
  return modo;
}

/** Selectores de los asideros que SOLO tienen sentido en modo edición. */
const SELECTOR_EDICION = [
  '[data-libre-drag]',
  '[data-libre-resize]',
  '[data-grupo-resize]',
  '[data-inplace-resize]',
  '[data-fusion-check]',
  '[data-eliminar-grupo]',
  // Tiradores del contenedor perimetral (ancho/alto del plano completo).
  '[data-perimetro-resize]',
].join(',');

/**
 * Arranca el controlador de modo: conecta los botones de TODOS los cabezales y
 * deja el lienzo naciendo en modo NAVEGACIÓN (bloqueado, clic = portal).
 */
export function iniciarModoLienzo(): void {
  document.querySelectorAll<HTMLElement>('[data-modo-editar]').forEach((btn) => {
    btn.addEventListener('click', () => aplicarModo('edicion'));
  });
  document.querySelectorAll<HTMLElement>('[data-modo-guardar]').forEach((btn) => {
    btn.addEventListener('click', () => void guardarYBloquear());
  });
  // Captura: en modo navegación el pointerdown de un asidero de edición se
  // detiene antes de llegar al motor de arrastre (el 'click' del portal queda
  // intacto porque es un evento distinto).
  document.addEventListener('pointerdown', bloquearEdicion, true);
  aplicarModo('navegacion');
}

/** Cambia el modo y sincroniza clases, botones y suscriptores. */
export function aplicarModo(nuevo: ModoLienzo): void {
  modo = nuevo;
  document.body.classList.toggle('modo-edicion', nuevo === 'edicion');
  document.body.classList.toggle('modo-navegacion', nuevo === 'navegacion');
  document.querySelectorAll<HTMLElement>('[data-modo-editar]').forEach((el) => {
    el.classList.toggle('hidden', nuevo === 'edicion');
  });
  document.querySelectorAll<HTMLElement>('[data-modo-guardar]').forEach((el) => {
    el.classList.toggle('hidden', nuevo !== 'edicion');
  });
  window.dispatchEvent(new CustomEvent('estok:modo-lienzo', { detail: { modo: nuevo } }));
}

function bloquearEdicion(ev: Event): void {
  if (modo !== 'navegacion') return;
  const objetivo = ev.target as HTMLElement | null;
  if (!objetivo || !objetivo.closest(SELECTOR_EDICION)) return;
  ev.stopPropagation();
}

/** Persiste las medidas y bloquea la grilla (el clic pasa a ser portal). */
async function guardarYBloquear(): Promise<void> {
  const { medidas, filas } = await persistirDimensiones();
  aplicarModo('navegacion');
  const detalle = [`💾 ${medidas} medida(s) guardada(s)`];
  if (filas > 0) detalle.push(`📐 ${filas} fila(s) auto-ajustada(s) al 100%`);
  if (medidas === 0 && filas === 0) detalle.length = 0;
  toast(
    `${detalle.length ? `${detalle.join(' · ')} · ` : '💾 '}grilla bloqueada: el clic ahora navega por portales.`,
  );
}


/** Recurso REST del lienzo al que pertenece una tarjeta (para el PUT de medidas). */
function recursoDeCarta(carta: HTMLElement): 'ubicaciones' | 'contenedores' | null {
  if (carta.closest('#visorHabitacion') || carta.closest('#visorContenedorGrande')) return 'contenedores';
  if (carta.closest('#mapaEstokPanel')) return 'ubicaciones';
  return null;
}

/**
 * Cajas elásticas (% del lienzo) de las tarjetas editables de un canvas.
 * Solo se consideran los hijos directos: las tarjetas anidadas de otro lienzo
 * (p. ej. el editor interno de un mueble) pertenecen a su propia fila.
 */
function cajasDelLienzo(lienzo: HTMLElement): { cartas: HTMLElement[]; cajas: CajaFila[] } {
  const cartas = Array.from(
    lienzo.querySelectorAll<HTMLElement>(':scope > [data-inplace-card][data-id]'),
  );
  const cajas = cartas.map((carta) => ({
    left: pctValor(carta.style.left, 0),
    top: pctValor(carta.style.top, 0),
    width: pctValor(carta.style.width, 28),
    height: pctValor(carta.style.height, 24),
  }));
  return { cartas, cajas };
}

/**
 * FÍSICA DE LAYOUT: absorbe el hueco residual de las filas prácticamente llenas
 * (ocupación ≥98% y <100%) estirando proporcionalmente sus rectángulos hasta
 * encajar exactos contra las paredes perimetrales (100%). Se aplica sobre los
 * estilos inline ANTES del PUT, de modo que las dimensiones corregidas son las
 * que se persisten en Django. Los lienzos ocultos no se tocan.
 */
function autoAjustarLienzos(): number {
  let filas = 0;
  document.querySelectorAll<HTMLElement>('[data-lienzo-pu]').forEach((lienzo) => {
    if (lienzo.getBoundingClientRect().height <= 0) return;
    const { cartas, cajas } = cajasDelLienzo(lienzo);
    const resultado = autoAjustarFilas(cajas);
    if (!resultado.filas) return;
    resultado.indices.forEach((indice, k) => {
      const carta = cartas[indice];
      if (carta) carta.style.width = `${resultado.anchos[k]}%`;
    });
    filas += resultado.filas;
  });
  return filas;
}

/**
 * PUT de ui_width/ui_height de cada tarjeta editable con estilo inline efectivo.
 * Se omiten los bloques fusionados (su geometría se consolida por su endpoint de
 * grupo) y las tarjetas sin recurso conocido. Idempotente: tras un PUT exitoso
 * se memoriza la medida en data-ui-* para no volver a enviarla sin cambios.
 */
async function persistirDimensiones(): Promise<{ medidas: number; filas: number }> {
  // 1) Física de layouts ANTES de leer: el 98%+ se estira al 100% (paredes).
  const filas = autoAjustarLienzos();

  const cartas = document.querySelectorAll<HTMLElement>('[data-inplace-card][data-id]');
  const tareas: Promise<void>[] = [];
  let total = 0;

  cartas.forEach((carta) => {
    if (carta.dataset.fusionGrupo) return;
    const id = carta.dataset.id ?? '';
    if (!id) return;
    const recurso = recursoDeCarta(carta);
    if (!recurso) return;
    const ancho = carta.style.width;
    const alto = carta.style.height;
    if (!ancho && !alto) return;

    const body: Record<string, unknown> = {};
    if (ancho && ancho !== (carta.dataset.uiWidth ?? '')) body.ui_width = ancho;
    if (alto && alto !== (carta.dataset.uiHeight ?? '')) body.ui_height = alto;
    if (!Object.keys(body).length) return;

    total += 1;
    tareas.push(
      putJson(`${API_BASE_URL}/${recurso}/${id}/`, body).then((ok) => {
        if (!ok) return;
        if (body.ui_width) carta.dataset.uiWidth = String(body.ui_width);
        if (body.ui_height) carta.dataset.uiHeight = String(body.ui_height);
      }),
    );
  });

  await Promise.all(tareas);
  return { medidas: total, filas };
}

async function putJson(url: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'PUT',
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
