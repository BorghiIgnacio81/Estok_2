// =============================================================================
// «DESVINCULAR DEL ESPACIO» EN LAS TARJETAS DEL LIENZO ELÁSTICO
// -----------------------------------------------------------------------------
// Corrección de ASIGNACIONES ACCIDENTALES sin borrar inventario: cada tarjeta
// que declara `desvinculable` expone el botón ⛓️‍💥 (`data-desvincular-item`).
// Al tocarlo, el nivel dueño del lienzo persiste el PUT parcial
// (`parent_contenedor = null`): la pieza deja de listarse como sub-espacio del
// padre y queda como espacio raíz de su MISMA habitación.
//
// Vive fuera de `plantaUnicaInteractivo.ts` para sostener el límite de
// mantenibilidad de los módulos de UI (≤400 líneas).
// =============================================================================

import { guardadoEditor } from './debounceGuardado';
import type { OpcionesPlantaUnica } from './plantaUnicaArrastre';

/** Conecta el botón de desvinculación de CADA tarjeta suelta del lienzo. */
export function conectarDesvinculacionEnLienzo(opts: OpcionesPlantaUnica): void {
  opts.scope.querySelectorAll<HTMLButtonElement>('[data-desvincular-item]').forEach((btn) => {
    // El botón vive DENTRO de la tarjeta arrastrable/navegable: se frena el
    // gesto de arrastre (pointerdown) y el clic para no disparar el portal.
    btn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id ?? '';
      const card = btn.closest<HTMLElement>('.pu-celda');
      if (!id || !card || !opts.desvincularItem) return;
      const item = opts.rooms().find((pieza) => String(pieza.id) === id);
      if (!item) return;
      btn.disabled = true;
      const ok = await opts.desvincularItem(item, card);
      if (!ok) {
        btn.disabled = false;
        return;
      }
      // El recurso ya no cuelga de este padre: se descarta cualquier PUT
      // pendiente de este id para no disparar un guardado fantasma.
      guardadoEditor.descartar(id);
      card.remove();
      opts.notificarCambios();
    });
  });
}
