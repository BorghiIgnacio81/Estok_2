// =============================================================================
// TABLERO DE MUDANZA INTER-ESTOK - Drag & Drop de inventario móvil
// -----------------------------------------------------------------------------
// Grilla simétrica de dos columnas (lado a lado TAMBIÉN en móvil):
//   - ORIGEN  : ÍNDICE de elementos móviles reales del Estok (cajas móviles
//               tipo='CAJA', muebles grandes del usuario y objetos individuales
//               sueltos — incluidos los huérfanos sin ubicación), cada tarjeta
//               con draggable="true".
//   - DESTINO : zona estática «En Tránsito» (limbo del inquilinato receptor) +
//               PLANO de las HABITACIONES del Estok destino como zonas de
//               suelta (dragover con preventDefault + evento drop).
// Al soltar se envía POST /api/inventario/mudanza/ con
// { contenedor_id | objeto_id, estok_destino_id, ubicacion_destino_id } o
// { ..., en_transito: true } y el backend transfiere el bloque COMPLETO en UNA
// sola transacción (contenido en cascada incluido). Tras el HTTP 200 se
// refrescan ambos paneles en caliente.
// Táctil (móvil): el arrastre nativo HTML5 no existe en pantallas táctiles, así
// que además del drag & drop se puede TOCAR una tarjeta (queda seleccionada) y
// luego TOCAR la habitación o «En Tránsito» para concretar la mudanza.
// La clasificación y el render viven en src/lib/mudanzaInventario.ts.
// Auth centralizado: getAuthHeaders()/getToken() desde services/auth.
// =============================================================================

import { getAuthHeaders, getToken, getEstokActivoId, API_BASE_URL } from '../services/auth';
import type { EstokInfo } from '../types';
import { escapeHtml } from './mapaEstokWizard';
import {
  htmlCargando,
  htmlInventarioMovil,
  htmlPlanoDestino,
  htmlVacio,
  htmlZonaTransito,
} from './mudanzaInventario';
import type { ContenedorDto, ObjetoDto, UbicacionDto } from './mudanzaInventario';

interface ItemDrag {
  origen: 'contenedor' | 'objeto';
  id: string;
  nombre: string;
}

export class MudanzaBoard {
  private estoks: EstokInfo[] = [];
  private origenId: string | null = null;
  private destinoId: string | null = null;
  private contenedoresOrigen: ContenedorDto[] = [];
  private objetosOrigen: ObjetoDto[] = [];
  private ubicacionesDestino: UbicacionDto[] = [];
  private errorOrigen: string | null = null;
  private errorDestino: string | null = null;
  private dragItem: ItemDrag | null = null;
  /** Elemento elegido por TOQUE (móvil) a la espera de destino. */
  private seleccion: ItemDrag | null = null;
  private mudando = false;
  private intercambiando = false;

  constructor(
    private readonly origenSel: HTMLSelectElement,
    private readonly destinoSel: HTMLSelectElement,
    private readonly mapaOrigen: HTMLElement,
    private readonly mapaDestino: HTMLElement,
    private readonly swapBtn: HTMLButtonElement | null = null,
    /** Contenedor estático de la zona «En Tránsito» (columna destino). */
    private readonly transito: HTMLElement | null = null,
  ) {}

  /** Inicializa selectores y carga el inventario móvil + el plano destino. */
  async init(estoks: EstokInfo[]): Promise<void> {
    this.estoks = estoks;
    const activo = getEstokActivoId();
    this.origenId = this.estoks.find((e) => e.id === activo)?.id || this.estoks[0]?.id || null;
    this.destinoId = this.estoks.find((e) => e.id !== this.origenId)?.id || null;
    this.renderSelects();
    this.enlazarSelects();
    this.enlazarSwap();
    this.renderTransito();
    await this.recargarTodo();
  }

  // ---------------------------------------------------------------------------
  // ZONA «EN TRÁNSITO» (estática, fuera del scroll del plano de habitaciones)
  // ---------------------------------------------------------------------------

  /**
   * Dibuja y enlaza la receptora «En Tránsito»: un contenedor elástico de
   * suelta que envía el elemento al Estok destino SIN ubicación física. Se
   * renderiza UNA sola vez (no se re-inyecta en cada hot reload) para no
   * duplicar listeners.
   */
  private renderTransito(): void {
    if (!this.transito) return;
    this.transito.innerHTML = htmlZonaTransito();
    this.transito.querySelectorAll<HTMLElement>('[data-drop-transito]').forEach((zona) => {
      zona.addEventListener('dragover', (e) => {
        if (!this.dragItem && !this.seleccion) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        zona.classList.add('mudanza-drop-hover');
      });
      zona.addEventListener('dragleave', () => zona.classList.remove('mudanza-drop-hover'));
      zona.addEventListener('drop', (e) => this.onDrop(e));
      zona.addEventListener('click', () => this.soltarEn(zona, this.seleccion));
    });
  }

  // ---------------------------------------------------------------------------
  // SELECTORES DE ESTOK
  // ---------------------------------------------------------------------------

  private renderSelects(): void {
    this.origenSel.innerHTML = this.estoks
      .map((e) => `<option value="${e.id}" ${e.id === this.origenId ? 'selected' : ''}>${escapeHtml(e.nombre)}</option>`)
      .join('');
    this.destinoSel.innerHTML = this.estoks
      .map((e) => `<option value="${e.id}" ${e.id === this.destinoId ? 'selected' : ''}>${escapeHtml(e.nombre)}</option>`)
      .join('');
  }

  private enlazarSelects(): void {
    this.origenSel.addEventListener('change', () => {
      this.origenId = this.origenSel.value || null;
      if (this.destinoId === this.origenId) {
        this.destinoId = this.estoks.find((e) => e.id !== this.origenId)?.id || null;
      }
      this.renderSelects();
      this.limpiarSeleccion();
      void this.recargarTodo();
    });
    this.destinoSel.addEventListener('change', () => {
      this.destinoId = this.destinoSel.value || null;
      if (this.origenId === this.destinoId) {
        this.origenId = this.estoks.find((e) => e.id !== this.destinoId)?.id || null;
      }
      this.renderSelects();
      this.limpiarSeleccion();
      void this.recargarTodo();
    });
  }

  // ---------------------------------------------------------------------------
  // INTERCAMBIO RÁPIDO (FLIP) Origen ⇄ Destino
  // ---------------------------------------------------------------------------

  private enlazarSwap(): void {
    this.swapBtn?.addEventListener('click', () => void this.intercambiar());
  }

  /**
   * Invierte los Estoks (el Destino pasa a Origen y viceversa) y refresca ambos
   * paneles en caliente. `recargarTodo()` limpia el estado en memoria e inyecta
   * los placeholders de carga en las dos columnas ANTES de esperar la red, así
   * el intercambio se percibe instantáneo aunque los endpoints tarden.
   */
  async intercambiar(): Promise<void> {
    if (this.intercambiando || this.mudando || !this.origenId || !this.destinoId) return;
    this.intercambiando = true;
    if (this.swapBtn) this.swapBtn.disabled = true;

    // FLIP: swap atómico de las dos referencias de Estok.
    const origenPrevio = this.origenId;
    this.origenId = this.destinoId;
    this.destinoId = origenPrevio;

    this.renderSelects(); // sincroniza ambos <select> con los IDs invertidos
    this.animarSwap();
    try {
      await this.recargarTodo();
    } finally {
      this.intercambiando = false;
      if (this.swapBtn) this.swapBtn.disabled = false;
    }
  }

  /** Feedback visual: relanza la animación CSS del icono de flechas opuestas. */
  private animarSwap(): void {
    const icono = this.swapBtn?.querySelector<SVGElement>('.mudanza-swap-icon');
    if (!icono) return;
    icono.classList.remove('mudanza-swap-animando');
    void icono.getBoundingClientRect(); // fuerza reflow para reiniciar la animación
    icono.classList.add('mudanza-swap-animando');
  }

  // ---------------------------------------------------------------------------
  // CONSULTAS ASÍNCRONAS (una por Estok, con su propio X-Estok-Id)
  // ---------------------------------------------------------------------------

  private headersParaEstok(estokId: string): Record<string, string> {
    const token = getToken();
    return token
      ? { Authorization: `Bearer ${token}`, 'X-Estok-Id': estokId }
      : { 'X-Estok-Id': estokId };
  }

  private async fetchJson<T>(url: string, estokId: string): Promise<T[]> {
    const response = await fetch(url, { headers: this.headersParaEstok(estokId) });
    if (response.status === 401) {
      window.location.href = '/login';
      throw new Error('Sesión expirada.');
    }
    if (!response.ok) throw new Error(`Error al consultar el inventario (${response.status}).`);
    const data = await response.json();
    return (data.results || data) as T[];
  }

  private async cargarOrigen(estokId: string): Promise<void> {
    const [contenedores, objetos] = await Promise.all([
      this.fetchJson<ContenedorDto>(`${API_BASE_URL}/contenedores/?page_size=1000`, estokId),
      // `incluir_sin_estok=true`: el índice del ORIGEN debe traer la TOTALIDAD
      // de los objetos individuales sueltos, incluidos los huérfanos cuya FK
      // `estok` quedó nula pero que siguen colgando de una habitación del
      // inquilinato (= objeto físico que hay que poder arrastrar).
      this.fetchJson<ObjetoDto>(
        `${API_BASE_URL}/objetos/?page_size=1000&incluir_sin_estok=true`,
        estokId,
      ),
    ]);
    this.contenedoresOrigen = contenedores;
    this.objetosOrigen = objetos;
  }

  private async cargarDestino(estokId: string): Promise<void> {
    this.ubicacionesDestino = await this.fetchJson<UbicacionDto>(
      `${API_BASE_URL}/ubicaciones/?page_size=1000`,
      estokId,
    );
  }

  // ---------------------------------------------------------------------------
  // RENDER + HOT RELOAD
  // ---------------------------------------------------------------------------

  private async recargarTodo(): Promise<void> {
    if (!this.origenId || !this.destinoId) return;
    // Transición de carga limpia (Tailwind) en ambos paneles.
    this.mapaOrigen.innerHTML = htmlCargando('Cargando inventario móvil…');
    this.mapaDestino.innerHTML = htmlCargando('Cargando plano del destino…');
    this.contenedoresOrigen = [];
    this.objetosOrigen = [];
    this.ubicacionesDestino = [];
    this.errorOrigen = null;
    this.errorDestino = null;

    await Promise.all([
      this.cargarOrigen(this.origenId).catch((err: unknown) => {
        this.errorOrigen = mensajeDe(err);
      }),
      this.cargarDestino(this.destinoId).catch((err: unknown) => {
        this.errorDestino = mensajeDe(err);
      }),
    ]);

    this.render();
  }

  private render(): void {
    this.limpiarSeleccion(); // el DOM se reemplaza: la selección por toque caduca
    this.mapaOrigen.innerHTML = this.errorOrigen
      ? htmlVacio('No se pudo cargar el inventario del Estok origen', this.errorOrigen)
      : htmlInventarioMovil(this.contenedoresOrigen, this.objetosOrigen);
    this.mapaDestino.innerHTML = this.errorDestino
      ? htmlVacio('No se pudo cargar el plano del Estok destino', this.errorDestino)
      : htmlPlanoDestino(this.ubicacionesDestino);
    this.enlazarDnD();
  }

  // ---------------------------------------------------------------------------
  // DRAG & DROP (arrastre nativo HTML5) + SUELTA POR TOQUE (móvil)
  // ---------------------------------------------------------------------------

  /** Identidad de la tarjeta arrastrable leída de sus data-attributes. */
  private itemDe(el: HTMLElement): ItemDrag | null {
    const id = el.dataset.dragId || '';
    if (!id) return null;
    return {
      origen: el.dataset.drag === 'objeto' ? 'objeto' : 'contenedor',
      id,
      nombre: el.dataset.dragNombre || '',
    };
  }

  private enlazarDnD(): void {
    // 1) Elementos arrastrables del ORIGEN (draggable="true" en la tarjeta).
    this.mapaOrigen.querySelectorAll<HTMLElement>('[data-drag]').forEach((el) => {
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
        this.limpiarDropHover();
      });
      // TOQUE (móvil): sin arrastre nativo, la tarjeta queda seleccionada y el
      // destino se completa tocando una habitación o la zona «En Tránsito».
      el.addEventListener('click', () => this.alternarSeleccion(this.itemDe(el), el));
    });

    // 2) Habitaciones receptoras del DESTINO (onDragOver + onDrop + toque).
    this.mapaDestino.querySelectorAll<HTMLElement>('[data-drop-ubicacion]').forEach((zona) => {
      zona.addEventListener('dragover', (e) => {
        if (!this.dragItem && !this.seleccion) return;
        e.preventDefault(); // habilita la habitación como zona de suelta
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        zona.classList.add('mudanza-drop-hover');
      });
      zona.addEventListener('dragleave', () => zona.classList.remove('mudanza-drop-hover'));
      zona.addEventListener('drop', (e) => this.onDrop(e));
      zona.addEventListener('click', () => this.soltarEn(zona, this.seleccion));
    });
  }

  /** Alterna la tarjeta elegida por toque y su feedback visual. */
  private alternarSeleccion(item: ItemDrag | null, el: HTMLElement): void {
    if (!item) return;
    const mismo = this.seleccion?.id === item.id && this.seleccion.origen === item.origen;
    this.limpiarSeleccion();
    if (mismo) return; // segundo toque sobre la misma tarjeta = deseleccionar
    this.seleccion = item;
    el.classList.add('mudanza-seleccionado');
    this.marcarDestinos(true);
  }

  /** Limpia la selección por toque y su resaltado. */
  private limpiarSeleccion(): void {
    this.seleccion = null;
    this.mapaOrigen
      .querySelectorAll('.mudanza-seleccionado')
      .forEach((n) => n.classList.remove('mudanza-seleccionado'));
    this.marcarDestinos(false);
  }

  /** Resalta las zonas receptoras mientras hay un elemento seleccionado. */
  private marcarDestinos(activa: boolean): void {
    this.mapaDestino.classList.toggle('mudanza-con-seleccion', activa);
    this.transito?.classList.toggle('mudanza-con-seleccion', activa);
  }

  private limpiarDropHover(): void {
    for (const raiz of [this.mapaDestino, this.transito]) {
      raiz?.querySelectorAll('.mudanza-drop-hover')
        .forEach((el) => el.classList.remove('mudanza-drop-hover'));
    }
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    this.soltarEn(e.target as HTMLElement, this.dragItem ?? this.seleccion);
  }

  /**
   * Concreta la suelta (mouse o toque). Resuelve el destino elegido:
   *   - «En Tránsito» (`data-drop-transito`) → limbo del Estok destino: el
   *     backend mueve el elemento SIN ubicación física.
   *   - Habitación (`data-drop-ubicacion`)   → re-ancla al espacio real.
   */
  private soltarEn(destino: HTMLElement | null, item: ItemDrag | null): void {
    if (!item || this.mudando) return;
    const enTransito = Boolean(destino?.closest('[data-drop-transito]'));
    const ubicacionId = (destino?.closest('[data-drop-ubicacion]') as HTMLElement | null)
      ?.dataset.dropUbicacion;
    if (!enTransito && !ubicacionId) return;
    this.limpiarDropHover();
    this.dragItem = null;
    this.limpiarSeleccion();
    void this.mover(item, ubicacionId || null, enTransito);
  }

  // ---------------------------------------------------------------------------
  // MUTACIÓN TRANSACCIONAL (POST /api/inventario/mudanza/)
  // ---------------------------------------------------------------------------

  private async mover(item: ItemDrag, ubicacionId: string | null, enTransito: boolean): Promise<void> {
    if (!this.destinoId) return;
    this.mudando = true;
    const etiqueta = item.nombre ? `«${item.nombre}»` : 'el elemento';
    this.mapaDestino.innerHTML = htmlCargando(
      enTransito ? `Enviando ${etiqueta} a «En Tránsito»…` : `Mudando ${etiqueta}…`,
    );

    const body: Record<string, unknown> = { estok_destino_id: this.destinoId };
    if (enTransito) body.en_transito = true; // limbo: sin ubicación física en el destino
    else body.ubicacion_destino_id = ubicacionId;
    if (item.origen === 'contenedor') body.contenedor_id = item.id;
    else body.objeto_id = item.id;

    try {
      const response = await fetch(`${API_BASE_URL}/inventario/mudanza/`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        notificar('showError', data?.error || `Error del servidor (${response.status}).`);
        this.render();
        return;
      }

      const data = await response.json();
      notificar('showSuccess', data?.mensaje || '✅ Mudanza completada.');
      // HOT RELOAD: ambos paneles se refrescan sin recargar la página entera.
      await this.recargarTodo();
    } catch (err: unknown) {
      notificar('showError', mensajeDe(err));
      this.render();
    } finally {
      this.mudando = false;
    }
  }
}

// ---------------------------------------------------------------------------
// HELPERS DE NOTIFICACIÓN / MENSAJES
// ---------------------------------------------------------------------------

/** Aviso flotante global del proyecto (definido en el layout base). */
function notificar(tipo: 'showSuccess' | 'showError', mensaje: string): void {
  const win = window as unknown as Partial<Record<'showSuccess' | 'showError', (m: string) => void>>;
  win[tipo]?.(mensaje);
}

function mensajeDe(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'No se pudo completar la operación.';
}
