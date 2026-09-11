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
  '[data-separar]',
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
  const total = await persistirDimensiones();
  aplicarModo('navegacion');
  toast(
    total > 0
      ? `💾 ${total} medida(s) guardada(s) · grilla bloqueada: el clic ahora navega por portales.`
      : '💾 Grilla bloqueada: el clic ahora navega por portales.',
  );
}


/** Recurso REST del lienzo al que pertenece una tarjeta (para el PUT de medidas). */
function recursoDeCarta(carta: HTMLElement): 'ubicaciones' | 'contenedores' | null {
  if (carta.closest('#visorHabitacion') || carta.closest('#visorContenedorGrande')) return 'contenedores';
  if (carta.closest('#mapaEstokPanel')) return 'ubicaciones';
  return null;
}

/**
 * PUT de ui_width/ui_height de cada tarjeta editable con estilo inline efectivo.
 * Se omiten los bloques fusionados (su geometría se consolida por su endpoint de
 * grupo) y las tarjetas sin recurso conocido. Idempotente: tras un PUT exitoso
 * se memoriza la medida en data-ui-* para no volver a enviarla sin cambios.
 */
async function persistirDimensiones(): Promise<number> {
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
  return total;
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
