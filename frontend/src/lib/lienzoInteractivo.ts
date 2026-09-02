// =============================================================================
// LIENZO INTERACTIVO RECURSIVO - edición in-place compartida entre niveles
// -----------------------------------------------------------------------------
// Motor genérico que abstrae las tres capacidades de edición en caliente para
// que se ejecuten de forma IDÉNTICA en cualquier lienzo que declare los
// atributos de contrato:
//   - Renombrar    : [data-inplace-renombrar] (etiqueta de nombre clicable).
//   - Reacomodar   : [data-inplace-drag] (carta) → [data-inplace-drop] (celda).
//   - Resizing     : [data-inplace-resize] (tirador) sobre [data-inplace-card].
// Consumido por:
//   - Nivel 2 : Mapa Estok (plano de habitaciones)      → mapaCasitaNavegable.
//   - Nivel 3 : Visor de Habitación (muebles grandes)    → visorHabitacion.
//   - Nivel 4 : Visor de Contenedor Grande (estanterías) → visorContenedorGrande.
// La persistencia (PUT multi-tenant) NO vive acá: cada nivel inyecta su
// callback y decide la geometría de su grilla.
// =============================================================================

export interface DimensionVisual {
  ui_width: string;
  ui_height: string;
}

export interface DestinoDrop {
  fila: number;
  col: number;
}

/** Normaliza un valor persistido ui_* a algo usable por CSS ('' = default). */
export function tokenCssVisual(valor: string | null | undefined): string {
  const v = (valor || '').trim().toLowerCase();
  if (!v || v === 'auto' || v === '100%') return '';
  if (/^\d{1,3}(\.\d+)?%$/.test(v)) return `${Math.min(100, Math.max(8, parseFloat(v)))}%`;
  if (/^\d{1,4}px$/.test(v)) return `${Math.min(600, Math.max(24, parseFloat(v)))}px`;
  return '';
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
      input.focus();
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
// 2. ARRASTRAR PARA REACOMODAR (HTML5 DnD entre cuadrantes de la grilla)
// =============================================================================

export function conectarReacomodoDrag(
  scope: ParentNode,
  onMover: (id: string, destino: DestinoDrop) => Promise<boolean>,
): void {
  scope.querySelectorAll<HTMLElement>('[data-inplace-drag]').forEach((carta) => {
    carta.setAttribute('draggable', 'true');
    carta.addEventListener('dragstart', (e) => {
      const id = carta.dataset.id ?? '';
      if (!id) {
        e.preventDefault();
        return;
      }
      const de = e as DragEvent;
      de.dataTransfer?.setData('text/plain', id);
      de.dataTransfer?.setData('application/x-estok-espacio', id);
      if (de.dataTransfer) de.dataTransfer.effectAllowed = 'move';
      carta.classList.add('inplace-arrastrando');
    });
    carta.addEventListener('dragend', () => carta.classList.remove('inplace-arrastrando'));
  });

  scope.querySelectorAll<HTMLElement>('[data-inplace-drop]').forEach((celda) => {
    celda.addEventListener('dragover', (e) => {
      const de = e as DragEvent;
      if (!de.dataTransfer?.types.includes('application/x-estok-espacio')) return;
      e.preventDefault();
      if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
      celda.classList.add('inplace-drop-activo');
    });
    celda.addEventListener('dragleave', () => celda.classList.remove('inplace-drop-activo'));
    celda.addEventListener('drop', (e) => {
      const de = e as DragEvent;
      e.preventDefault();
      celda.classList.remove('inplace-drop-activo');
      const id = de.dataTransfer?.getData('application/x-estok-espacio');
      if (!id) return;
      const fila = Number(celda.dataset.fila);
      const col = Number(celda.dataset.col);
      if (!fila || !col) return;
      void onMover(id, { fila, col });
    });
  });
}

// =============================================================================
// 3. ESTIRAR PARA CAMBIAR TAMAÑO (resizing elástico con puntero)
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
    tirador.addEventListener('pointerdown', (evDown) => {
      const de = evDown as PointerEvent;
      if (de.button !== 0) return;
      const carta = tirador.closest<HTMLElement>('[data-inplace-card]');
      if (!carta) return;
      const id = carta.dataset.id ?? '';
      if (!id) return;
      evDown.preventDefault();
      evDown.stopPropagation();
      const marco = carta.parentElement ?? carta;
      const marcoRect = marco.getBoundingClientRect();
      const baseAncho = carta.getBoundingClientRect().width || 96;
      const baseAlto = carta.getBoundingClientRect().height || 96;
      const x0 = de.clientX;
      const y0 = de.clientY;
      let arrastrado = false;
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

      const enMovimiento = (ev: PointerEvent): void => {
        ev.preventDefault();
        arrastrado = true;
        aplicarEstilo(carta, calcular(ev));
      };

      const alSoltar = (ev: PointerEvent): void => {
        tirador.removeEventListener('pointermove', enMovimiento);
        tirador.removeEventListener('pointerup', alSoltar);
        tirador.removeEventListener('pointercancel', alSoltar);
        carta.classList.remove('inplace-redimensionando');
        if (!arrastrado) return;
        const dim = calcular(ev);
        void opts.onConfirmar(id, {
          ui_width: carta.style.width || dim.ui_width,
          ui_height: carta.style.height || dim.ui_height,
        });
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


