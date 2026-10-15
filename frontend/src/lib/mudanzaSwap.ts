// =============================================================================
// INTERCAMBIO RÁPIDO (FLIP) ORIGEN ⇄ DESTINO DEL TABLERO DE MUDANZAS
// -----------------------------------------------------------------------------
// Encapsula el botón «⇄» que flota en el hueco central de las dos columnas:
// invierte las dos referencias de Estok (swap atómico), sincroniza los <select>
// y refresca ambos paneles en caliente. `recargar()` limpia el estado en memoria
// e inyecta los placeholders de carga ANTES de esperar la red, así el intercambio
// se percibe instantáneo aunque los endpoints tarden.
//
// El ESTADO y el refresco viven en el tablero: este módulo sólo los orquesta a
// través de los callbacks que recibe, así no se acopla al DOM interno de la
// clase MudanzaBoard. Se extrajo de mudanzaBoard.ts (Lote 27) para sostener el
// límite de 400 líneas por archivo.
// =============================================================================

export interface OpcionesIntercambio {
  /** Botón «⇄» del cabezal (si falta, el módulo queda inerte). */
  boton: HTMLButtonElement | null;
  /** ¿Hay una operación en curso (mudanza o intercambio)? Se ignora el clic. */
  estaOcupado: () => boolean;
  /** IDs vigentes de ambos Estoks (null = todavía sin selección). */
  ids: () => { origenId: string | null; destinoId: string | null };
  /** Invierte las dos referencias de Estok en el estado del tablero. */
  invertir: () => void;
  /** Sincroniza los dos <select> con los IDs YA invertidos. */
  sincronizarSelects: () => void;
  /** Refresco en caliente de ambos paneles. */
  recargar: () => Promise<void>;
  /** Marca/desmarca la bandera de operación del tablero. */
  marcarOcupado: (ocupado: boolean) => void;
}

export class IntercambioEstoks {
  constructor(private readonly opciones: OpcionesIntercambio) {}

  /** Enlaza el clic del botón «⇄» (una sola vez, en el arranque del tablero). */
  enlazar(): void {
    this.opciones.boton?.addEventListener('click', () => void this.intercambiar());
  }

  /** Invierte los Estoks y refresca ambos paneles (bloqueo mientras corre). */
  async intercambiar(): Promise<void> {
    const { origenId, destinoId } = this.opciones.ids();
    if (this.opciones.estaOcupado() || !origenId || !destinoId) return;
    this.opciones.marcarOcupado(true);
    const boton = this.opciones.boton;
    if (boton) boton.disabled = true;

    // FLIP: swap atómico de las dos referencias de Estok.
    this.opciones.invertir();
    this.opciones.sincronizarSelects(); // los <select> siguen los IDs invertidos
    this.animar();
    try {
      await this.opciones.recargar();
    } finally {
      this.opciones.marcarOcupado(false);
      if (boton) boton.disabled = false;
    }
  }

  /** Feedback visual: relanza la animación CSS del icono de flechas opuestas. */
  private animar(): void {
    const icono = this.opciones.boton?.querySelector<SVGElement>('.mudanza-swap-icon');
    if (!icono) return;
    icono.classList.remove('mudanza-swap-animando');
    void icono.getBoundingClientRect(); // fuerza reflow para reiniciar la animación
    icono.classList.add('mudanza-swap-animando');
  }
}
