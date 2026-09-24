// =============================================================================
// TABLERO DE MUDANZA INTER-ESTOK - Drag & Drop de inventario móvil
// -----------------------------------------------------------------------------
// Grilla simétrica de dos columnas:
//   - ORIGEN  : ÍNDICE de elementos móviles reales del Estok (cajas móviles,
//               muebles grandes del usuario y objetos individuales sueltos),
//               cada tarjeta con draggable="true".
//   - DESTINO : PLANO de las HABITACIONES del Estok destino como zonas de
//               suelta (dragover con preventDefault + evento drop).
// Al soltar se envía POST /api/inventario/mudanza/ con
// { contenedor_id | objeto_id, estok_destino_id, ubicacion_destino_id } y el
// backend transfiere el bloque COMPLETO en UNA sola transacción (contenido en
// cascada incluido). Tras el HTTP 200 se refrescan ambos paneles en caliente.
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
  private mudando = false;

  constructor(
    private readonly origenSel: HTMLSelectElement,
    private readonly destinoSel: HTMLSelectElement,
    private readonly mapaOrigen: HTMLElement,
    private readonly mapaDestino: HTMLElement,
  ) {}

  /** Inicializa selectores y carga el inventario móvil + el plano destino. */
  async init(estoks: EstokInfo[]): Promise<void> {
    this.estoks = estoks;
    const activo = getEstokActivoId();
    this.origenId = this.estoks.find((e) => e.id === activo)?.id || this.estoks[0]?.id || null;
    this.destinoId = this.estoks.find((e) => e.id !== this.origenId)?.id || null;
    this.renderSelects();
    this.enlazarSelects();
    await this.recargarTodo();
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
      void this.recargarTodo();
    });
    this.destinoSel.addEventListener('change', () => {
      this.destinoId = this.destinoSel.value || null;
      if (this.origenId === this.destinoId) {
        this.origenId = this.estoks.find((e) => e.id !== this.destinoId)?.id || null;
      }
      this.renderSelects();
      void this.recargarTodo();
    });
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
      this.fetchJson<ObjetoDto>(`${API_BASE_URL}/objetos/?page_size=1000`, estokId),
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
    this.mapaOrigen.innerHTML = this.errorOrigen
      ? htmlVacio('No se pudo cargar el inventario del Estok origen', this.errorOrigen)
      : htmlInventarioMovil(this.contenedoresOrigen, this.objetosOrigen);
    this.mapaDestino.innerHTML = this.errorDestino
      ? htmlVacio('No se pudo cargar el plano del Estok destino', this.errorDestino)
      : htmlPlanoDestino(this.ubicacionesDestino);
    this.enlazarDnD();
  }

  // ---------------------------------------------------------------------------
  // DRAG & DROP (arrastre nativo HTML5)
  // ---------------------------------------------------------------------------

  private enlazarDnD(): void {
    // 1) Elementos arrastrables del ORIGEN (draggable="true" en la tarjeta).
    this.mapaOrigen.querySelectorAll<HTMLElement>('[data-drag]').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        const id = el.dataset.dragId || '';
        if (!id) return;
        this.dragItem = {
          origen: el.dataset.drag === 'objeto' ? 'objeto' : 'contenedor',
          id,
          nombre: el.dataset.dragNombre || '',
        };
        el.classList.add('mudanza-dragging');
        e.dataTransfer?.setData('text/plain', `${this.dragItem.origen}:${id}`);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('mudanza-dragging');
        this.dragItem = null;
        this.limpiarDropHover();
      });
    });

    // 2) Habitaciones receptoras del DESTINO (onDragOver + onDrop).
    this.mapaDestino.querySelectorAll<HTMLElement>('[data-drop-ubicacion]').forEach((zona) => {
      zona.addEventListener('dragover', (e) => {
        if (!this.dragItem) return;
        e.preventDefault(); // habilita la habitación como zona de suelta
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        zona.classList.add('mudanza-drop-hover');
      });
      zona.addEventListener('dragleave', () => zona.classList.remove('mudanza-drop-hover'));
      zona.addEventListener('drop', (e) => this.onDrop(e));
    });
  }

  private limpiarDropHover(): void {
    this.mapaDestino
      .querySelectorAll('.mudanza-drop-hover')
      .forEach((el) => el.classList.remove('mudanza-drop-hover'));
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    const zona = (e.target as HTMLElement).closest('[data-drop-ubicacion]') as HTMLElement | null;
    const item = this.dragItem;
    this.limpiarDropHover();
    this.dragItem = null;
    const ubicacionId = zona?.dataset.dropUbicacion;
    if (!item || !ubicacionId || this.mudando) return;
    void this.mover(item, ubicacionId);
  }

  // ---------------------------------------------------------------------------
  // MUTACIÓN TRANSACCIONAL (POST /api/inventario/mudanza/)
  // ---------------------------------------------------------------------------

  private async mover(item: ItemDrag, ubicacionId: string): Promise<void> {
    if (!this.destinoId) return;
    this.mudando = true;
    const etiqueta = item.nombre ? `«${item.nombre}»` : 'el elemento';
    this.mapaDestino.innerHTML = htmlCargando(`Mudando ${etiqueta}…`);

    const body: Record<string, unknown> = {
      estok_destino_id: this.destinoId,
      ubicacion_destino_id: ubicacionId,
    };
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
