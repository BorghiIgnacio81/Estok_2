// =============================================================================
// ZONA «EN TRÁNSITO» DEL TABLERO DE MUDANZAS (receptora viva del limbo)
// -----------------------------------------------------------------------------
// La columna Destino tiene una receptora ESTÁTICA (fuera del scroll del plano de
// habitaciones) donde se suelta —o se toca— un elemento que debe viajar al Estok
// destino SIN ubicación física. Este módulo la gobierna por completo:
//
//   · `montar()`  → dibuja la receptora UNA sola vez. El nodo marcado con
//     `data-drop-transito` NUNCA se reemplaza (sólo su lista interna), así los
//     listeners del motor de arrastre (mudanzaDnd) no caducan al repintar.
//   · `cargar()`  → pide los bultos que HOY están en el limbo del Estok destino
//     (objetos huérfanos: `ubicacion`/`contenedor` nulos) y los pinta como chips:
//     el operador VE lo que dejó en tránsito, no un cartel vacío.
//   · `insertarOptimista()` / `descartarOptimista()` → el chip del elemento
//     soltado entra al DOM ANTES de la respuesta del servidor (feedback
//     inmediato) y se retira si la mudanza falla. Al refrescar, el servidor es
//     la autoridad del listado.
//
// Estado 100% local: el tablero sólo aporta el host y el Estok destino vigente.
// =============================================================================

import { cargarTransitoDestino } from './mudanzaApi';
import type { ItemMudanza, ObjetoDto } from './mudanzaApi';
import { indicadorTransitoHtml } from './indicadorTransito';
import { escapeHtml } from './mapaJerarquico';
// Iconografía de interfaz: rutas canónicas (WebP optimizados) en UN solo módulo.
import { ASSET_MUEBLE } from './assetsUi';

const IMG_OBJETO = ASSET_MUEBLE;
const SIN_NOMBRE = 'Elemento sin nombre';

export interface OpcionesZonaTransito {
  /** Host estático de la página (`#mudanzaTransito`). */
  host: HTMLElement;
  /** Estok destino vigente (cambia con el selector y con el intercambio FLIP). */
  estokDestino: () => string | null;
}

/** Chip de un bulto que está en el limbo del Estok destino. */
interface ChipTransito {
  id: string;
  nombre: string;
  /** La suelta todavía está en vuelo (chip optimista, POST en curso). */
  pendiente: boolean;
}

export class ZonaTransitoDestino {
  /** Bultos reales del limbo (autoridad: el servidor). */
  private objetos: ObjetoDto[] = [];
  /** Chips insertados en caliente antes de la respuesta del servidor. */
  private optimistas: ChipTransito[] = [];
  private lista: HTMLElement | null = null;
  private contador: HTMLElement | null = null;

  constructor(private readonly opciones: OpcionesZonaTransito) {}

  // ---------------------------------------------------------------------------
  // MONTAJE ESTABLE (una sola vez por sesión de tablero)
  // ---------------------------------------------------------------------------

  /** Dibuja la receptora con su lista interna de chips (nodos persistentes). */
  montar(): void {
    this.opciones.host.innerHTML = `
      <div class="mudanza-transito estado-transito-zona"
        data-drop-transito="1"
        title="Soltá (o tocá) acá para mudar el elemento al Estok destino SIN ubicación física">
        <div class="flex items-center gap-2">
          ${indicadorTransitoHtml('general')}
          <div class="min-w-0 flex-1">
            <p class="min-w-0 flex-1 truncate text-[10px] leading-snug text-amber-700/90 sm:text-[11px]">
              Limbo del destino: viaja sin ubicación física
            </p>
          </div>
          <span class="mudanza-transito-contador" data-transito-contador>0</span>
        </div>
        <p class="mudanza-drop-hint mt-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">soltar acá</p>
        <ul class="mudanza-transito-lista" data-transito-lista aria-live="polite"></ul>
      </div>`;
    this.lista = this.opciones.host.querySelector<HTMLElement>('[data-transito-lista]');
    this.contador = this.opciones.host.querySelector<HTMLElement>('[data-transito-contador]');
    this.pintar();
  }

  // ---------------------------------------------------------------------------
  // CARGA (autoridad del servidor)
  // ---------------------------------------------------------------------------

  /**
   * Trae los bultos del limbo del Estok destino y repinta. NUNCA lanza: si la
   * red falla, la zona queda vacía sin tumbar el refresco del tablero.
   */
  async cargar(estokId: string | null): Promise<void> {
    this.optimistas = []; // el servidor pasa a ser la autoridad del listado
    try {
      this.objetos = estokId ? await cargarTransitoDestino(estokId) : [];
    } catch {
      this.objetos = [];
    }
    this.pintar();
  }

  /** Estado transitorio: el Estok destino está recargando su inventario. */
  mostrarCargando(): void {
    this.optimistas = [];
    this.objetos = [];
    this.pintar();
  }

  // ---------------------------------------------------------------------------
  // FEEDBACK INMEDIATO DE LA SUELTA (chip en el DOM antes de la respuesta)
  // ---------------------------------------------------------------------------

  /** Inserta el chip del elemento soltado AL INSTANTE (mudanza aún en vuelo). */
  insertarOptimista(item: ItemMudanza): void {
    if (!this.lista) return;
    const yaEsta =
      this.objetos.some((o) => o.id === item.id) ||
      this.optimistas.some((c) => c.id === item.id);
    if (yaEsta) return;
    const chip: ChipTransito = {
      id: item.id,
      nombre: item.nombre || SIN_NOMBRE,
      pendiente: true,
    };
    this.optimistas = [...this.optimistas, chip];
    this.pintar();
  }

  /** Retira el chip optimista (la mudanza falló: nada llegó al limbo). */
  descartarOptimista(item: ItemMudanza): void {
    if (!this.optimistas.some((c) => c.id === item.id)) return;
    this.optimistas = this.optimistas.filter((c) => c.id !== item.id);
    this.pintar();
  }

  // ---------------------------------------------------------------------------
  // RENDER (chips reales + chips en vuelo)
  // ---------------------------------------------------------------------------

  private pintar(): void {
    if (!this.lista) return;
    const chips: ChipTransito[] = [
      ...this.optimistas,
      ...this.objetos.map((o) => ({
        id: o.id,
        nombre: o.nombre || SIN_NOMBRE,
        pendiente: false,
      })),
    ];
    this.lista.innerHTML = chips.length
      ? chips.map((c) => chipHtml(c)).join('')
      : '<li class="mudanza-transito-vacio">Nada en tránsito todavía</li>';
    if (this.contador) this.contador.textContent = String(chips.length);
  }
}

/** Chip de un bulto del limbo: icono + nombre + estado de la suelta. */
function chipHtml(chip: ChipTransito): string {
  const clase = chip.pendiente
    ? 'mudanza-transito-chip is-pendiente'
    : 'mudanza-transito-chip';
  const estado = chip.pendiente ? 'mudando…' : 'en tránsito';
  return `
    <li class="${clase}" data-transito-chip="${escapeHtml(chip.id)}"
      title="${escapeHtml(chip.nombre)} · ${estado}">
      <img src="${IMG_OBJETO}" alt="" class="mudanza-transito-chip-ico" />
      <span class="mudanza-transito-chip-nombre">${escapeHtml(chip.nombre)}</span>
    </li>`;
}
