// =============================================================================
// MOTOR DE ARRASTRE Y SUELTA DE LA MUDANZA (drag & drop nativo + toque)
// -----------------------------------------------------------------------------
// Encapsula TODA la interacción directa sobre el DOM de las dos columnas:
//   · ORIGEN  → tarjetas `draggable="true"`: dragstart / dragend / click.
//   · DESTINO → zonas de suelta: habitación (`data-drop-ubicacion`), mueble o
//               estante (`data-drop-contenedor`) y «En Tránsito»
//               (`data-drop-transito`, estática, fuera del scroll).
//
// Doble vía de uso (el arrastre nativo HTML5 no existe en pantallas táctiles):
//   1. Arrastrar y soltar con mouse.
//   2. Tocar la tarjeta (queda seleccionada y resaltada) y luego tocar la zona
//      receptora. Mientras hay selección se revelan las pistas de suelta.
//
// El motor NO sabe de red ni de filtros: sólo resuelve la zona tocada/soltada y
// avisa con `alSoltar(item, zona)`. El tablero (mudanzaBoard) hace el POST.
// =============================================================================

import type { ItemMudanza } from './mudanzaApi';

/** Zona receptora resuelta desde el DOM. */
export interface ZonaSuelta {
  /** «En Tránsito»: limbo sin ubicación física en el Estok destino. */
  enTransito: boolean;
  /** Habitación destino (suelta gruesa). */
  ubicacionId: string | null;
  /** Mueble/estante destino (suelta fina dentro del contenedor). */
  contenedorId: string | null;
}

export interface OpcionesMudanzaDnd {
  mapaOrigen: HTMLElement;
  mapaDestino: HTMLElement;
  transito: HTMLElement | null;
  /** Hay una mudanza en curso: se bloquean nuevas sueltas. */
  estaMudando: () => boolean;
  /** Callback de negocio: el tablero ejecuta la mutación transaccional. */
  alSoltar: (item: ItemMudanza, zona: ZonaSuelta) => void;
}

export class MudanzaDndTactil {
  private dragItem: ItemMudanza | null = null;
  /** Elemento elegido por TOQUE (móvil) a la espera de destino. */
  private seleccion: ItemMudanza | null = null;

  constructor(private readonly opciones: OpcionesMudanzaDnd) {}

  /** Identidad de la tarjeta arrastrable leída de sus data-attributes. */
  private itemDe(el: HTMLElement): ItemMudanza | null {
    const id = el.dataset.dragId || '';
    if (!id) return null;
    return {
      origen: el.dataset.drag === 'objeto' ? 'objeto' : 'contenedor',
      id,
      nombre: el.dataset.dragNombre || '',
    };
  }

  /** Enlaza la zona ESTÁTICA «En Tránsito» (se dibuja una sola vez). */
  enlazarTransito(): void {
    this.opciones.transito?.querySelectorAll<HTMLElement>('[data-drop-transito]')
      .forEach((zona) => {
        zona.addEventListener('dragover', (e) => this.sobreZona(e, zona));
        zona.addEventListener('dragleave', () => zona.classList.remove('mudanza-drop-hover'));
        zona.addEventListener('drop', (e) => this.soltar(e, zona));
        zona.addEventListener('click', () => this.soltarPorToque(zona));
      });
  }

  /** (Re)enlaza las TARJETAS del Origen tras cada repintado de la columna. */
  enlazarOrigen(): void {
    this.opciones.mapaOrigen.querySelectorAll<HTMLElement>('[data-drag]').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        const item = this.itemDe(el);
        if (!item) return;
        this.dragItem = item;
        el.classList.add('mudanza-dragging');
        e.dataTransfer?.setData('text/plain', `${item.origen}:${item.id}`);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('mudanza-dragging');
        this.dragItem = null;
        this.limpiarHover();
      });
      el.addEventListener('click', () => this.alternarSeleccion(this.itemDe(el), el));
    });
  }

  /** (Re)enlaza las ZONAS receptoras del Destino tras cada repintado. */
  enlazarDestino(): void {
    this.opciones.mapaDestino
      .querySelectorAll<HTMLElement>('[data-drop-ubicacion], [data-drop-contenedor]')
      .forEach((zona) => {
        zona.addEventListener('dragover', (e) => this.sobreZona(e, zona));
        zona.addEventListener('dragleave', () => zona.classList.remove('mudanza-drop-hover'));
        zona.addEventListener('drop', (e) => this.soltar(e, zona));
        zona.addEventListener('click', () => this.soltarPorToque(zona));
      });
  }

  /** Resalta la zona cuando hay algo arrastrado o seleccionado. */
  private sobreZona(e: DragEvent, zona: HTMLElement): void {
    if (!this.dragItem && !this.seleccion) return;
    e.preventDefault(); // habilita la zona como destino válido
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    zona.classList.add('mudanza-drop-hover');
  }

  /** Alterna la tarjeta elegida por toque y su feedback visual. */
  private alternarSeleccion(item: ItemMudanza | null, el: HTMLElement): void {
    if (!item) return;
    const mismo = this.seleccion?.id === item.id && this.seleccion.origen === item.origen;
    this.limpiarSeleccion();
    if (mismo) return; // segundo toque sobre la misma tarjeta = deseleccionar
    this.seleccion = item;
    el.classList.add('mudanza-seleccionado');
    this.marcarDestinos(true);
  }

  /** Limpia la selección por toque y su resaltado (p. ej. tras re-renderizar). */
  limpiarSeleccion(): void {
    this.seleccion = null;
    this.opciones.mapaOrigen
      .querySelectorAll('.mudanza-seleccionado')
      .forEach((n) => n.classList.remove('mudanza-seleccionado'));
    this.marcarDestinos(false);
  }

  /** Resalta las zonas receptoras mientras hay un elemento seleccionado. */
  private marcarDestinos(activa: boolean): void {
    this.opciones.mapaDestino.classList.toggle('mudanza-con-seleccion', activa);
    this.opciones.transito?.classList.toggle('mudanza-con-seleccion', activa);
  }

  private limpiarHover(): void {
    for (const raiz of [this.opciones.mapaDestino, this.opciones.transito]) {
      raiz?.querySelectorAll('.mudanza-drop-hover')
        .forEach((el) => el.classList.remove('mudanza-drop-hover'));
    }
  }

  private soltar(e: DragEvent, zona: HTMLElement): void {
    e.preventDefault();
    this.concretar(zona, this.dragItem ?? this.seleccion);
  }

  private soltarPorToque(zona: HTMLElement): void {
    this.concretar(zona, this.seleccion);
  }

  /**
   * Resuelve la zona elegida y delega la operación:
   *   - «En Tránsito»                            → limbo (sin ubicación física).
   *   - Mueble/estante (`data-drop-contenedor`)  → suelta FINA.
   *   - Habitación (`data-drop-ubicacion`)       → suelta GRUESA.
   */
  private concretar(zona: HTMLElement | null, item: ItemMudanza | null): void {
    if (!item || this.opciones.estaMudando()) return;
    const enTransito = Boolean(zona?.closest('[data-drop-transito]'));
    const contenedorId = (zona?.closest('[data-drop-contenedor]') as HTMLElement | null)
      ?.dataset.dropContenedor || null;
    const ubicacionId = (zona?.closest('[data-drop-ubicacion]') as HTMLElement | null)
      ?.dataset.dropUbicacion || null;
    if (!enTransito && !contenedorId && !ubicacionId) return;

    this.limpiarHover();
    this.dragItem = null;
    this.limpiarSeleccion();
    this.opciones.alSoltar(item, { enTransito, ubicacionId, contenedorId });
  }
}
