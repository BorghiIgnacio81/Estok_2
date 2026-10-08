// =============================================================================
// MODO EDICIÓN ⟷ MODO NAVEGACIÓN DE LOS PLANOS
// -----------------------------------------------------------------------------
// Cada plano (panel) expone en su cabezal dos botones intercambiables:
//   "✏️ Editar"  → habilita la edición in-place de la grilla (renombrar, arrastrar
//                  para reacomodar, fusionar por checkbox y resizing elástico).
//                  El arrastre es LIBRE: no hay bloqueo ni reacomodo en caliente.
//   "💾 Guardar" → ÚNICO punto donde corre la física del plano: compactación
//                  inteligente (superposición → zona vacía más cercana; brechas
//                  mínimas → estirado simétrico; huecos grandes → intactos) y
//                  PUT de la geometría corregida a la API de Django. Después
//                  BLOQUEA la grilla y deja el clic libre para actuar
//                  estrictamente como disparador (PORTAL) de navegación.
//                  El motor vive en ./plantaGuardado + ./compactacionPlanta.
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

import { toast } from './mapaJerarquico';
import { compactarYGuardarLienzos } from './plantaGuardado';

export type ModoLienzo = 'navegacion' | 'edicion';

let modo: ModoLienzo = 'navegacion';

/** Modo vigente del lienzo (navegación por defecto). */
export function modoLienzoActual(): ModoLienzo {
  return modo;
}

/** Botones de modo: CUALQUIER barra de comandos los declara con estos atributos. */
const SEL_EDITAR = '[data-modo-editar]';
const SEL_GUARDAR = '[data-modo-guardar]';

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
 * Sincroniza la visibilidad de TODOS los botones de modo del documento con el
 * modo vigente. Idempotente y re-invocable: cuando la cascada de Portales
 * repinta el lienzo de un nivel nuevo (innerHTML), los botones recién
 * inyectados quedan al instante en el estado correcto — sin esto el interruptor
 * «✏️ Editar» quedaba inerte en cualquier profundidad distinta de la primera.
 */
export function refrescarBotonesModo(): void {
  document.querySelectorAll<HTMLElement>(SEL_EDITAR).forEach((btn) => {
    btn.classList.toggle('hidden', modo === 'edicion');
  });
  document.querySelectorAll<HTMLElement>(SEL_GUARDAR).forEach((btn) => {
    btn.classList.toggle('hidden', modo !== 'edicion');
  });
}

/**
 * Arranca el controlador de modo. Los clics se atienden por DELEGACIÓN sobre el
 * documento (`closest`), de modo que el ✏️ Editar sigue operativo en CUALQUIER
 * profundidad de la pila de nodos, incluso en las barras de comandos que se
 * inyectan después. El lienzo nace en modo NAVEGACIÓN (clic = portal).
 */
export function iniciarModoLienzo(): void {
  document.addEventListener('click', (ev) => {
    const objetivo = ev.target as Element | null;
    if (!objetivo) return;
    if (objetivo.closest(SEL_EDITAR)) {
      aplicarModo('edicion');
      return;
    }
    if (objetivo.closest(SEL_GUARDAR)) void guardarYBloquear();
  });
  // Vigía de marcado: cada vez que la cascada monta el nivel nuevo (o el visor
  // vuelve a pintar su lienzo) los botones de modo se re-sincronizan solos. El
  // re-sincronizado se agrupa en un frame para no castigar el render.
  let pendiente = false;
  new MutationObserver(() => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      refrescarBotonesModo();
    });
  }).observe(document.body, { childList: true, subtree: true });
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
  refrescarBotonesModo();
  window.dispatchEvent(new CustomEvent('estok:modo-lienzo', { detail: { modo: nuevo } }));
}

function bloquearEdicion(ev: Event): void {
  if (modo !== 'navegacion') return;
  const objetivo = ev.target as HTMLElement | null;
  if (!objetivo || !objetivo.closest(SELECTOR_EDICION)) return;
  ev.stopPropagation();
}

/**
 * GUARDADO DEL PLANO: la física (colisiones + auto-ajuste) corre ACÁ y solo acá.
 * Compacta todos los lienzos visibles y persiste la geometría corregida antes de
 * bloquear la grilla (el clic vuelve a ser disparador de PORTAL de nivel).
 */
async function guardarYBloquear(): Promise<void> {
  const { medidas, brechas, reubicadas } = await compactarYGuardarLienzos();
  // Si la compactación movió/estiró algo, el estado de la app se resincroniza
  // desde PostgreSQL (minimapas, visores y bandejas incluidos).
  if (brechas > 0 || reubicadas > 0) {
    window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
  }
  aplicarModo('navegacion');
  const detalle: string[] = [];
  if (medidas > 0) detalle.push(`💾 ${medidas} espacio(s) consolidado(s)`);
  if (brechas > 0) detalle.push(`📐 ${brechas} brecha(s) mínima(s) absorbida(s)`);
  if (reubicadas > 0) detalle.push(`🚚 ${reubicadas} espacio(s) reacomodado(s)`);
  toast(
    `${detalle.length ? `${detalle.join(' · ')} · ` : '💾 '}grilla bloqueada: el clic ahora navega por portales.`,
  );
}


