// =============================================================================
// TABLERO DE MUDANZA INTER-ESTOK - Drag & Drop entre inquilinatos
// -----------------------------------------------------------------------------
// Grilla simétrica de dos columnas:
//   - ORIGEN  : mapa jerárquico arrastrable (archivadores /archivador-login.png,
//               cajas /Nuevo Contenedor.png, objetos /fluffy_plush_ball.jpg).
//   - DESTINO : plano con habitaciones como drop zones.
// Al soltar un elemento se envía POST /api/inventario/mudanza/ con
// { contenedor_id | objeto_id, estok_destino_id, ubicacion_destino_id?,
//   contenedor_destino_id? }. El backend transfiere en bloque (cascada
// recursiva). Tras el HTTP 200 se refrescan AMBOS mapas en caliente.
// Auth centralizado: getAuthHeaders()/getToken() desde services/auth.
// =============================================================================

import { getAuthHeaders, getToken, getEstokActivoId, API_BASE_URL } from '../services/auth';
import type { EstokInfo } from '../types';
import { escapeHtml } from './mapaEstokWizard';

// =============================================================================
// TIPOS
// =============================================================================

interface UbiDto {
  id: string;
  nombre: string;
  estok?: string;
  parent_ubicacion?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
}

interface ContDto {
  id: string;
  nombre: string;
  ubicacion?: string;
  parent_contenedor?: string | null;
}

interface ObjDto {
  id: string;
  nombre: string;
  estok?: string;
  ubicacion?: string;
  contenedor?: string;
  deleted_at?: string | null;
}

interface DatosEstok {
  ubicaciones: UbiDto[];
  contenedores: ContDto[];
  objetos: ObjDto[];
}

type TipoItem = 'division' | 'habitacion' | 'contenedor' | 'objeto';

interface ItemMapa {
  tipo: TipoItem;
  id: string;
  nombre: string;
  esContenedorRaiz: boolean;
  hijos: ItemMapa[];
}

interface ItemDrag {
  tipo: 'contenedor' | 'objeto';
  id: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function pushList(map: Map<string, ItemMapa[]>, key: string, item: ItemMapa): void {
  const lista = map.get(key);
  if (lista) lista.push(item);
  else map.set(key, [item]);
}

const IMG_CONTENEDOR_GRANDE = '/archivador-login.png';
const IMG_CONTENEDOR_PEQUENO = '/Nuevo Contenedor.png';
const IMG_OBJETO = '/fluffy_plush_ball.jpg';

export class MudanzaBoard {
  private estoks: EstokInfo[] = [];
  private origenId: string | null = null;
  private destinoId: string | null = null;
  private datosOrigen: DatosEstok = { ubicaciones: [], contenedores: [], objetos: [] };
  private datosDestino: DatosEstok = { ubicaciones: [], contenedores: [], objetos: [] };
  private dragItem: ItemDrag | null = null;

  constructor(
    private readonly origenSel: HTMLSelectElement,
    private readonly destinoSel: HTMLSelectElement,
    private readonly mapaOrigen: HTMLElement,
    private readonly mapaDestino: HTMLElement,
  ) {}

  /** Inicializa selectores y carga ambos mapas. */
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
  // CARGA DE DATOS (por Estok, con X-Estok-Id propio)
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
    if (!response.ok) throw new Error(`Error al consultar el mapa (${response.status}).`);
    const data = await response.json();
    return (data.results || data) as T[];
  }

  private async cargarDatos(estokId: string): Promise<DatosEstok> {
    const [ubicaciones, contenedores, objetos] = await Promise.all([
      this.fetchJson<UbiDto>(`${API_BASE_URL}/ubicaciones/?page_size=1000`, estokId),
      this.fetchJson<ContDto>(`${API_BASE_URL}/contenedores/?page_size=1000`, estokId),
      this.fetchJson<ObjDto>(`${API_BASE_URL}/objetos/?page_size=1000`, estokId),
    ]);
    return { ubicaciones, contenedores, objetos: objetos.filter((o) => !o.deleted_at) };
  }


  // ---------------------------------------------------------------------------
  // CONSTRUCCIÓN DEL ÁRBOL JERÁRQUICO
  // ---------------------------------------------------------------------------

  private construirArbol(data: DatosEstok): ItemMapa[] {
    const divisionesRaw = data.ubicaciones.filter((u) => u.parent_grid_row && !u.parent_grid_col);
    const habitacionesRaw = data.ubicaciones.filter((u) => !(u.parent_grid_row && !u.parent_grid_col));

    const contItems = new Map<string, ItemMapa>();
    for (const c of data.contenedores) {
      contItems.set(c.id, {
        tipo: 'contenedor',
        id: c.id,
        nombre: c.nombre,
        esContenedorRaiz: !c.parent_contenedor,
        hijos: [],
      });
    }

    // Objetos: dentro de su contenedor, o sueltos en la habitación.
    const objsPorContenedor = new Map<string, ItemMapa[]>();
    const objsPorUbicacion = new Map<string, ItemMapa[]>();
    for (const o of data.objetos) {
      const item: ItemMapa = { tipo: 'objeto', id: o.id, nombre: o.nombre, esContenedorRaiz: false, hijos: [] };
      if (o.contenedor && contItems.has(o.contenedor)) pushList(objsPorContenedor, o.contenedor, item);
      else if (o.ubicacion) pushList(objsPorUbicacion, o.ubicacion, item);
    }

    // Sub-contenedores dentro de su padre; objetos dentro de su contenedor.
    for (const c of data.contenedores) {
      const item = contItems.get(c.id)!;
      if (c.parent_contenedor && contItems.has(c.parent_contenedor)) {
        contItems.get(c.parent_contenedor)!.hijos.push(item);
      }
    }
    for (const [cid, objs] of objsPorContenedor) {
      const cont = contItems.get(cid);
      if (cont) cont.hijos.push(...objs);
    }

    // Habitaciones (items vivos por id).
    const habPorId = new Map<string, ItemMapa>();
    for (const h of habitacionesRaw) {
      habPorId.set(h.id, {
        tipo: 'habitacion',
        id: h.id,
        nombre: h.nombre,
        esContenedorRaiz: false,
        hijos: [],
      });
    }
    // Contenedores raíz → su habitación; objetos sueltos → su habitación.
    for (const c of data.contenedores) {
      if (!c.parent_contenedor) {
        const hab = habPorId.get(c.ubicacion || '');
        if (hab) hab.hijos.push(contItems.get(c.id)!);
      }
    }
    for (const [uid, objs] of objsPorUbicacion) {
      const hab = habPorId.get(uid);
      if (hab) hab.hijos.push(...objs);
    }

    // Divisiones del macro-plano → habitaciones; resto bajo "Sin división".
    const divPorId = new Map<string, ItemMapa>();
    for (const d of divisionesRaw) {
      divPorId.set(d.id, {
        tipo: 'division',
        id: d.id,
        nombre: d.nombre,
        esContenedorRaiz: false,
        hijos: [],
      });
    }
    const sueltos: ItemMapa = { tipo: 'division', id: '__sueltos', nombre: 'Sin división', esContenedorRaiz: false, hijos: [] };
    for (const h of habitacionesRaw) {
      const item = habPorId.get(h.id);
      if (!item) continue;
      const div = h.parent_ubicacion ? divPorId.get(h.parent_ubicacion) : undefined;
      if (div) div.hijos.push(item);
      else sueltos.hijos.push(item);
    }
    const raices: ItemMapa[] = [...divPorId.values()];
    if (sueltos.hijos.length > 0) raices.push(sueltos);
    return raices;
  }


  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  private async recargarTodo(): Promise<void> {
    if (!this.origenId || !this.destinoId) return;
    this.mapaOrigen.innerHTML = '<p class="mudanza-cargando">Cargando mapa de origen…</p>';
    this.mapaDestino.innerHTML = '<p class="mudanza-cargando">Cargando plano de destino…</p>';
    try {
      const [datosOrigen, datosDestino] = await Promise.all([
        this.cargarDatos(this.origenId),
        this.cargarDatos(this.destinoId),
      ]);
      this.datosOrigen = datosOrigen;
      this.datosDestino = datosDestino;
    } catch (err: any) {
      (window as any).showError?.(err?.message || 'Error al cargar los mapas.');
    }
    this.render();
  }

  private render(): void {
    this.mapaOrigen.innerHTML = this.renderPanel(this.datosOrigen, false);
    this.mapaDestino.innerHTML = this.renderPanel(this.datosDestino, true);
    this.enlazarDnD();
  }

  private renderPanel(data: DatosEstok, esDestino: boolean): string {
    const arbol = this.construirArbol(data);
    if (arbol.length === 0) {
      return `<div class="mudanza-vacio">${
        esDestino
          ? 'El Estok destino aún no tiene espacios modelados. Activá el Mapa de Estok en Almacenamiento.'
          : 'El Estok origen no tiene espacios para mudar.'
      }</div>`;
    }
    return arbol.map((n) => this.renderItem(n, esDestino)).join('');
  }

  private iconoDe(item: ItemMapa): string {
    if (item.tipo === 'division') return '🗂️';
    if (item.tipo === 'habitacion') return '🚪';
    if (item.tipo === 'contenedor') {
      return item.esContenedorRaiz
        ? `<img src="${IMG_CONTENEDOR_GRANDE}" alt="Archivador" class="mudanza-ico-img" />`
        : `<img src="${IMG_CONTENEDOR_PEQUENO}" alt="Caja" class="mudanza-ico-img" />`;
    }
    return `<img src="${IMG_OBJETO}" alt="Objeto" class="mudanza-ico-img" />`;
  }

  private renderItem(item: ItemMapa, esDestino: boolean): string {
    const draggable = !esDestino && (item.tipo === 'contenedor' || item.tipo === 'objeto');
    const esDropHabitacion = esDestino && item.tipo === 'habitacion';
    const esDropContenedor = esDestino && item.tipo === 'contenedor';

    const attrs = [
      draggable ? `draggable="true" data-drag="${item.tipo}" data-drag-id="${item.id}"` : '',
      esDropHabitacion ? `data-drop-ubicacion="${item.id}"` : '',
      esDropContenedor ? `data-drop-contenedor="${item.id}"` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const etiquetaCont = item.tipo === 'contenedor' ? `<span class="mudanza-chip">${item.esContenedorRaiz ? 'archivador' : 'caja'}</span>` : '';
    const hintDrop = esDestino && (esDropHabitacion || esDropContenedor) ? '<span class="mudanza-drop-hint">soltar aquí</span>' : '';
    const hijos = item.hijos.map((h) => this.renderItem(h, esDestino)).join('');

    return `
      <div class="mudanza-nodo ${esDropHabitacion ? 'mudanza-drop-zona' : ''} ${esDropContenedor ? 'mudanza-drop-caja' : ''} ${draggable ? 'mudanza-drag-item' : ''}" ${attrs}>
        <div class="mudanza-nodo-fila">
          <span class="mudanza-nodo-ico">${this.iconoDe(item)}</span>
          <span class="mudanza-nodo-nombre">${escapeHtml(item.nombre)}</span>
          ${etiquetaCont}
          ${hintDrop}
        </div>
        ${hijos ? `<div class="mudanza-hijos">${hijos}</div>` : ''}
      </div>`;
  }


  // ---------------------------------------------------------------------------
  // DRAG & DROP
  // ---------------------------------------------------------------------------

  private enlazarDnD(): void {
    const mapas = [this.mapaOrigen, this.mapaDestino];

    mapas.forEach((mapa) => {
      mapa.querySelectorAll<HTMLElement>('[data-drag]').forEach((el) => {
        el.addEventListener('dragstart', (e) => {
          const tipo = el.dataset.drag as 'contenedor' | 'objeto';
          const id = el.dataset.dragId || '';
          if (!id) return;
          this.dragItem = { tipo, id };
          el.classList.add('mudanza-dragging');
          e.dataTransfer?.setData('text/plain', `${tipo}:${id}`);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });
        el.addEventListener('dragend', () => {
          el.classList.remove('mudanza-dragging');
          this.dragItem = null;
          this.limpiarDropHover();
        });
      });

      mapa.querySelectorAll<HTMLElement>('[data-drop-ubicacion],[data-drop-contenedor]').forEach((el) => {
        el.addEventListener('dragover', (e) => {
          if (!this.dragItem) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          el.classList.add('mudanza-drop-hover');
        });
        el.addEventListener('dragleave', () => el.classList.remove('mudanza-drop-hover'));
        el.addEventListener('drop', (e) => this.onDrop(e));
      });
    });
  }

  private limpiarDropHover(): void {
    this.mapaDestino.querySelectorAll('.mudanza-drop-hover').forEach((el) => el.classList.remove('mudanza-drop-hover'));
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    const objetivo = (e.target as HTMLElement).closest('[data-drop-contenedor],[data-drop-ubicacion]') as HTMLElement | null;
    this.limpiarDropHover();
    if (!objetivo || !this.dragItem) return;
    const item = this.dragItem;
    const contenedorId = objetivo.dataset.dropContenedor;
    const ubicacionId = objetivo.dataset.dropUbicacion;
    void this.mover(item, { contenedorId, ubicacionId });
  }

  // ---------------------------------------------------------------------------
  // PERSISTENCIA (POST /api/inventario/mudanza/) + HOT RELOAD
  // ---------------------------------------------------------------------------

  private async mover(item: ItemDrag, destino: { contenedorId?: string; ubicacionId?: string }): Promise<void> {
    if (!this.destinoId || !item.id) return;

    const body: Record<string, unknown> = { estok_destino_id: this.destinoId };
    if (item.tipo === 'contenedor') body.contenedor_id = item.id;
    else body.objeto_id = item.id;
    if (destino.contenedorId) body.contenedor_destino_id = destino.contenedorId;
    else if (destino.ubicacionId) body.ubicacion_destino_id = destino.ubicacionId;

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
        (window as any).showError?.(data?.error || `Error del servidor (${response.status}).`);
        return;
      }

      const data = await response.json();
      (window as any).showSuccess?.(data?.mensaje || '✅ Mudanza completada.');
      // HOT RELOAD: ambos mapas se refrescan sin recargar la página entera.
      await this.recargarTodo();
    } catch (err: any) {
      (window as any).showError?.(err?.message || 'Error de conexión durante la mudanza.');
    }
  }
}

