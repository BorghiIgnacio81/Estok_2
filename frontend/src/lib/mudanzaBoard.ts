// =============================================================================
// TABLERO DE MUDANZA INTER-ESTOK — orquestación de UI (DnD + filtros + toque)
// -----------------------------------------------------------------------------
// Grilla de dos columnas lado a lado (también en móvil): ORIGEN (filtros +
// inventario móvil arrastrable) y DESTINO (filtros + zona «En Tránsito» + plano
// receptor en dos escalas: suelta gruesa en la habitación y fina en el mueble).
// Los filtros son 100% REACTIVOS EN EL CLIENTE: marcar/desmarcar sólo repinta
// los grupos desde el estado en memoria, sin nuevas peticiones al servidor.
//
// Responsabilidades delegadas (archivos chicos y testeables):
//   mudanzaApi · mudanzaInventario · mudanzaFiltros · mudanzaDnd
//   mudanzaMapaDestino · mudanzaDestinoVista · mudanzaTransito
//   mudanzaSwap · mudanzaAvisos
// =============================================================================

import { getEstokActivoId } from '../services/auth';
import type { EstokInfo } from '../types';
import { escapeHtml } from './mapaJerarquico';
import { cargarInventarioOrigen, cargarPlanoDestino, enviarMudanza } from './mudanzaApi';
import type { ContenedorDto, ItemMudanza, ObjetoDto, UbicacionDto } from './mudanzaApi';
import { mensajeDe, notificar } from './mudanzaAvisos';
import { MudanzaDndTactil } from './mudanzaDnd';
import type { ZonaSuelta } from './mudanzaDnd';
import { IntercambioEstoks } from './mudanzaSwap';
import { pintarEstadoDestino, pintarMapaDestino } from './mudanzaDestinoVista';
import type { EstadoMapaDestino, NodosDestino } from './mudanzaDestinoVista';
import { ZonaTransitoDestino } from './mudanzaTransito';
import { contarOrigen, htmlCargando, htmlInventarioMovil, htmlVacio } from './mudanzaInventario';
import { contarDestino, reiniciarVistaDestino, resolverClickMapaDestino } from './mudanzaMapaDestino';
import { FILTROS_DESTINO, FILTROS_ORIGEN, alternar, filtrosActivos, filtrosOrigenEfectivos, htmlBarraFiltros, htmlToggleSoloCajas } from './mudanzaFiltros';
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
  /** Cabezales donde se inyectan las barras de filtros de cada columna. */
  filtrosOrigen: HTMLElement;
  filtrosDestino: HTMLElement;
  /** Host del componente global MinimapaRuta.astro con la red de minimapas
   *  COMPACTADOS de los niveles previos (cabezal de contexto en cascada). */
  rutaDestino: HTMLElement;
  /** Botón «⬅ Volver» y contenedor del cabezal de contexto en cascada. */
  volverDestino: HTMLButtonElement;
  cascadaDestino: HTMLElement;
  /** Host del PLANO UNIFICADO (`<MinimapaRuta plano />`) + su detalle/cabecera:
   *  el tablero sólo escribe DENTRO de ellos. */
  planoDestino: HTMLElement;
  detalleDestino: HTMLElement;
}

export class MudanzaBoard {
  private estoks: EstokInfo[] = [];
  private origenId: string | null = null;
  private destinoId: string | null = null;
  /** Estok destino del último render del mapa (detecta el cambio de destino). */
  private destinoVisto: string | null = null;
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
  /** Atajo «Solo cajas»: sólo el grupo de cajas móviles a la vista. */
  private soloCajas = false;
  /** Motor de arrastre/suelta (mouse y toque) sobre las dos columnas. */
  private readonly dnd: MudanzaDndTactil;
  /** Nodos de la columna Destino (los consume la vista pura del plano). */
  private readonly nodosDestino: NodosDestino;
  /** Zona «En Tránsito»: chips reales del limbo + feedback inmediato de la suelta. */
  private readonly transitoZona: ZonaTransitoDestino;
  /** Intercambio rápido (FLIP) Origen ⇄ Destino. */
  private readonly swap: IntercambioEstoks;

  constructor(private readonly ui: NodosMudanza) {
    this.dnd = new MudanzaDndTactil({
      mapaOrigen: ui.mapaOrigen,
      mapaDestino: ui.mapaDestino,
      transito: ui.transito,
      estaMudando: () => this.mudando,
      alSoltar: (item, zona) => void this.mover(item, zona),
    });
    this.nodosDestino = {
      plano: ui.planoDestino,
      detalle: ui.detalleDestino,
      ruta: ui.rutaDestino,
      volver: ui.volverDestino,
    };
    this.transitoZona = new ZonaTransitoDestino({
      host: ui.transito,
      estokDestino: () => this.destinoId,
    });
    this.swap = new IntercambioEstoks({
      boton: ui.swapBtn,
      estaOcupado: () => this.intercambiando || this.mudando,
      ids: () => ({ origenId: this.origenId, destinoId: this.destinoId }),
      invertir: () => this.invertirEstoks(),
      sincronizarSelects: () => this.renderSelects(),
      recargar: () => this.recargarTodo(),
      marcarOcupado: (ocupado) => {
        this.intercambiando = ocupado;
      },
    });
    // Navegación del mapa del destino: se registra UNA sola vez y en FASE DE
    // CAPTURA para resolver la navegación ANTES que la suelta por toque del
    // motor de arrastre (el DOM del panel se reemplaza en cada repintado).
    // DOS hosts: el PANEL del plano (siluetas + chips) y el CABEZAL de contexto
    // en cascada (minimapas compactados + «⬅ Volver»), que vive en la cabecera
    // de la columna y por eso NO es descendiente del panel.
    const clickDestino = (e: MouseEvent): void =>
      resolverClickMapaDestino(e, {
        haySeleccion: () => this.dnd.haySeleccion(),
        limpiarSeleccion: () => this.dnd.limpiarSeleccion(),
        repintar: () => this.render(),
      });
    ui.mapaDestino.addEventListener('click', clickDestino, true);
    ui.cascadaDestino.addEventListener('click', clickDestino, true);
  }

  /** Inicializa selectores, filtros y carga el inventario móvil + el plano destino. */
  async init(estoks: EstokInfo[]): Promise<void> {
    this.estoks = estoks;
    const activo = getEstokActivoId();
    this.origenId = this.estoks.find((e) => e.id === activo)?.id || this.estoks[0]?.id || null;
    this.destinoId = this.estoks.find((e) => e.id !== this.origenId)?.id || null;
    this.renderSelects();
    this.enlazarSelects();
    this.swap.enlazar();
    this.enlazarFiltros();
    this.transitoZona.montar();
    this.dnd.enlazarTransito();
    this.renderBarras();
    await this.recargarTodo();
  }

  // ---------------------------------------------------------------------------
  // ESTADO DE LOS ESTOKS (swap atómico que consume lib/mudanzaSwap.ts)
  // ---------------------------------------------------------------------------

  /** Invierte las dos referencias de Estok (paso atómico del FLIP). */
  private invertirEstoks(): void {
    const previo = this.origenId;
    this.origenId = this.destinoId;
    this.destinoId = previo;
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
    // Barra granular (Objetos sueltos · Muebles · Cajas) MÁS el atajo destacado
    // «Solo cajas», en la misma fila y en el cabezal que no se re-renderiza.
    this.ui.filtrosOrigen.innerHTML = `<div class="flex flex-wrap items-center gap-1">${htmlBarraFiltros(
      'origen',
      FILTROS_ORIGEN,
      this.filtrosOrigen,
      contarOrigen(this.contenedoresOrigen, this.objetosOrigen),
    )}${htmlToggleSoloCajas(this.soloCajas)}</div>`;
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
    // Atajo destacado «Solo cajas»: no es un grupo de inventario, es un
    // interruptor que reescribe el set de filtros del Origen.
    if (input?.dataset?.soloCajas !== undefined) {
      this.soloCajas = input.checked;
      this.render();
      return;
    }
    const valor = input?.dataset?.filtroValor;
    if (!valor) return;
    if (grupo === 'origen') {
      // Tocar la barra granular devuelve el control al usuario: el atajo se apaga
      // para que el checkbox recién marcado se refleje sin ambigüedad.
      this.soloCajas = false;
      this.filtrosOrigen = alternar(this.filtrosOrigen, valor as FiltroOrigen, input.checked);
    } else {
      this.filtrosDestino = alternar(this.filtrosDestino, valor as FiltroDestino, input.checked);
    }
    this.render();
  }

  // El INTERCAMBIO RÁPIDO (FLIP) Origen ⇄ Destino vive en lib/mudanzaSwap.ts:
  // este tablero sólo le presta el estado y el refresco en caliente.

  // La ZONA «EN TRÁNSITO» (receptora estática + chips del limbo) vive en
  // lib/mudanzaTransito.ts: el tablero sólo le pasa el host y el destino vigente.

  // ---------------------------------------------------------------------------
  // CARGA + HOT RELOAD (siempre vía mudanzaApi: listados PAGINADOS completos)
  // ---------------------------------------------------------------------------

  private async recargarTodo(): Promise<void> {
    if (!this.origenId || !this.destinoId) return;
    // El mapa del destino arranca SIEMPRE en el plano general cuando cambia el
    // Estok destino (carga inicial, cambio de selector o intercambio), pero se
    // conserva el nivel abierto en los refrescos posteriores a una mudanza.
    if (this.destinoVisto !== this.destinoId) {
      reiniciarVistaDestino();
      this.destinoVisto = this.destinoId;
    }
    // Transición de carga limpia (Tailwind) en ambos paneles.
    this.ui.mapaOrigen.innerHTML = htmlCargando('Cargando inventario móvil…');
    pintarEstadoDestino(htmlCargando('Cargando plano del destino…'), this.nodosDestino);
    this.transitoZona.mostrarCargando();
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
      // Bultos «En Tránsito» del destino: la zona se alimenta sola y NUNCA
      // bloquea el refresco (captura sus propios errores de red).
      this.transitoZona.cargar(this.destinoId),
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
      : htmlInventarioMovil(
          this.contenedoresOrigen,
          this.objetosOrigen,
          // El atajo «Solo cajas» reescribe el set de grupos visibles del Origen.
          filtrosOrigenEfectivos(this.soloCajas, this.filtrosOrigen),
        );
    pintarMapaDestino(this.estadoDestino(), this.nodosDestino);
    this.renderBarras();
    this.enlazarDnD();
  }

  /** Nombre del Estok destino vigente (contexto raíz de la jerarquía). */
  private nombreDestino(): string {
    return this.estoks.find((e) => e.id === this.destinoId)?.nombre || 'Estok destino';
  }

  /**
   * Estado vigente de la columna Destino, en el shape de la vista pura
   * (lib/mudanzaDestinoVista.ts): plano, detalle y cabezal en cascada.
   */
  private estadoDestino(): EstadoMapaDestino {
    return {
      ubicaciones: this.ubicacionesDestino,
      contenedores: this.contenedoresDestino,
      filtros: this.filtrosDestino,
      error: this.errorDestino,
      nombre: this.nombreDestino(),
    };
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
    pintarEstadoDestino(htmlCargando(`Mudando ${etiqueta}…`), this.nodosDestino);
    // FEEDBACK INMEDIATO: si la suelta es al limbo, el chip entra al DOM ya mismo
    // (estado «mudando…»); el servidor lo confirma en el refresco posterior.
    if (destino.enTransito) this.transitoZona.insertarOptimista(item);

    try {
      const resultado = await enviarMudanza(item, this.destinoId, destino);
      if (!resultado.ok) {
        this.transitoZona.descartarOptimista(item);
        notificar('showError', resultado.mensaje);
        this.render();
        return;
      }
      notificar('showSuccess', resultado.mensaje);
      // HOT RELOAD: ambos paneles se refrescan sin recargar la página entera.
      await this.recargarTodo();
    } catch (err: unknown) {
      this.transitoZona.descartarOptimista(item);
      notificar('showError', mensajeDe(err));
      this.render();
    } finally {
      this.mudando = false;
    }
  }
}

// Los HELPERS DE AVISOS (`notificar` / `mensajeDe`) viven en lib/mudanzaAvisos.ts.
