// =============================================================================
// LIENZO INTERACTIVO RECURSIVO - edición in-place compartida entre niveles
// -----------------------------------------------------------------------------
// Motor genérico que abstrae las capacidades de edición en caliente para que se
// ejecuten de forma IDÉNTICA en cualquier lienzo que declare los atributos de
// contrato:
//   - Renombrar    : [data-inplace-renombrar] (etiqueta de nombre clicable).
//   - Resizing     : [data-inplace-resize] (tirador) sobre [data-inplace-card].
// Consumido por:
//   - Nivel 2 : Visor de Habitación (muebles grandes)    → visorHabitacion.
//   - Nivel 3 : Visor de Contenedor Grande (estanterías) → visorContenedorGrande.
// La geometría ELÁSTICA libre (arrastre/resize con colisiones y fusión) vive en
// plantaUnicaArrastre.ts. La persistencia (PUT multi-tenant) NO vive acá: cada
// nivel inyecta su callback y decide la geometría de su lienzo.
// =============================================================================

import { blindarTiradorTactil, contenerGestoTactil, crearPintorFrame } from './pintorFrame';
import { iniciarBloqueoResize } from './bloqueoScrollGesto';
import { reafirmarScroll } from './scrollPreservado';

export interface DimensionVisual {
  ui_width: string;
  ui_height: string;
}

// =============================================================================
// 1. CLIC PARA RENOMBRAR (input en caliente; Enter/blur → PUT; Esc → cancelar)
// =============================================================================

export function conectarRenombradoEnVivo(
  scope: ParentNode,
  onRenombrar: (id: string, nombre: string, el: HTMLElement) => Promise<boolean>,
): void {
  scope.querySelectorAll<HTMLElement>('[data-inplace-renombrar]').forEach((etiqueta) => {
    etiqueta.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = etiqueta.dataset.id ?? '';
      if (!id || etiqueta.dataset.editando === '1') return;
      etiqueta.dataset.editando = '1';
      const original = etiqueta.textContent?.trim() ?? '';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = original;
      input.maxLength = 200;
      input.setAttribute('aria-label', 'Nuevo nombre del espacio');
      input.className = 'inplace-input-nombre';
      etiqueta.textContent = '';
      etiqueta.appendChild(input);
      // preventScroll: iOS Safari no debe desplazar la página al abrir el
      // teclado virtual (el lienzo se quedaría "saltando" bajo el dedo).
      input.focus({ preventScroll: true });
      input.select();

      const restaurar = (): void => {
        etiqueta.textContent = original;
        delete etiqueta.dataset.editando;
      };

      const confirmar = async (): Promise<void> => {
        if (etiqueta.dataset.editando !== '1') return;
        const nuevo = input.value.trim();
        if (!nuevo || nuevo === original) {
          restaurar();
          return;
        }
        const ok = await onRenombrar(id, nuevo, etiqueta);
        if (!ok) {
          restaurar();
          return;
        }
        etiqueta.textContent = nuevo;
        delete etiqueta.dataset.editando;
      };

      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          void confirmar();
        } else if (e.key === 'Escape') {
          restaurar();
        }
      });
      input.addEventListener('blur', () => void confirmar());
      input.addEventListener('click', (e) => e.stopPropagation());
    });
  });
}

// =============================================================================
// 2. ESTIRAR PARA CAMBIAR TAMAÑO (resizing elástico con puntero)
// -----------------------------------------------------------------------------
// Al soltar, dispara onConfirmar(id, { ui_width, ui_height }) con STRINGS CSS
// válidos (ej: "45%" / "210px") para que el PUT de Django los persista.
// =============================================================================

export interface OpcionesResizeElastico {
  /** Aplicación visual en vivo. Por defecto setea width/height inline en la carta. */
  aplicarEstilo?: (carta: HTMLElement, dim: DimensionVisual) => void;
  onConfirmar: (id: string, dim: DimensionVisual) => Promise<boolean>;
}

export function conectarResizeElastico(
  scope: ParentNode,
  opts: OpcionesResizeElastico,
): void {
  const aplicarEstilo =
    opts.aplicarEstilo ??
    ((carta: HTMLElement, dim: DimensionVisual) => {
      carta.style.width = dim.ui_width;
      carta.style.height = dim.ui_height;
    });

  scope.querySelectorAll<HTMLElement>('[data-inplace-resize]').forEach((tirador) => {
    // Blindaje táctil del asidero: touchstart/touchmove no pasivos (iOS no lo
    // interpreta como scroll de página ni pinch-to-zoom). Se registra una sola vez.
    blindarTiradorTactil(tirador);
    tirador.addEventListener('pointerdown', (evDown) => {
      const de = evDown as PointerEvent;
      if (de.button !== 0) return;
      const carta = tirador.closest<HTMLElement>('[data-inplace-card]');
      if (!carta) return;
      const id = carta.dataset.id ?? '';
      if (!id) return;
      // iOS Safari: el gesto de estirado no debe activar scroll/rebote nativo.
      contenerGestoTactil(de);
      // isResizing: el documento queda 100% fijo hasta soltar el tirador.
      const liberarBloqueo = iniciarBloqueoResize();
      const marco = carta.parentElement ?? carta;
      const marcoRect = marco.getBoundingClientRect();
      const baseAncho = carta.getBoundingClientRect().width || 96;
      const baseAlto = carta.getBoundingClientRect().height || 96;
      const x0 = de.clientX;
      const y0 = de.clientY;
      let arrastrado = false;
      // Última dimensión calculada (referencia LOCAL del gesto): se pinta como
      // máximo una vez por frame y se confirma en el DOM al soltar el puntero.
      let ultimaDim: DimensionVisual | null = null;
      carta.classList.add('inplace-redimensionando');
      try {
        tirador.setPointerCapture(de.pointerId);
      } catch {
        /* sin captura: el seguimiento continúa igual */
      }

      const calcular = (ev: PointerEvent): DimensionVisual => {
        const dx = ev.clientX - x0;
        const dy = ev.clientY - y0;
        const pct = Math.min(100, Math.max(25, ((baseAncho + dx) / Math.max(1, marcoRect.width)) * 100));
        const altoPx = Math.min(460, Math.max(72, baseAlto + dy));
        return { ui_width: `${Math.round(pct)}%`, ui_height: `${Math.round(altoPx)}px` };
      };

      const pintor = crearPintorFrame(() => {
        if (ultimaDim) aplicarEstilo(carta, ultimaDim);
      });

      const enMovimiento = (ev: PointerEvent): void => {
        contenerGestoTactil(ev);
        arrastrado = true;
        ultimaDim = calcular(ev);
        pintor.programar();
      };

      const alSoltar = (ev: PointerEvent): void => {
        tirador.removeEventListener('pointermove', enMovimiento);
        tirador.removeEventListener('pointerup', alSoltar);
        tirador.removeEventListener('pointercancel', alSoltar);
        pintor.cancelar();
        carta.classList.remove('inplace-redimensionando');
        // isResizing OFF: el documento vuelve a permitir scroll (sin salto).
        liberarBloqueo();
        if (!arrastrado) return;
        // Flush FINAL: la dimensión definitiva se aplica antes del ÚNICO PUT.
        ultimaDim = calcular(ev);
        const dimFinal = ultimaDim;
        aplicarEstilo(carta, dimFinal);
        // VIEWPORT CONGELADO tras la respuesta de la API: el toast de éxito y
        // el refresco que dispara no deben mover la página ni un píxel.
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        void (async () => {
          try {
            await opts.onConfirmar(id, {
              ui_width: carta.style.width || dimFinal.ui_width,
              ui_height: carta.style.height || dimFinal.ui_height,
            });
          } finally {
            reafirmarScroll(scrollX, scrollY);
          }
        })();
      };

      tirador.addEventListener('pointermove', enMovimiento);
      tirador.addEventListener('pointerup', alSoltar);
      tirador.addEventListener('pointercancel', alSoltar);
    });
  });
}

/** Destruye los estilos inline residuales de una carta (tras un render limpio). */
export function limpiarEstilosInplace(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>('[data-inplace-card]').forEach((carta) => {
    carta.style.removeProperty('width');
    carta.style.removeProperty('height');
  });
}


