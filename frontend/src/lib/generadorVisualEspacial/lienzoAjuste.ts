// =============================================================================
// GENERADOR VISUAL ESPACIAL · LIENZO DE AJUSTE FINO (Paso 3)
// -----------------------------------------------------------------------------
// Carga la plantilla elegida como rectángulos arrastrables y redimensionables
// DENTRO del propio modal, antes de insertarla en el mapa 2D real. La geometría
// se muta en el arreglo del componente (porcentajes 0..100), de modo que al
// confirmar se persiste EXACTAMENTE lo que el operador acomodó.
//
// Módulo de DOM puro: no hace fetch ni conoce backend. El motor elástico real
// (lib/plantaUnicaInteractivo.ts) toma el relevo después de insertar.
// =============================================================================

import { escapeHtml } from '../escapeHtml';
import { porcentaje, type ElementoEspacial } from './presetsEspaciales';

const LADO_MINIMO = 5;

const acotar = (valor: number, minimo: number, maximo: number): number =>
  Math.max(minimo, Math.min(maximo, valor));

/** Aplica la geometría del modelo al nodo del lienzo. */
function aplicarGeo(nodo: HTMLElement, el: ElementoEspacial): void {
  nodo.style.left = porcentaje(el.left);
  nodo.style.top = porcentaje(el.top);
  nodo.style.width = porcentaje(el.width);
  nodo.style.height = porcentaje(el.height);
}

/** Sigue el puntero en `window` (funciona aunque salga del lienzo). */
function seguirPuntero(
  alMover: (ev: PointerEvent) => void,
  alSoltar: () => void,
): void {
  const soltar = (): void => {
    window.removeEventListener('pointermove', alMover);
    window.removeEventListener('pointerup', soltar);
    window.removeEventListener('pointercancel', soltar);
    alSoltar();
  };
  window.addEventListener('pointermove', alMover);
  window.addEventListener('pointerup', soltar);
  window.addEventListener('pointercancel', soltar);
}

function enlazarItem(
  nodo: HTMLElement,
  el: ElementoEspacial,
  lienzo: HTMLElement,
  alEditar: () => void,
): void {
  nodo.querySelector<HTMLElement>('[data-gve-resize]')?.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const caja = lienzo.getBoundingClientRect();
    const inicio = { x: ev.clientX, y: ev.clientY, width: el.width, height: el.height };
    seguirPuntero(
      (e) => {
        el.width = acotar(inicio.width + ((e.clientX - inicio.x) / caja.width) * 100, LADO_MINIMO, 100 - el.left);
        el.height = acotar(inicio.height + ((e.clientY - inicio.y) / caja.height) * 100, LADO_MINIMO, 100 - el.top);
        aplicarGeo(nodo, el);
      },
      alEditar,
    );
  });

  nodo.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement | null)?.closest('[data-gve-resize]')) return;
    ev.preventDefault();
    const caja = lienzo.getBoundingClientRect();
    const inicio = { x: ev.clientX, y: ev.clientY, left: el.left, top: el.top };
    nodo.classList.add('gve-lienzo-item--activo');
    seguirPuntero(
      (e) => {
        el.left = acotar(inicio.left + ((e.clientX - inicio.x) / caja.width) * 100, 0, 100 - el.width);
        el.top = acotar(inicio.top + ((e.clientY - inicio.y) / caja.height) * 100, 0, 100 - el.height);
        aplicarGeo(nodo, el);
      },
      () => {
        nodo.classList.remove('gve-lienzo-item--activo');
        alEditar();
      },
    );
  });
}

export interface ControlLienzoAjuste {
  /** Repinta las subdivisiones (se llama tras agregar, dividir o quitar). */
  render: () => void;
}

/**
 * Monta el lienzo interactivo dentro de `host`.
 * `elementos` es la MISMA referencia que usa el modal: mover/estirar muta el
 * arreglo y el resultado se persiste al confirmar la inserción.
 */
export function crearLienzoAjuste(params: {
  host: HTMLElement;
  elementos: ElementoEspacial[];
  alEditar: () => void;
}): ControlLienzoAjuste {
  const { host, elementos, alEditar } = params;

  const render = (): void => {
    if (elementos.length === 0) {
      host.innerHTML =
        '<p class="gve-lienzo-vacio">Lienzo vacío · usá «＋ Añadir subdivisión» para empezar de cero.</p>';
      return;
    }
    host.innerHTML = elementos
      .map(
        (el, i) => `<div class="gve-lienzo-item" data-gve-item="${i}"
          style="left:${porcentaje(el.left)};top:${porcentaje(el.top)};width:${porcentaje(el.width)};height:${porcentaje(el.height)}">
          <span class="gve-lienzo-icono" aria-hidden="true">${escapeHtml(el.icono)}</span>
          <span class="gve-lienzo-nombre">${escapeHtml(el.nombre)}</span>
          <span class="gve-lienzo-resize" data-gve-resize title="Estirar para cambiar el tamaño"></span>
        </div>`,
      )
      .join('');
    host.querySelectorAll<HTMLElement>('[data-gve-item]').forEach((nodo) => {
      const indice = Number(nodo.dataset.gveItem);
      const el = elementos[indice];
      if (!el) return;
      enlazarItem(nodo, el, host, alEditar);
    });
  };

  render();
  return { render };
}
