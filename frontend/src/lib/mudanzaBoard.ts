// =============================================================================
// TABLERO DE MUDANZA INTER-ESTOK — orquestación de UI (DnD + filtros + toque)
// -----------------------------------------------------------------------------
// Grilla de dos columnas lado a lado (también en móvil), cada una con:
//   ORIGEN  : barra de filtros (Objetos sueltos · Muebles · Cajas) + índice de
//             inventario móvil arrastrable.
//   DESTINO : barra de filtros (Habitaciones · Muebles · Espacios / Estantes) +
//             zona estática «En Tránsito» + plano receptor en dos escalas
//             (suelta gruesa en la habitación y fina dentro de un mueble).
//
// Los filtros son 100% REACTIVOS EN EL CLIENTE: marcar/desmarcar sólo repinta
// los grupos desde el estado en memoria, sin nuevas peticiones al servidor.
//
// Responsabilidades delegadas (archivos chicos y testeables):
//   mudanzaApi.ts        → DTOs, fetch paginado COMPLETO y POST transaccional.
//   mudanzaInventario.ts → clasificación y render de la columna Origen.
//   mudanzaDestino.ts    → render jerárquico de zonas receptoras.
//   mudanzaFiltros.ts    → definición y markup de las barras de checkboxes.
// =============================================================================

import { getEstokActivoId } from '../services/auth';
import type { EstokInfo } from '../types';
import { escapeHtml } from './mapaEstokWizard';
import { cargarInventarioOrigen, cargarPlanoDestino, enviarMudanza } from './mudanzaApi';
import type { ContenedorDto, ItemMudanza, ObjetoDto, UbicacionDto } from './mudanzaApi';
import { MudanzaDndTactil } from './mudanzaDnd';
import type { ZonaSuelta } from './mudanzaDnd';
import {
  contarOrigen,
  htmlCargando,
  htmlInventarioMovil,
  htmlVacio,
  htmlZonaTransito,
} from './mudanzaInventario';
import { contarDestino, htmlPlanoDestino } from './mudanzaDestino';
import {
  FILTROS_DESTINO,
  FILTROS_ORIGEN,
  filtrosActivos,
  htmlBarraFiltros,
} from './mudanzaFiltros';
import type { FiltroDestino, FiltroOrigen } from './mudanzaFiltros';

/** Nodos del DOM que el tablero gobierna (inyección explícita, sin búsquedas globales). */
export interface NodosMudanza {
  origenSel: HTMLSelectElement;
  destinoSel: HTMLSelectElement;
  mapaOrigen: HTMLElement;
  mapaDestino: HTMLElement;
  swapBtn: HTMLButtonElement | null;
  /** Contenedor estático de la zona «En Tránsito» (columna destino). */
  transito: HTMLElement;
  /** Cabezal donde se inyecta la barra de filtros del Origen. */
  filtrosOrigen: HTMLElement;
  /** Cabezal donde se inyecta la barra de filtros del Destino. */
  filtrosDestino: HTMLElement;
}

/** Devuelve una copia del set con `valor` agregado o quitado según `activo`. */
function alternar<T extends string>(actual: Set<T>, valor: T, activo: boolean): Set<T> {
  const copia = new Set(actual);
  if (activo) copia.add(valor);
  else copia.delete(valor);
  return copia;
}

export class MudanzaBoard {
  private estoks: EstokInfo[] = [];
  private origenId: string | null = null;
  private destinoId: string | null = null;
  private contenedoresOrigen: ContenedorDto[] = [];
  private objetosOrigen: ObjetoDto[] = [];
  private ubicacionesDestino: UbicacionDto[] = [];
  private contenedoresDestino: ContenedorDto[] = [];
  private errorOrigen: string | null = null;
  private errorDestino: string | null = null;
  private mudando = false;
  private intercambiando = false;
  /** Filtros activos de cada columna (estado en memoria; nunca viaja al server). */
  private filtrosOrigen: Set<FiltroOrigen> = filtrosActivos(FILTROS_ORIGEN);
  private filtrosDestino: Set<FiltroDestino> = filtrosActivos(FILTROS_DESTINO);
  /** Motor de arrastre/suelta (mouse y toque) sobre las dos columnas. */
  private readonly dnd: MudanzaDndTactil;

  constructor(private readonly ui: NodosMudanza) {
    this.dnd = new MudanzaDndTactil({
      mapaOrigen: ui.mapaOrigen,
      mapaDestino: ui.mapaDestino,
      transito: ui.transito,
      estaMudando: () => this.mudando,
      alSoltar: (item, zona) => void this.mover(item, zona),
    });
  }

  /** Inicializa selectores, filtros y carga el inventario móvil + el plano destino. */
  async init(estoks: EstokInfo[]): Promise<void> {
    this.estoks = estoks;
    const activo = getEstokActivoId();
    this.origenId = this.estoks.find((e) => e.id === activo)?.id || this.estoks[0]?.id || null;
    this.destinoId = this.estoks.find((e) => e.id !== this.origenId)?.id || null;
    this.renderSelects();
    this.enlazarSelects();
    this.enlazarSwap();
    this.enlazarFiltros();
    this.renderTransito();
    this.dnd.enlazarTransito();
    this.renderBarras();
    await this.recargarTodo();
  }

  // ---------------------------------------------------------------------------
  // SELECTORES DE ESTOK
  // ---------------------------------------------------------------------------

  private renderSelects(): void {
    this.ui.origenSel.innerHTML = this.estoks
      .map((e) => `<option value="${e.id}" ${e.id === this.origenId ? 'selected' : ''}>${escapeHtml(e.nombre)}</option>`)
      .join('');
    this.ui.destinoSel.innerHTML = this.estoks
      .map((e) => `<option value="${e.id}" ${e.id === this.destinoId ? 'selected' : ''}>${escapeHtml(e.nombre)}</option>`)
      .join('');
  }

  private enlazarSelects(): void {
    this.ui.origenSel.addEventListener('change', () => {
      this.origenId = this.ui.origenSel.value || null;
      if (this.destinoId === this.origenId) {
        this.destinoId = this.estoks.find((e) => e.id !== this.origenId)?.id || null;
      }
      this.renderSelects();
      this.dnd.limpiarSeleccion();
      void this.recargarTodo();
    });
    this.ui.destinoSel.addEventListener('change', () => {
      this.destinoId = this.ui.destinoSel.value || null;
      if (this.origenId === this.destinoId) {
        this.origenId = this.estoks.find((e) => e.id !== this.destinoId)?.id || null;
      }
      this.renderSelects();
      this.dnd.limpiarSeleccion();
      void this.recargarTodo();
    });
  }

  // ---------------------------------------------------------------------------
  // FILTROS REACTIVOS (sin peticiones: repintado desde el estado en memoria)
  // ---------------------------------------------------------------------------

  /** Dibuja las dos barras con sus contadores reales de inventario. */
  private renderBarras(): void {
    this.ui.filtrosOrigen.innerHTML = htmlBarraFiltros(
      'origen',
      FILTROS_ORIGEN,
      this.filtrosOrigen,
      contarOrigen(this.contenedoresOrigen, this.objetosOrigen),
    );
    this.ui.filtrosDestino.innerHTML = htmlBarraFiltros(
      'destino',
      FILTROS_DESTINO,
      this.filtrosDestino,
      contarDestino(this.ubicacionesDestino, this.contenedoresDestino),
    );
  }

  /**
   * Delegación de eventos en el CABEZAL (que no se re-renderiza): así los
   * `change` siguen vivos aunque la barra se vuelva a inyectar tras cada
   * repintado de contadores.
   */
  private enlazarFiltros(): void {
    this.ui.filtrosOrigen.addEventListener('change', (e) => this.aplicarFiltro('origen', e));
    this.ui.filtrosDestino.addEventListener('change', (e) => this.aplicarFiltro('destino', e));
  }

  /** Aplica el checkbox marcado/desmarcado y repinta la columna en el cliente. */
  private aplicarFiltro(grupo: 'origen' | 'destino', e: Event): void {
    const input = e.target as HTMLInputElement;
    const valor = input?.dataset?.filtroValor;
    if (!valor) return;
    if (grupo === 'origen') {
      this.filtrosOrigen = alternar(this.filtrosOrigen, valor as FiltroOrigen, input.checked);
    } else {
      this.filtrosDestino = alternar(this.filtrosDestino, valor as FiltroDestino, input.checked);
    }
    this.render();
  }

  // ---------------------------------------------------------------------------
  // INTERCAMBIO RÁPIDO (FLIP) Origen ⇄ Destino
  // ---------------------------------------------------------------------------

  private enlazarSwap(): void {
    this.ui.swapBtn?.addEventListener('click', () => void this.intercambiar());
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
    if (this.ui.swapBtn) this.ui.swapBtn.disabled = true;

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
      if (this.ui.swapBtn) this.ui.swapBtn.disabled = false;
    }
  }

  /** Feedback visual: relanza la animación CSS del icono de flechas opuestas. */
  private animarSwap(): void {
    const icono = this.ui.swapBtn?.querySelector<SVGElement>('.mudanza-swap-icon');
    if (!icono) return;
    icono.classList.remove('mudanza-swap-animando');
    void icono.getBoundingClientRect(); // fuerza reflow para reiniciar la animación
    icono.classList.add('mudanza-swap-animando');
  }

  // ---------------------------------------------------------------------------
  // ZONA «EN TRÁNSITO» (estática, fuera del scroll del plano de habitaciones)
  // ---------------------------------------------------------------------------

  /**
   * Dibuja la receptora «En Tránsito» y delega su interacción al motor de
   * arrastre (`enlazarTransito()`), que se enlaza UNA sola vez en `init()`
   * porque la zona no se re-renderiza en cada hot reload.
   */
  private renderTransito(): void {
    this.ui.transito.innerHTML = htmlZonaTransito();
  }

  // ---------------------------------------------------------------------------
  // CARGA + HOT RELOAD (siempre vía mudanzaApi: listados PAGINADOS completos)
  // ---------------------------------------------------------------------------

  private async recargarTodo(): Promise<void> {
    if (!this.origenId || !this.destinoId) return;
    // Transición de carga limpia (Tailwind) en ambos paneles.
    this.ui.mapaOrigen.innerHTML = htmlCargando('Cargando inventario móvil…');
    this.ui.mapaDestino.innerHTML = htmlCargando('Cargando plano del destino…');
    this.contenedoresOrigen = [];
    this.objetosOrigen = [];
    this.ubicacionesDestino = [];
    this.contenedoresDestino = [];
    this.errorOrigen = null;
    this.errorDestino = null;

    await Promise.all([
      cargarInventarioOrigen(this.origenId)
        .then(({ contenedores, objetos }) => {
          this.contenedoresOrigen = contenedores;
          this.objetosOrigen = objetos;
        })
        .catch((err: unknown) => {
          this.errorOrigen = mensajeDe(err);
        }),
      cargarPlanoDestino(this.destinoId)
        .then(({ ubicaciones, contenedores }) => {
          this.ubicacionesDestino = ubicaciones;
          this.contenedoresDestino = contenedores;
        })
        .catch((err: unknown) => {
          this.errorDestino = mensajeDe(err);
        }),
    ]);

    this.render();
  }

  /**
   * Repinta AMBAS columnas desde el estado en memoria aplicando los filtros.
   * No consulta al servidor: es el punto único de refresco de los checkboxes.
   */
  private render(): void {
    this.dnd.limpiarSeleccion(); // el DOM se reemplaza: la selección por toque caduca
    this.ui.mapaOrigen.innerHTML = this.errorOrigen
      ? htmlVacio('No se pudo cargar el inventario del Estok origen', this.errorOrigen)
      : htmlInventarioMovil(this.contenedoresOrigen, this.objetosOrigen, this.filtrosOrigen);
    this.ui.mapaDestino.innerHTML = this.errorDestino
      ? htmlVacio('No se pudo cargar el plano del Estok destino', this.errorDestino)
      : htmlPlanoDestino(this.ubicacionesDestino, this.contenedoresDestino, this.filtrosDestino);
    this.renderBarras();
    this.enlazarDnD();
  }

  // ---------------------------------------------------------------------------
  // DRAG & DROP (mouse) + SUELTA POR TOQUE (móvil)
  // El motor vive aislado en mudanzaDnd.ts; acá sólo se re-vincula tras cada
  // repintado (las tarjetas y zonas son DOM nuevo) y se resuelve la mutación.
  // ---------------------------------------------------------------------------

  private enlazarDnD(): void {
    this.dnd.enlazarOrigen();
    this.dnd.enlazarDestino();
  }

  // ---------------------------------------------------------------------------
  // MUTACIÓN TRANSACCIONAL (POST /api/inventario/mudanza/)
  // ---------------------------------------------------------------------------

  private async mover(item: ItemMudanza, destino: ZonaSuelta): Promise<void> {
    if (!this.destinoId) return;
    this.mudando = true;
    const etiqueta = item.nombre ? `«${item.nombre}»` : 'el elemento';
    this.ui.mapaDestino.innerHTML = htmlCargando(`Mudando ${etiqueta}…`);

    try {
      const resultado = await enviarMudanza(item, this.destinoId, destino);
      if (!resultado.ok) {
        notificar('showError', resultado.mensaje);
        this.render();
        return;
      }
      notificar('showSuccess', resultado.mensaje);
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
