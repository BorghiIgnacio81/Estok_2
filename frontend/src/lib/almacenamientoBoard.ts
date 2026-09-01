// =============================================================================
// TABLERO DE ALMACENAMIENTO - Drag & Drop nativo (HTML5 API)
// -----------------------------------------------------------------------------
// Unifica "Ubicaciones" y "Contenedores" en una única vista de dos columnas:
//   - Columna izquierda : Ubicaciones raíz como zonas de caída (drop zones)
//     que listan internamente sus contenedores y sub-contenedores.
//   - Columna derecha   : Paleta de contenedores raíz (draggable="true").
//
// Lienzo de Mapeo Espacial Jerárquico:
//   - Iconografía estricta por imágenes locales:
//       Contenedor grande (contiene contenedores): /archivador-login.png
//       Contenedor pequeño (solo objetos)        : /Nuevo Contenedor.png
//       Objeto individual                        : /fluffy_plush_ball.jpg
//   - Grilla asimétrica: cada contenedor define la cantidad de Filas globales
//     (NumericUp/Down) y CADA fila define su propia cantidad de Columnas.
//   - Al soltar en un casillero se persisten parent_grid_row / parent_grid_col
//     como enteros y el minimapa superior del elemento se ilumina en NARANJA
//     (#f97316) en vivo.
//
// Persistencia: PUT /api/contenedores/{id}/ y PUT /api/ubicaciones/{id}/ con
// payloads parciales (el backend soporta update() con partial=True).
// =============================================================================

import { getAuthHeaders, getEstokActivoId, API_BASE_URL } from '../services/auth';
import { minimapaPlantaHtml, minimapaInternoHtml } from './mapaJerarquico';

// =============================================================================
// ICONOGRAFÍA LOCAL (especificación estricta del Lienzo de Mapeo)
// =============================================================================

/** Contenedor que contiene OTROS contenedores (nivel superior). */
const IMG_CONTENEDOR_GRANDE = '/archivador-login.png';
/** Contenedor que solo contiene objetos (casillero simple). */
const IMG_CONTENEDOR_PEQUENO = '/Nuevo Contenedor.png';
/** Ítem individual dentro de un contenedor. */
const IMG_OBJETO = '/fluffy_plush_ball.jpg';

// =============================================================================
// TIPOS
// =============================================================================

export interface ContenedorDnD {
  id: string;
  nombre: string;
  descripcion: string;
  ubicacion: string;
  ubicacion_nombre: string;
  parent_contenedor: string | null;
  parent_contenedor_nombre: string | null;
  /** Coordenadas relativas del casillero dentro de la grilla del contenedor padre. */
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  /** Filas globales de la grilla interna del contenedor. */
  grid_filas?: number | null;
  /** Columnas por defecto (fallback si grid_filas_config es null). */
  grid_columnas?: number | null;
  /** Columnas por fila para grillas asimétricas (ej: [3,2,2]). */
  grid_filas_config?: number[] | null;
  /** Mueble inmueble fijo: no se arrastra ni elimina desde la pantalla. */
  es_inmueble?: boolean;
  objetos_count: number;
  qr_code_url: string | null;
  largo?: string | number | null;
  ancho?: string | number | null;
  alto?: string | number | null;
  foto?: string | null;
  hijos: ContenedorDnD[];
}

export interface UbicacionDnD {
  id: string;
  nombre: string;
  descripcion: string;
  /** Piso de la casa (PRIMER_PISO | PLANTA_BAJA) + cuadrante en el plano. */
  piso?: string;
  /** División padre del Mapa Estok donde está encastrada esta habitación. */
  parent_ubicacion?: string | null;
  parent_ubicacion_nombre?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  /** Sub-grilla interna de la división (Filas Internas / Columnas / asimétrica). */
  grid_filas?: number | null;
  grid_columnas?: number | null;
  grid_filas_config?: number[] | null;
  grid_colspan?: number | null;
  grid_rowspan?: number | null;
  objetos_count: number;
  contenedores_count: number;
  largo?: string | number | null;
  ancho?: string | number | null;
  alto?: string | number | null;
  foto?: string | null;
  raices: ContenedorDnD[];
}

/** Ítem individual representado con /fluffy_plush_ball.jpg en el lienzo. */
export interface ObjetoDnD {
  id: string;
  nombre: string;
  contenedor?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  foto_principal?: string | null;
}

/** Campos comunes editables desde el modal (nombre + medidas + foto + grilla). */
export interface EntidadEditable {
  id: string;
  nombre: string;
  descripcion: string;
  largo?: string | number | null;
  ancho?: string | number | null;
  alto?: string | number | null;
  foto?: string | null;
  grid_filas?: string | number | null;
  grid_columnas?: string | number | null;
  grid_filas_config?: number[] | null;
  /** Mueble inmueble fijo: no se arrastra ni elimina desde la pantalla. */
  es_inmueble?: boolean;
}

// =============================================================================
// HELPERS
// =============================================================================

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Formatea las medidas "Alto × Ancho × Largo" (solo si al menos una existe). */
function formatearMedidas(e: EntidadEditable): string | null {
  const valores = [e.alto, e.ancho, e.largo].filter(
    (v) => v !== null && v !== undefined && v !== '',
  ) as Array<string | number>;
  if (!valores.length) return null;
  return valores.map((v) => String(Number(v))).join(' × ');
}

/** Acota un número entero entre min y max (para los NumericUp/Down). */
function acotar(v: number, min: number, max: number): number {
  const n = Math.floor(Number.isFinite(v) ? v : min);
  return Math.min(max, Math.max(min, n));
}

const ICONO_OJO =
  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>';

const ICONO_PAPELERA =
  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>';

const ICONO_UBICACION =
  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>';

const ICONO_LAPIZ =
  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>';

/** Imagen local que representa un contenedor según su nivel jerárquico. */
function imagenContenedor(c: ContenedorDnD): string {
  return c.hijos.length ? IMG_CONTENEDOR_GRANDE : IMG_CONTENEDOR_PEQUENO;
}

// =============================================================================
// CLASE PRINCIPAL DEL TABLERO
// =============================================================================

export class AlmacenamientoBoard {
  private ubicaciones: UbicacionDnD[] = [];
  private contenedores: ContenedorDnD[] = [];
  private contenedoresPorId = new Map<string, ContenedorDnD>();
  /** Ítems agrupados por contenedor (representados con /fluffy_plush_ball.jpg). */
  private objetosPorContenedor = new Map<string, ObjetoDnD[]>();
  private dragTipo: 'contenedor' | 'objeto' | null = null;
  private dragId: string | null = null;
  private previewObjectUrl: string | null = null;
  private cargarPromise: Promise<void> | null = null;
  /** Grilla (filas×columnas) del macro-Estok, usada para los minimapas de planta. */
  private estokFilas = 3;
  private estokColumnas = 3;
  /** Fila/división seleccionada en el Mapa Estok (Nivel 1). null = todas. */
  private filaFiltro: number | null = null;
  /** Nombre de la división seleccionada (para el badge de la cascada). */
  private filaFiltroNombre: string | null = null;
  /** Divisiones del Mapa Estok por id (para resolver sub-grillas y filtros). */
  private divisionesPorId = new Map<string, UbicacionDnD>();

  // ---------------------------------------------------------------------------
  // INICIO
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    this.enlazarBotonesHeader();
    this.enlazarModales();
    document.getElementById('retryBtn')?.addEventListener('click', () => { void this.cargar(); });
    // Si el Mapa Jerárquico cambió ubicaciones/grillas, el tablero se refresca.
    window.addEventListener('estok:espacios-cambiados', () => { void this.cargar(); });
    // Edición en caliente pedida desde el Visor (✏️ junto a cada mueble).
    window.addEventListener('estok:editar-contenedor', (e) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      const c = this.contenedoresPorId.get(id);
      if (c) this.abrirModalEditar('contenedor', c);
    });
    await this.cargar();
  }

  // ---------------------------------------------------------------------------
  // CARGA DE DATOS (con paginación robusta)
  // ---------------------------------------------------------------------------

  private async fetchTodos(url: string): Promise<any[]> {
    const todos: any[] = [];
    let nextUrl: string | null = url;
    while (nextUrl) {
      const res = await fetch(nextUrl, { headers: getAuthHeaders() });
      if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('Sesión expirada');
      }
      if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
      const data = await res.json();
      todos.push(...(data.results || data));
      nextUrl = data.next;
    }
    return todos;
  }

  private async fetchJson(url: string): Promise<any | null> {
    try {
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.status === 401) {
        window.location.href = '/login';
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async cargar(): Promise<void> {
    if (this.cargarPromise) return this.cargarPromise;
    this.cargarPromise = (async () => {
      this.mostrarCargando();
      this.objetosPorContenedor.clear();
      try {
        const estokId = getEstokActivoId();
        const [ubiData, contData, estokData] = await Promise.all([
          this.fetchTodos(`${API_BASE_URL}/ubicaciones/?page_size=1000`),
          this.fetchTodos(`${API_BASE_URL}/contenedores/?page_size=1000`),
          estokId ? this.fetchJson(`${API_BASE_URL}/estoks/${estokId}/`) : Promise.resolve(null),
        ]);

        this.estokFilas = Number(estokData?.grid_filas) || 3;
        this.estokColumnas = Number(estokData?.grid_columnas) || 3;

        // Las divisiones del macro-plano (parent_grid_row sin parent_ubicacion)
        // NO son habitaciones: se excluyen de la cascada Nivel 2 y se indexan
        // por id. Cubre el modelo legacy (fila sin columna) y el del wizard
        // (celda fila × columna).
        this.divisionesPorId.clear();
        for (const u of ubiData as UbicacionDnD[]) {
          if (u.parent_grid_row && !u.parent_ubicacion) {
            this.divisionesPorId.set(u.id, { ...u, raices: [] });
          }
        }
        this.ubicaciones = (ubiData as UbicacionDnD[])
          .filter((u) => !(u.parent_grid_row && !u.parent_ubicacion))
          .map((u) => ({ ...u, raices: [] }));
        this.contenedores = contData.map((c) => ({
          ...c,
          hijos: [],
          grid_filas_config: Array.isArray(c.grid_filas_config) ? c.grid_filas_config : null,
        }));

        await this.cargarObjetos();
        this.construirArbol();

        this.ocultarCargando();
        this.ocultarError();
        this.render();
      } catch (e: any) {
        this.ocultarCargando();
        this.mostrarError(e?.message || 'Error de conexión. Verificá que el servidor esté corriendo.');
      } finally {
        this.cargarPromise = null;
      }
    })();
    return this.cargarPromise;
  }

  /** Carga los objetos de cada contenedor que tiene ítems (para el lienzo). */
  private async cargarObjetos(): Promise<void> {
    const conObjetos = this.contenedores.filter((c) => (c.objetos_count || 0) > 0);
    await Promise.all(
      conObjetos.map(async (c) => {
        try {
          const data = await this.fetchTodos(`${API_BASE_URL}/objetos/?contenedor=${c.id}&page_size=1000`);
          this.objetosPorContenedor.set(
            c.id,
            data.filter((o) => !o.deleted_at).map((o) => ({
              id: o.id,
              nombre: o.nombre,
              contenedor: o.contenedor ?? null,
              parent_grid_row: o.parent_grid_row ?? null,
              parent_grid_col: o.parent_grid_col ?? null,
              foto_principal: o.foto_principal ?? null,
            })),
          );
        } catch {
          this.objetosPorContenedor.set(c.id, []);
        }
      }),
    );
  }

  /** Construye la jerarquía in-memory y agrupa raíces por ubicación. */
  private construirArbol(): void {
    this.contenedoresPorId = new Map(this.contenedores.map((c) => [c.id, c]));
    for (const c of this.contenedores) c.hijos = [];
    for (const c of this.contenedores) {
      if (c.parent_contenedor && this.contenedoresPorId.has(c.parent_contenedor)) {
        this.contenedoresPorId.get(c.parent_contenedor)!.hijos.push(c);
      }
    }
    const raices = this.contenedores.filter(
      (c) => !c.parent_contenedor || !this.contenedoresPorId.has(c.parent_contenedor),
    );
    for (const u of this.ubicaciones) {
      u.raices = raices.filter((c) => c.ubicacion === u.id);
    }
  }

  /** Filtra la columna de Habitaciones (Nivel 2) por la división (fila) activa. */
  setFilaActiva(fila: number | null, nombre?: string | null): void {
    this.filaFiltro = fila ?? null;
    this.filaFiltroNombre = nombre ?? null;
    this.render();
  }

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  private render(): void {
    const colUbicaciones = document.getElementById('columnaUbicaciones');
    const colContenedores = document.getElementById('columnaContenedores');
    if (!colUbicaciones || !colContenedores) return;

    const contUbi = document.getElementById('contadorUbicaciones');
    const contCon = document.getElementById('contadorContenedores');
    if (contCon) contCon.textContent = `${this.contenedores.length}`;

    this.construirArbol();
    const raices = this.contenedores.filter(
      (c) => !c.parent_contenedor || !this.contenedoresPorId.has(c.parent_contenedor),
    );

    // Nivel 2 filtrado en caliente: solo las habitaciones encastradas en la
    // división activa (o las sueltas heredadas con fila coincidente).
    const visibles = this.filaFiltro
      ? this.ubicaciones.filter((u) => {
          if (u.parent_ubicacion) {
            const d = this.divisionesPorId.get(u.parent_ubicacion);
            return d ? d.parent_grid_row === this.filaFiltro : false;
          }
          return (u.parent_grid_row || 1) === this.filaFiltro;
        })
      : this.ubicaciones;
    if (contUbi) contUbi.textContent = `${visibles.length}`;
    const badge = document.getElementById('cascadaUbicacionesTitulo');
    if (badge) {
      badge.textContent = this.filaFiltro
        ? (this.filaFiltroNombre || `Fila ${this.filaFiltro}`)
        : 'Todas las divisiones';
    }

    if (visibles.length === 0) {
      colUbicaciones.innerHTML = `<div class="bg-white rounded-2xl border-2 border-dashed border-gray-300 p-10 text-center">
        <div class="text-5xl mb-3">🏠</div>
        <p class="text-gray-400 font-medium mb-4">${this.ubicaciones.length === 0 ? 'No hay ubicaciones todavía' : 'No hay habitaciones en la planta seleccionada'}</p>
        <button id="emptyUbicacionBtn" class="inline-flex items-center px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 transition-base">+ Crear Ubicación</button>
      </div>`;
      document.getElementById('emptyUbicacionBtn')?.addEventListener('click', () => this.abrirModal('ubicacion'));
    } else {
      colUbicaciones.innerHTML = visibles.map((u) => this.ubicacionHtml(u)).join('');
    }

    if (raices.length === 0) {
      colContenedores.innerHTML = `<div class="bg-white rounded-2xl border-2 border-dashed border-gray-300 p-10 text-center">
        <div class="text-5xl mb-3">📦</div>
        <p class="text-gray-400 font-medium mb-4">No hay contenedores disponibles</p>
        <button id="emptyContenedorBtn" class="inline-flex items-center px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 transition-base">+ Crear Contenedor</button>
      </div>`;
      document.getElementById('emptyContenedorBtn')?.addEventListener('click', () => this.abrirModal('contenedor'));
    } else {
      colContenedores.innerHTML = raices.map((c) => this.contenedorPaletaHtml(c)).join('');
    }

    this.enlazarDnD();
    this.enlazarEliminar();
    this.enlazarEditar();
    this.enlazarCasilleros();
    this.enlazarEscalaUbicacion();
  }

  // -- Tarjeta de Ubicación (drop zone) -------------------------------------

  private ubicacionHtml(u: UbicacionDnD): string {
    const raicesHtml = u.raices.map((c) => this.contenedorHtml(c, 0)).join('');
    // Sub-grilla de la división donde está encastrada (para el minimapa).
    const divPadre = u.parent_ubicacion ? this.divisionesPorId.get(u.parent_ubicacion) : null;
    const grillaMinimapa = divPadre
      ? {
          filas: Math.max(1, Number(divPadre.grid_filas) || 3),
          columnas: Math.max(1, Number(divPadre.grid_columnas) || 3),
          colsPorFila: divPadre.grid_filas_config,
        }
      : { filas: this.estokFilas, columnas: this.estokColumnas, colsPorFila: null };
    return `
    <article class="dnd-ubicacion bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border-2 border-dashed border-gray-300 transition-base p-5" data-id="${u.id}" draggable="true" title="Arrastrala sobre una celda del Mapa Estok para encastrarla">
      <div class="flex items-start gap-3 mb-3">
        <div class="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <svg class="w-5 h-5 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_UBICACION}</svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="font-semibold text-gray-900" data-nombre-ubicacion="${u.id}">${escapeHtml(u.nombre)}</h3>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">${u.contenedores_count || 0} contenedores</span>
          </div>
          <div data-desc-ubicacion-slot="${u.id}">
            ${u.descripcion ? `<p class="text-sm text-gray-500 mt-0.5 line-clamp-2">${escapeHtml(u.descripcion)}</p>` : ''}
          </div>
          <p class="text-xs text-gray-400 mt-0.5">📦 ${u.objetos_count || 0} objetos</p>
          ${this.medidasHtml(u, 'ubicacion')}
        </div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" class="dnd-editar-ubicacion text-slate-400 hover:text-blue-600 transition-colors cursor-pointer p-1" data-id="${u.id}" title="Editar ubicación">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_LAPIZ}</svg>
          </button>
          <a href="/ubicaciones/${u.id}" draggable="false" class="text-gray-400 hover:text-blue-700 p-1 transition-base" title="Ver ubicación">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_OJO}</svg>
          </a>
          <button type="button" class="dnd-eliminar-ubicacion text-red-300 hover:text-red-600 p-1 transition-base" data-id="${u.id}" data-nombre="${escapeHtml(u.nombre)}" title="Eliminar ubicación">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_PAPELERA}</svg>
          </button>
        </div>
      </div>
      <div class="casillero-nivel2">
        ${minimapaPlantaHtml(grillaMinimapa.filas, grillaMinimapa.columnas, u, grillaMinimapa.colsPorFila)}
        <div class="casillero-fila-control">
          <span class="casillero-fila-etiqueta">Filas (alto del cuadrante)</span>
          <div class="num-control">
            <button type="button" class="num-btn" data-ubi-escala="menos" data-eje="rowspan" data-ubicacion="${u.id}" title="Reducir alto del cuadrante">−</button>
            <input type="number" class="num-input" min="1" max="12" value="${u.grid_rowspan || 1}" readonly aria-label="Filas (alto) de la habitación" />
            <button type="button" class="num-btn" data-ubi-escala="mas" data-eje="rowspan" data-ubicacion="${u.id}" title="Ampliar alto del cuadrante">+</button>
          </div>
        </div>
        <div class="casillero-fila-control">
          <span class="casillero-fila-etiqueta">Columnas (ancho del cuadrante)</span>
          <div class="num-control">
            <button type="button" class="num-btn" data-ubi-escala="menos" data-eje="colspan" data-ubicacion="${u.id}" title="Reducir ancho del cuadrante">−</button>
            <input type="number" class="num-input" min="1" max="12" value="${u.grid_colspan || 1}" readonly aria-label="Columnas (ancho) de la habitación" />
            <button type="button" class="num-btn" data-ubi-escala="mas" data-eje="colspan" data-ubicacion="${u.id}" title="Ampliar ancho del cuadrante">+</button>
          </div>
        </div>
      </div>
      <div class="dnd-hijos space-y-2 min-h-[44px]">
        ${raicesHtml || `<p class="text-xs text-center text-gray-400 border border-dashed border-gray-200 rounded-lg py-3">📥 Soltá contenedores acá</p>`}
      </div>
    </article>`;
  }

  // -- Tarjeta de Contenedor (recursiva: muestra sub-contenedores) ----------

  private contenedorHtml(c: ContenedorDnD, profundidad: number, padreGrid?: { filas: number; columnas: number; columnasPorFila?: number[] | null }): string {
    const inmueble = Boolean(c.es_inmueble);
    const subHtml = c.hijos.length
      ? `<div class="mt-2.5 pl-3 border-l-2 border-orange-100 space-y-2">${c.hijos.map((h) => this.contenedorHtml(h, profundidad + 1, { filas: this.filasDe(c), columnas: Math.max(1, Number(c.grid_columnas) || 3), columnasPorFila: c.grid_filas_config })).join('')}</div>`
      : '';
    return `
    <div class="dnd-contenedor bg-white rounded-xl border border-gray-200 shadow-sm p-3.5 transition-base${inmueble ? ' dnd-contenedor-inmueble cursor-not-allowed' : ' cursor-grab active:cursor-grabbing'} hover:shadow-md hover:border-blue-200" data-id="${c.id}" draggable="${inmueble ? 'false' : 'true'}" title="${inmueble ? '📌 Mueble inmueble fijo (no mudable)' : 'Arrastrá para mover'}">
      ${inmueble ? '<span class="dnd-inmueble-badge">📌 Fijo · No mudable</span>' : ''}
      ${this.minimapasContenedorHtml(c, padreGrid)}
      <div class="flex items-start gap-2.5">
        <img src="${imagenContenedor(c)}" alt="${escapeHtml(c.nombre)}" class="h-16 w-auto draggable" draggable="false" />
        <div class="flex-1 min-w-0">
          <h4 class="font-semibold text-gray-900 text-sm truncate" data-nombre-contenedor="${c.id}">${escapeHtml(c.nombre)}</h4>
          <div data-desc-contenedor-slot="${c.id}">
            ${c.descripcion ? `<p class="text-xs text-gray-500 line-clamp-1">${escapeHtml(c.descripcion)}</p>` : ''}
          </div>
          <p class="text-[11px] text-gray-400 mt-0.5">📦 ${c.objetos_count || 0} objetos${c.hijos.length ? ` · 🗂 ${c.hijos.length} sub-contenedor${c.hijos.length > 1 ? 'es' : ''}` : ''}</p>
          ${this.medidasHtml(c, 'contenedor')}
        </div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" class="dnd-editar-contenedor text-slate-400 hover:text-blue-600 transition-colors cursor-pointer p-1" data-id="${c.id}" title="Editar contenedor">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_LAPIZ}</svg>
          </button>
          <a href="/contenedores/${c.id}" draggable="false" class="text-gray-400 hover:text-blue-700 p-1 transition-base" title="Ver contenedor">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_OJO}</svg>
          </a>
          ${inmueble ? '' : `<button type="button" class="dnd-eliminar-contenedor text-red-300 hover:text-red-600 p-1 transition-base" data-id="${c.id}" data-nombre="${escapeHtml(c.nombre)}" title="Eliminar contenedor">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_PAPELERA}</svg>
          </button>`}
        </div>
      </div>
      ${this.objetosHtml(c)}
      ${this.casillerosHtml(c)}
      ${subHtml}
    </div>`;
  }

  // -- Tarjeta de Contenedor en la paleta (sin anidados) --------------------

  private contenedorPaletaHtml(c: ContenedorDnD): string {
    const inmueble = Boolean(c.es_inmueble);
    return `
    <div class="dnd-contenedor bg-white rounded-xl border border-gray-200 shadow-sm p-3.5 transition-base${inmueble ? ' dnd-contenedor-inmueble cursor-not-allowed' : ' cursor-grab active:cursor-grabbing'} hover:shadow-md hover:border-blue-200" data-id="${c.id}" draggable="${inmueble ? 'false' : 'true'}" title="${inmueble ? '📌 Mueble inmueble fijo (no mudable)' : 'Arrastrá a una ubicación o dentro de otro contenedor'}">
      ${inmueble ? '<span class="dnd-inmueble-badge">📌 Fijo · No mudable</span>' : ''}
      ${this.minimapasContenedorHtml(c)}
      <div class="flex items-start gap-2.5">
        <img src="${imagenContenedor(c)}" alt="${escapeHtml(c.nombre)}" class="h-16 w-auto draggable" draggable="false" />
        <div class="flex-1 min-w-0">
          <h4 class="font-semibold text-gray-900 text-sm truncate" data-nombre-contenedor="${c.id}">${escapeHtml(c.nombre)}</h4>
          <div data-desc-contenedor-slot="${c.id}">
            ${c.descripcion ? `<p class="text-xs text-gray-500 line-clamp-1">${escapeHtml(c.descripcion)}</p>` : ''}
          </div>
          <p class="text-[11px] text-gray-400 mt-0.5">📍 ${escapeHtml(c.ubicacion_nombre || 'Sin ubicación')} · 📦 ${c.objetos_count || 0}${c.hijos.length ? ` · 🗂 ${c.hijos.length}` : ''}</p>
          ${this.medidasHtml(c, 'contenedor')}
        </div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" class="dnd-editar-contenedor text-slate-400 hover:text-blue-600 transition-colors cursor-pointer p-1" data-id="${c.id}" title="Editar contenedor">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_LAPIZ}</svg>
          </button>
          <a href="/contenedores/${c.id}" draggable="false" class="text-gray-400 hover:text-blue-700 p-1 transition-base" title="Ver contenedor">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_OJO}</svg>
          </a>
          ${inmueble ? '' : `<button type="button" class="dnd-eliminar-contenedor text-red-300 hover:text-red-600 p-1 transition-base" data-id="${c.id}" data-nombre="${escapeHtml(c.nombre)}" title="Eliminar contenedor">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONO_PAPELERA}</svg>
          </button>`}
        </div>
      </div>
      ${this.objetosHtml(c)}
      ${this.casillerosHtml(c)}
    </div>`;
  }

  // -- Ítems individuales (Objetos) dentro del contenedor --------------------

  /** Renderiza los ítems del contenedor con /fluffy_plush_ball.jpg (draggable). */
  private objetosHtml(c: ContenedorDnD): string {
    const objetos = this.objetosPorContenedor.get(c.id) || [];
    if (!objetos.length) return '';
    const visibles = objetos.slice(0, 8);
    const extra = objetos.length - visibles.length;
    return `<div class="objetos-caja" title="Objetos individuales: arrastrá uno sobre un casillero para reubicarlo">
      ${visibles.map((o) => `<img src="${IMG_OBJETO}" alt="${escapeHtml(o.nombre)}" class="h-12 w-12 rounded-full draggable" draggable="true" data-objeto-dnd="${o.id}" data-nombre="${escapeHtml(o.nombre)}" title="${escapeHtml(o.nombre)}" />`).join('')}
      ${extra > 0 ? `<span class="objetos-mas">+${extra}</span>` : ''}
    </div>`;
  }

  // -- Grilla asimétrica de casilleros + NumericUp/Down -----------------------

  /** Cantidad de filas globales del contenedor (1..12). */
  private filasDe(c: ContenedorDnD): number {
    return acotar(Number(c.grid_filas) || 3, 1, 12);
  }

  /** Columnas de cada fila: usa grid_filas_config si está completo, si no fallback a grid_columnas. */
  private columnasDeFila(c: ContenedorDnD): number[] {
    const filas = this.filasDe(c);
    const fallback = acotar(Number(c.grid_columnas) || 3, 1, 12);
    const cfg = Array.isArray(c.grid_filas_config) && c.grid_filas_config.length >= filas
      ? c.grid_filas_config.slice(0, filas)
      : null;
    const out: number[] = [];
    for (let i = 0; i < filas; i++) {
      out.push(cfg ? acotar(Number(cfg[i]), 1, 12) : fallback);
    }
    return out;
  }

  private casillerosHtml(c: ContenedorDnD): string {
    const filas = this.filasDe(c);
    const columnasFila = this.columnasDeFila(c);
    const ocupadas = new Set<string>();
    for (const h of c.hijos) {
      if (h.parent_grid_row && h.parent_grid_col) ocupadas.add(`${h.parent_grid_row}-${h.parent_grid_col}`);
    }
    const objetos = this.objetosPorContenedor.get(c.id) || [];
    for (const o of objetos) {
      if (o.parent_grid_row && o.parent_grid_col) ocupadas.add(`${o.parent_grid_row}-${o.parent_grid_col}`);
    }

    // NumericUp/Down: Filas globales del contenedor
    let controles = `
    <div class="casillero-fila-control">
      <span class="casillero-fila-etiqueta">Filas globales</span>
      <div class="num-control">
        <button type="button" class="num-btn" data-num-filas="menos" data-contenedor="${c.id}" aria-label="Quitar una fila">−</button>
        <input type="number" class="num-input" min="1" max="12" value="${filas}" data-num-filas-input="${c.id}" aria-label="Filas globales del contenedor" />
        <button type="button" class="num-btn" data-num-filas="mas" data-contenedor="${c.id}" aria-label="Agregar una fila">+</button>
      </div>
    </div>`;
    // NumericUp/Down: Columnas exclusivas de cada fila (layouts asimétricos)
    for (let r = 1; r <= filas; r++) {
      const cols = columnasFila[r - 1];
      controles += `
    <div class="casillero-fila-control">
      <span class="casillero-fila-etiqueta">Fila ${r}</span>
      <div class="num-control">
        <button type="button" class="num-btn" data-num-cols="menos" data-contenedor="${c.id}" data-fila="${r}" aria-label="Quitar un casillero a la fila ${r}">−</button>
        <input type="number" class="num-input" min="1" max="12" value="${cols}" data-num-cols-input="${c.id}" data-fila="${r}" aria-label="Casilleros de la fila ${r}" />
        <button type="button" class="num-btn" data-num-cols="mas" data-contenedor="${c.id}" data-fila="${r}" aria-label="Agregar un casillero a la fila ${r}">+</button>
      </div>
    </div>`;
    }

    let grilla = '';
    for (let r = 1; r <= filas; r++) {
      const cols = columnasFila[r - 1];
      let filaHtml = '';
      for (let col = 1; col <= cols; col++) {
        const ocupada = ocupadas.has(`${r}-${col}`);
        filaHtml += `<div class="casillero ${ocupada ? 'casillero-ocupado' : ''}" data-casillero="${c.id}" data-grid-row="${r}" data-grid-col="${col}" title="Casillero F${r}·C${col}">${ocupada ? '▣' : ''}</div>`;
      }
      grilla += `<div class="casilleros-fila-grilla" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr))">${filaHtml}</div>`;
    }

    return `<div class="casilleros" title="Soltá un contenedor u objeto sobre un casillero para asignar su posición exacta">
      <div class="casilleros-titulo">Casilleros · grilla asimétrica (${filas} filas)</div>
      <div class="casilleros-controles">${controles}</div>
      <div class="casilleros-grilla">${grilla}</div>
    </div>`;
  }

  // -- Minimapas naranjas (posición en vivo del elemento) --------------------

  private minimapasContenedorHtml(c: ContenedorDnD, padreGrid?: { filas: number; columnas: number; columnasPorFila?: number[] | null }): string {
    const planta = padreGrid
      ? ''
      : minimapaPlantaHtml(this.estokFilas, this.estokColumnas, this.ubicaciones.find((x) => x.id === c.ubicacion));
    const seccion =
      padreGrid && c.parent_grid_row && c.parent_grid_col
        ? minimapaInternoHtml(padreGrid.filas, padreGrid.columnas, c.parent_grid_row, c.parent_grid_col, padreGrid.columnasPorFila)
        : '';
    if (!planta && !seccion) return '';
    return `<div class="flex gap-2 items-start flex-wrap mb-2">${planta}${seccion}</div>`;
  }

  // ---------------------------------------------------------------------------
  // DRAG & DROP (HTML5 API)
  // ---------------------------------------------------------------------------

  private enlazarDnD(): void {
    // Habitaciones de la cascada: origen arrastrable hacia las celdas del Mapa Estok
    document.querySelectorAll<HTMLElement>('.dnd-ubicacion').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        const id = card.dataset.id;
        if (!id) return;
        e.dataTransfer?.setData('application/x-estok-ubicacion', id);
        e.dataTransfer?.setData('text/plain', id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
    });
    // Objetos individuales: origen arrastrable hacia casilleros
    document.querySelectorAll<HTMLElement>('[data-objeto-dnd]').forEach((img) => {
      img.addEventListener('dragstart', (e) => {
        const id = img.dataset.objetoDnd;
        if (!id) return;
        this.dragTipo = 'objeto';
        this.dragId = id;
        if (e.dataTransfer) {
          e.dataTransfer.setData('application/x-estok-objeto', id);
          e.dataTransfer.setData('text/plain', id);
          e.dataTransfer.effectAllowed = 'move';
        }
        img.classList.add('opacity-50');
      });
      img.addEventListener('dragend', () => {
        img.classList.remove('opacity-50');
        this.dragTipo = null;
        this.dragId = null;
        this.limpiarFeedback();
      });
    });

    // Tarjetas de contenedor: origen arrastrable + zona de caída para sub-niveles
    document.querySelectorAll<HTMLElement>('.dnd-contenedor').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        const id = card.dataset.id;
        if (!id) return;
        // Restricción estricta: los muebles inmuebles fijos NO se arrastran.
        const cont = this.contenedoresPorId.get(id);
        if (cont?.es_inmueble) {
          e.preventDefault();
          return;
        }
        this.dragTipo = 'contenedor';
        this.dragId = id;
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', id);
          e.dataTransfer.setData('application/x-estok-contenedor', id);
          e.dataTransfer.effectAllowed = 'move';
        }
        card.classList.add('opacity-50');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('opacity-50');
        this.limpiarFeedback();
        this.dragTipo = null;
        this.dragId = null;
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        this.marcarActivo(card, true);
      });

      card.addEventListener('dragleave', (e) => {
        if (e.relatedTarget && card.contains(e.relatedTarget as Node)) return;
        this.marcarActivo(card, false);
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.marcarActivo(card, false);
        void this.procesarDropEnContenedor(e, card.dataset.id);
      });
    });

    // Casilleros de la grilla de cada contenedor: zonas de drop finas que
    // graban la coordenada relativa (parent_grid_row / parent_grid_col).
    document.querySelectorAll<HTMLElement>('[data-casillero]').forEach((celda) => {
      celda.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        this.marcarActivo(celda, true);
      });

      celda.addEventListener('dragleave', () => {
        this.marcarActivo(celda, false);
      });

      celda.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.marcarActivo(celda, false);
        const targetId = celda.dataset.casillero;
        const fila = Number(celda.dataset.gridRow);
        const col = Number(celda.dataset.gridCol);
        if (targetId && fila && col) {
          void this.procesarDropEnContenedor(e, targetId, { fila, col });
        }
      });
    });

    // Tarjetas de ubicación: zonas de caída para asignar contenedores/objetos
    document.querySelectorAll<HTMLElement>('.dnd-ubicacion').forEach((zona) => {
      zona.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        this.marcarActivo(zona, true);
      });

      zona.addEventListener('dragleave', (e) => {
        if (e.relatedTarget && zona.contains(e.relatedTarget as Node)) return;
        this.marcarActivo(zona, false);
      });

      zona.addEventListener('drop', (e) => {
        e.preventDefault();
        this.marcarActivo(zona, false);
        void this.procesarDropEnUbicacion(e, zona.dataset.id);
      });
    });
  }

  private obtenerIdDrag(e: DragEvent): string | null {
    if (this.dragId) return this.dragId;
    return (
      e.dataTransfer?.getData('application/x-estok-contenedor') ||
      e.dataTransfer?.getData('application/x-estok-objeto') ||
      e.dataTransfer?.getData('text/plain') ||
      null
    );
  }

  private async procesarDropEnContenedor(e: DragEvent, targetId?: string, casillero?: { fila: number; col: number }): Promise<void> {
    const id = this.obtenerIdDrag(e);
    if (!id || !targetId) return;

    // Ítems individuales: se reubican dentro del contenedor (casillero opcional)
    if (this.dragTipo === 'objeto') {
      await this.moverObjeto(id, targetId, casillero);
      return;
    }

    if (id === targetId) {
      this.toast('⚠️ No podés soltar un contenedor dentro de sí mismo.');
      return;
    }
    const padre = this.contenedoresPorId.get(targetId);
    if (!padre) return;
    if (this.esAncestro(id, targetId)) {
      this.toast('⚠️ No podés soltar un contenedor dentro de sus propios sub-contenedores.');
      return;
    }
    await this.moverContenedor(id, {
      ubicacion: padre.ubicacion,
      parent_contenedor: targetId,
      parent_grid_row: casillero?.fila ?? null,
      parent_grid_col: casillero?.col ?? null,
    });
  }

  private async procesarDropEnUbicacion(e: DragEvent, locId?: string): Promise<void> {
    const id = this.obtenerIdDrag(e);
    if (!id || !locId) return;
    if (this.dragTipo === 'objeto') {
      await this.moverObjetoAubicacion(id, locId);
      return;
    }
    // Al soltar en una ubicación el contenedor pasa a raíz: se limpian las
    // coordenadas de casillero (ya no hay contenedor padre).
    await this.moverContenedor(id, {
      ubicacion: locId,
      parent_contenedor: null,
      parent_grid_row: null,
      parent_grid_col: null,
    });
  }

  /** True si `posibleDescendienteId` está dentro del subárbol de `padreId`. */
  private esAncestro(padreId: string, posibleDescendienteId: string): boolean {
    let cursor = this.contenedoresPorId.get(posibleDescendienteId);
    const vistos = new Set<string>();
    while (cursor?.parent_contenedor) {
      if (vistos.has(cursor.parent_contenedor)) return false;
      vistos.add(cursor.parent_contenedor);
      if (cursor.parent_contenedor === padreId) return true;
      cursor = this.contenedoresPorId.get(cursor.parent_contenedor);
    }
    return false;
  }

  private marcarActivo(el: HTMLElement, activo: boolean): void {
    el.classList.toggle('dnd-drop-activo', activo);
  }

  private limpiarFeedback(): void {
    document.querySelectorAll('.dnd-drop-activo').forEach((el) => el.classList.remove('dnd-drop-activo'));
    document.querySelectorAll('.dnd-contenedor').forEach((el) => el.classList.remove('opacity-50'));
  }

  // ---------------------------------------------------------------------------
  // PERSISTENCIA: PUT /api/contenedores/{id}/ y /api/objetos/{id}/
  // ---------------------------------------------------------------------------

  private async moverContenedor(
    id: string,
    payload: {
      ubicacion: string;
      parent_contenedor: string | null;
      parent_grid_row?: number | null;
      parent_grid_col?: number | null;
    },
  ): Promise<void> {
    const contenedor = this.contenedoresPorId.get(id);
    if (!contenedor) return;

    // Enteros válidos (1-based) para las coordenadas de sección.
    const filaNueva = payload.parent_grid_row != null ? Math.floor(Number(payload.parent_grid_row)) : null;
    const colNueva = payload.parent_grid_col != null ? Math.floor(Number(payload.parent_grid_col)) : null;

    // No-op si ya está exactamente en el mismo lugar (incluye coordenadas)
    const parentActual = contenedor.parent_contenedor || null;
    const filaActual = contenedor.parent_grid_row ?? null;
    const colActual = contenedor.parent_grid_col ?? null;
    if (
      contenedor.ubicacion === payload.ubicacion &&
      parentActual === payload.parent_contenedor &&
      filaActual === filaNueva &&
      colActual === colNueva
    ) {
      this.toast('ℹ️ El contenedor ya está en ese lugar.');
      return;
    }

    // Optimista: actualiza el modelo en memoria y re-renderiza para que el
    // minimapa superior se ilumine en naranja (#f97316) en vivo.
    contenedor.ubicacion = payload.ubicacion;
    contenedor.parent_contenedor = payload.parent_contenedor;
    contenedor.parent_grid_row = filaNueva;
    contenedor.parent_grid_col = colNueva;
    this.render();

    try {
      const res = await fetch(`${API_BASE_URL}/contenedores/${id}/`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ubicacion: payload.ubicacion,
          parent_contenedor: payload.parent_contenedor,
          parent_grid_row: filaNueva,
          parent_grid_col: colNueva,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (res.ok) {
        this.toast(`✅ «${contenedor.nombre}» movido correctamente.`);
      } else {
        const err = await res.json().catch(() => ({}));
        this.toast('❌ ' + this.extraerError(err));
        await this.cargar();
      }
    } catch {
      this.toast('❌ Error de conexión al mover el contenedor.');
      await this.cargar();
    }
  }

  /** Reubica un objeto individual en un contenedor/casillero (PUT /objetos/{id}/). */
  private async moverObjeto(id: string, targetContenedorId: string, casillero?: { fila: number; col: number }): Promise<void> {
    const fila = casillero?.fila != null ? Math.floor(Number(casillero.fila)) : null;
    const col = casillero?.col != null ? Math.floor(Number(casillero.col)) : null;
    try {
      const res = await fetch(`${API_BASE_URL}/objetos/${id}/`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contenedor: targetContenedorId,
          parent_grid_row: fila,
          parent_grid_col: col,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (res.ok) {
        this.toast('✅ Objeto reubicado en el casillero.');
        await this.cargar();
      } else {
        const err = await res.json().catch(() => ({}));
        this.toast('❌ ' + this.extraerError(err));
      }
    } catch {
      this.toast('❌ Error de conexión al mover el objeto.');
    }
  }

  /** Saca un objeto del contenedor y lo ancla a una ubicación raíz. */
  private async moverObjetoAubicacion(id: string, locId: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE_URL}/objetos/${id}/`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contenedor: null,
          ubicacion: locId,
          parent_grid_row: null,
          parent_grid_col: null,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (res.ok) {
        this.toast('✅ Objeto anclado a la ubicación.');
        await this.cargar();
      } else {
        const err = await res.json().catch(() => ({}));
        this.toast('❌ ' + this.extraerError(err));
      }
    } catch {
      this.toast('❌ Error de conexión al mover el objeto.');
    }
  }

  // ---------------------------------------------------------------------------
  // ESCALA DE HABITACIONES (Nivel 2) - NumericUp/Down de Filas/Columnas
  // Persisten vía PUT /api/ubicaciones/{id}/ con grid_rowspan / grid_colspan.
  // ---------------------------------------------------------------------------

  private cambiarEscalaUbicacion(id: string, eje: 'colspan' | 'rowspan', delta: number): void {
    const u = this.ubicaciones.find((x) => x.id === id);
    if (!u) return;
    const actual = eje === 'colspan' ? (u.grid_colspan || 1) : (u.grid_rowspan || 1);
    const nuevo = acotar(actual + delta, 1, 12);
    if (nuevo === actual) return;
    void this.persistirEscalaUbicacion(u, eje, nuevo);
  }

  private async persistirEscalaUbicacion(u: UbicacionDnD, eje: 'colspan' | 'rowspan', valor: number): Promise<void> {
    if (eje === 'colspan') u.grid_colspan = valor;
    else u.grid_rowspan = valor;
    this.render();
    try {
      const res = await fetch(`${API_BASE_URL}/ubicaciones/${u.id}/`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(eje === 'colspan' ? { grid_colspan: valor } : { grid_rowspan: valor }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (res.ok) {
        this.toast(`✅ «${u.nombre}» reescalada (${eje === 'colspan' ? 'ancho' : 'alto'} = ${valor}).`);
      } else {
        const err = await res.json().catch(() => ({}));
        this.toast('❌ ' + this.extraerError(err));
        await this.cargar();
      }
    } catch {
      this.toast('❌ Error de conexión al reescalar la habitación.');
      await this.cargar();
    }
  }

  private enlazarEscalaUbicacion(): void {
    document.querySelectorAll<HTMLElement>('[data-ubi-escala]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.ubicacion;
        const eje = btn.dataset.eje as 'colspan' | 'rowspan';
        const delta = btn.dataset.escala === 'mas' ? 1 : -1;
        if (id && (eje === 'colspan' || eje === 'rowspan')) this.cambiarEscalaUbicacion(id, eje, delta);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // CONTROLES NUMÉRICOS ASIMÉTRICOS (NumericUp/Down de Filas y Columnas)
  // ---------------------------------------------------------------------------

  private enlazarCasilleros(): void {
    // Filas globales: botones − / +
    document.querySelectorAll<HTMLElement>('[data-num-filas]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.contenedor;
        if (!id) return;
        const c = this.contenedoresPorId.get(id);
        if (!c) return;
        const actual = this.filasDe(c);
        const delta = btn.dataset.numFilas === 'mas' ? 1 : -1;
        const nuevo = acotar(actual + delta, 1, 12);
        if (nuevo === actual) return;
        void this.cambiarFilas(c, nuevo);
      });
    });

    // Filas globales: input numérico
    document.querySelectorAll<HTMLElement>('[data-num-filas-input]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = (input as HTMLInputElement).dataset.numFilasInput;
        if (!id) return;
        const c = this.contenedoresPorId.get(id);
        if (!c) return;
        const nuevo = acotar(Number((input as HTMLInputElement).value), 1, 12);
        void this.cambiarFilas(c, nuevo);
      });
    });

    // Columnas exclusivas por fila: botones − / +
    document.querySelectorAll<HTMLElement>('[data-num-cols]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.contenedor;
        const fila = Number(btn.dataset.fila);
        if (!id || !fila) return;
        const c = this.contenedoresPorId.get(id);
        if (!c) return;
        const actual = this.columnasDeFila(c)[fila - 1];
        const delta = btn.dataset.numCols === 'mas' ? 1 : -1;
        const nuevo = acotar(actual + delta, 1, 12);
        if (nuevo === actual) return;
        void this.cambiarColumnasFila(c, fila, nuevo);
      });
    });

    // Columnas exclusivas por fila: input numérico
    document.querySelectorAll<HTMLElement>('[data-num-cols-input]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = (input as HTMLInputElement).dataset.numColsInput;
        const fila = Number((input as HTMLInputElement).dataset.fila);
        if (!id || !fila) return;
        const c = this.contenedoresPorId.get(id);
        if (!c) return;
        const nuevo = acotar(Number((input as HTMLInputElement).value), 1, 12);
        void this.cambiarColumnasFila(c, fila, nuevo);
      });
    });
  }

  /** Cambia la cantidad de Filas globales y ajusta el arreglo de columnas por fila. */
  private async cambiarFilas(c: ContenedorDnD, filas: number): Promise<void> {
    const actual = this.columnasDeFila(c);
    const fallback = acotar(Number(c.grid_columnas) || 3, 1, 12);
    const config: number[] = [];
    for (let i = 0; i < filas; i++) config.push(actual[i] ?? fallback);
    c.grid_filas = filas;
    c.grid_filas_config = config;
    await this.persistirGrilla(c);
  }

  /** Cambia la cantidad de Columnas (casilleros) exclusivas de una fila puntual. */
  private async cambiarColumnasFila(c: ContenedorDnD, fila: number, columnas: number): Promise<void> {
    const config = this.columnasDeFila(c);
    config[fila - 1] = columnas;
    c.grid_filas_config = config;
    await this.persistirGrilla(c);
  }

  /** Persiste la grilla asimétrica del contenedor y refresca el lienzo en vivo. */
  private async persistirGrilla(c: ContenedorDnD): Promise<void> {
    try {
      const res = await fetch(`${API_BASE_URL}/contenedores/${c.id}/`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grid_filas: c.grid_filas,
          grid_columnas: c.grid_columnas,
          grid_filas_config: c.grid_filas_config,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (res.ok) {
        const data = await res.json();
        c.grid_filas = Number(data.grid_filas) || c.grid_filas;
        c.grid_columnas = Number(data.grid_columnas) || c.grid_columnas;
        c.grid_filas_config = Array.isArray(data.grid_filas_config) ? data.grid_filas_config : c.grid_filas_config;
        this.toast(`✅ Grilla de «${c.nombre}» actualizada (asimétrica).`);
        this.render();
      } else {
        const err = await res.json().catch(() => ({}));
        this.toast('❌ ' + this.extraerError(err));
        await this.cargar();
      }
    } catch {
      this.toast('❌ Error de conexión al guardar la grilla.');
      await this.cargar();
    }
  }

  // ---------------------------------------------------------------------------
  // ELIMINAR (evita regresión de funcionalidad de las listas anteriores)
  // ---------------------------------------------------------------------------

  private enlazarEliminar(): void {
    document.querySelectorAll<HTMLElement>('.dnd-eliminar-contenedor').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const nombre = btn.dataset.nombre;
        if (!id || !confirm(`¿Eliminar el contenedor "${nombre}"?\nSus sub-contenedores pasarán a nivel raíz.`)) return;
        try {
          const res = await fetch(`${API_BASE_URL}/contenedores/${id}/`, { method: 'DELETE', headers: getAuthHeaders() });
          if (res.ok || res.status === 204) {
            this.toast('🗑 Contenedor eliminado.');
            await this.cargar();
          } else {
            const err = await res.json().catch(() => ({}));
            this.toast('❌ ' + this.extraerError(err));
          }
        } catch {
          this.toast('❌ Error de conexión al eliminar.');
        }
      });
    });

    document.querySelectorAll<HTMLElement>('.dnd-eliminar-ubicacion').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const nombre = btn.dataset.nombre;
        if (!id || !confirm(`¿Eliminar la ubicación "${nombre}"?\n⚠️ Sus contenedores y sub-contenedores se eliminarán en cascada.`)) return;
        try {
          const res = await fetch(`${API_BASE_URL}/ubicaciones/${id}/`, { method: 'DELETE', headers: getAuthHeaders() });
          if (res.ok || res.status === 204) {
            this.toast('🗑 Ubicación eliminada.');
            await this.cargar();
          } else {
            const err = await res.json().catch(() => ({}));
            this.toast('❌ ' + this.extraerError(err));
          }
        } catch {
          this.toast('❌ Error de conexión al eliminar.');
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // EDICIÓN EN CALIENTE (PUT /api/{ubicaciones|contenedores}/{id}/ sin reload)
  // ---------------------------------------------------------------------------

  private enlazarEditar(): void {
    document.querySelectorAll<HTMLElement>('.dnd-editar-ubicacion').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (!id) return;
        const u = this.ubicaciones.find((x) => x.id === id);
        if (u) this.abrirModalEditar('ubicacion', u);
      });
    });

    document.querySelectorAll<HTMLElement>('.dnd-editar-contenedor').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (!id) return;
        const c = this.contenedoresPorId.get(id);
        if (c) this.abrirModalEditar('contenedor', c);
      });
    });
  }

  private abrirModalEditar(tipo: 'ubicacion' | 'contenedor', entidad: EntidadEditable): void {
    const modal = document.getElementById('modalEditar');
    if (!modal) return;
    (document.getElementById('editarTitulo') as HTMLElement).textContent =
      tipo === 'ubicacion' ? '✏️ Editar Ubicación' : '✏️ Editar Contenedor';
    (document.getElementById('editarTipo') as HTMLInputElement).value = tipo;
    (document.getElementById('editarId') as HTMLInputElement).value = entidad.id;
    (document.getElementById('editarNombre') as HTMLInputElement).value = entidad.nombre;
    (document.getElementById('editarDescripcion') as HTMLTextAreaElement).value = entidad.descripcion || '';
    (document.getElementById('editarAlto') as HTMLInputElement).value = entidad.alto == null ? '' : String(entidad.alto);
    (document.getElementById('editarAncho') as HTMLInputElement).value = entidad.ancho == null ? '' : String(entidad.ancho);
    (document.getElementById('editarLargo') as HTMLInputElement).value = entidad.largo == null ? '' : String(entidad.largo);
    // Grilla interna de casilleros: solo para contenedores (ej. 3×3 armario)
    const grillaRow = document.getElementById('editarGrillaRow');
    if (grillaRow) {
      if (tipo === 'contenedor') {
        grillaRow.classList.remove('hidden');
        (document.getElementById('editarGridFilas') as HTMLInputElement).value =
          entidad.grid_filas == null ? '' : String(entidad.grid_filas);
        (document.getElementById('editarGridColumnas') as HTMLInputElement).value =
          entidad.grid_columnas == null ? '' : String(entidad.grid_columnas);
      } else {
        grillaRow.classList.add('hidden');
      }
    }
    // Mueble inmueble fijo: solo aplica a contenedores.
    const inmuebleRow = document.getElementById('editarInmuebleRow');
    const inmuebleCheck = document.getElementById('editarInmueble') as HTMLInputElement | null;
    if (inmuebleRow && inmuebleCheck) {
      if (tipo === 'contenedor') {
        inmuebleRow.classList.remove('hidden');
        inmuebleCheck.checked = Boolean(entidad.es_inmueble);
      } else {
        inmuebleRow.classList.add('hidden');
        inmuebleCheck.checked = false;
      }
    }
    this.precargarFoto(entidad.foto ?? null);
    modal.classList.remove('hidden');
  }

  private async enviarFormEditar(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const tipo = (document.getElementById('editarTipo') as HTMLInputElement).value as 'ubicacion' | 'contenedor';
    const id = (document.getElementById('editarId') as HTMLInputElement).value;
    const nombre = (document.getElementById('editarNombre') as HTMLInputElement).value.trim();
    const descripcion = (document.getElementById('editarDescripcion') as HTMLTextAreaElement).value.trim();
    const alto = (document.getElementById('editarAlto') as HTMLInputElement).value;
    const ancho = (document.getElementById('editarAncho') as HTMLInputElement).value;
    const largo = (document.getElementById('editarLargo') as HTMLInputElement).value;
    const gridFilas = (document.getElementById('editarGridFilas') as HTMLInputElement).value;
    const gridColumnas = (document.getElementById('editarGridColumnas') as HTMLInputElement).value;
    const esInmueble = (document.getElementById('editarInmueble') as HTMLInputElement).checked;

    if (!nombre) {
      this.formError('editarFormError', 'El nombre es obligatorio.');
      return;
    }

    const recurso = tipo === 'ubicacion' ? 'ubicaciones' : 'contenedores';
    const formData = new FormData();
    formData.append('nombre', nombre);
    formData.append('descripcion', descripcion);
    if (alto !== '') formData.append('alto', alto);
    if (ancho !== '') formData.append('ancho', ancho);
    if (largo !== '') formData.append('largo', largo);
    if (tipo === 'contenedor' && gridFilas !== '') formData.append('grid_filas', gridFilas);
    if (tipo === 'contenedor' && gridColumnas !== '') formData.append('grid_columnas', gridColumnas);
    if (tipo === 'contenedor') formData.append('es_inmueble', esInmueble ? 'true' : 'false');

    // Al cambiar las filas globales en el modal se reescala la configuración
    // asimétrica (grid_filas_config) para no perder las columnas por fila.
    let configNuevo: number[] | null = null;
    if (tipo === 'contenedor') {
      const c = this.contenedoresPorId.get(id);
      const filasNuevas = Number(gridFilas);
      if (c && Number.isFinite(filasNuevas) && filasNuevas > 0 && filasNuevas !== this.filasDe(c)) {
        const actual = this.columnasDeFila(c);
        const fallback = Number(gridColumnas) || 3;
        const nuevo: number[] = [];
        for (let i = 0; i < filasNuevas; i++) nuevo.push(actual[i] ?? fallback);
        configNuevo = nuevo;
        formData.append('grid_filas_config', JSON.stringify(nuevo));
      }
    }

    const estokId = getEstokActivoId();
    if (estokId) formData.append('estok', estokId);

    // Sin Content-Type manual: el navegador fija el boundary de multipart/form-data.
    this.setGuardando('editar', true);
    try {
      const res = await fetch(`${API_BASE_URL}/${recurso}/${id}/`, {
        method: 'PUT',
        headers: { ...getAuthHeaders() },
        body: formData,
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (res.ok) {
        const actualizado = (await res.json().catch(() => null)) as (EntidadEditable & { foto?: string | null }) | null;
        const nuevaFoto = actualizado?.foto ?? null;
        const altoVal = alto !== '' ? alto : null;
        const anchoVal = ancho !== '' ? ancho : null;
        const largoVal = largo !== '' ? largo : null;

        // Modelo en memoria: mantiene el Drag & Drop coherente tras el rename.
        if (tipo === 'ubicacion') {
          const u = this.ubicaciones.find((x) => x.id === id);
          if (u) {
            u.nombre = nombre;
            u.descripcion = descripcion;
            u.alto = altoVal;
            u.ancho = anchoVal;
            u.largo = largoVal;
            u.foto = nuevaFoto ?? u.foto;
          }
        } else {
          const c = this.contenedoresPorId.get(id);
          if (c) {
            c.nombre = nombre;
            c.descripcion = descripcion;
            c.alto = altoVal;
            c.ancho = anchoVal;
            c.largo = largoVal;
            c.foto = nuevaFoto ?? c.foto;
            if (gridFilas !== '') c.grid_filas = Number(gridFilas);
            if (gridColumnas !== '') c.grid_columnas = Number(gridColumnas);
            if (configNuevo) c.grid_filas_config = configNuevo;
            c.es_inmueble = esInmueble;
          }
        }

        this.cerrarModal('editar');
        form.reset();
        this.toast(`✏️ «${nombre}» actualizado.`);
        this.render();
      } else {
        const err = await res.json().catch(() => ({}));
        this.formError('editarFormError', this.extraerError(err));
      }
    } catch {
      this.formError('editarFormError', 'Error de conexión.');
    } finally {
      this.setGuardando('editar', false);
    }
  }

  /** Devuelve el HTML de la línea de medidas para las tarjetas. */
  private medidasHtml(e: EntidadEditable, tipo: 'ubicacion' | 'contenedor'): string {
    const med = formatearMedidas(e);
    return `<p class="text-[11px] text-gray-400 mt-0.5 ${med ? '' : 'hidden'}" data-medidas-${tipo}="${e.id}">${med ? `📐 ${med} cm` : ''}</p>`;
  }

  // ---------------------------------------------------------------------------
  // ESTADOS (loading / error)
  // ---------------------------------------------------------------------------

  private mostrarCargando(): void {
    document.getElementById('loadingState')?.classList.remove('hidden');
    document.getElementById('errorState')?.classList.add('hidden');
  }

  private ocultarCargando(): void {
    document.getElementById('loadingState')?.classList.add('hidden');
  }

  private mostrarError(msg: string): void {
    document.getElementById('errorState')?.classList.remove('hidden');
    const msgEl = document.getElementById('errorMessage');
    if (msgEl) msgEl.textContent = msg;
  }

  private ocultarError(): void {
    document.getElementById('errorState')?.classList.add('hidden');
  }

  /** Precarga la vista previa de la foto actual y limpia el input de archivo. */
  private precargarFoto(fotoUrl: string | null): void {
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
    const preview = document.getElementById('editarFotoPreview');
    const img = document.getElementById('editarFotoPreviewImg') as HTMLImageElement | null;
    const input = document.getElementById('editarFotoInput') as HTMLInputElement | null;
    const label = document.getElementById('editarFotoLabel');
    if (input) input.value = '';
    if (label) label.textContent = 'Seleccionar foto';
    if (!preview || !img) return;
    if (fotoUrl) {
      img.src = fotoUrl;
      preview.classList.remove('hidden');
    } else {
      img.removeAttribute('src');
      preview.classList.add('hidden');
    }
  }

  private enlazarInputFotoEditar(): void {
    const input = document.getElementById('editarFotoInput') as HTMLInputElement | null;
    const label = document.getElementById('editarFotoLabel');
    const preview = document.getElementById('editarFotoPreview');
    const img = document.getElementById('editarFotoPreviewImg') as HTMLImageElement | null;
    input?.addEventListener('change', () => {
      const archivo = input.files?.[0];
      if (label) label.textContent = archivo ? archivo.name : 'Seleccionar foto';
      if (this.previewObjectUrl) {
        URL.revokeObjectURL(this.previewObjectUrl);
        this.previewObjectUrl = null;
      }
      if (archivo && preview && img) {
        this.previewObjectUrl = URL.createObjectURL(archivo);
        img.src = this.previewObjectUrl;
        preview.classList.remove('hidden');
      } else if (preview && img) {
        img.removeAttribute('src');
        preview.classList.add('hidden');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // TOAST
  // ---------------------------------------------------------------------------

  private toast(mensaje: string): void {
    let cont = document.getElementById('dnd-toast');
    if (!cont) {
      cont = document.createElement('div');
      cont.id = 'dnd-toast';
      cont.className = 'fixed bottom-6 right-6 z-[100] space-y-2 max-w-sm';
      document.body.appendChild(cont);
    }
    const el = document.createElement('div');
    el.className = 'dnd-toast bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg border border-gray-700';
    el.textContent = mensaje;
    cont.appendChild(el);
    setTimeout(() => {
      el.classList.add('opacity-0', 'transition-opacity', 'duration-300');
      setTimeout(() => el.remove(), 350);
    }, 2600);
  }

  // ---------------------------------------------------------------------------
  // MODALES DE CREACIÓN
  // ---------------------------------------------------------------------------

  private enlazarBotonesHeader(): void {
    document.getElementById('nuevaUbicacionBtn')?.addEventListener('click', () => this.abrirModal('ubicacion'));
    document.getElementById('nuevoContenedorBtn')?.addEventListener('click', () => this.abrirModal('contenedor'));
  }

  private abrirModal(tipo: 'ubicacion' | 'contenedor'): void {
    const id = tipo === 'ubicacion' ? 'modalUbicacion' : 'modalContenedor';
    const modal = document.getElementById(id);
    modal?.classList.remove('hidden');
    const form = modal?.querySelector('form');
    form?.reset();
    const err = modal?.querySelector('[data-form-error]');
    if (err) err.classList.add('hidden');
    if (tipo === 'contenedor') this.llenarSelectUbicaciones();
  }

  private cerrarModal(tipo: 'ubicacion' | 'contenedor' | 'editar'): void {
    const id = tipo === 'ubicacion' ? 'modalUbicacion' : tipo === 'contenedor' ? 'modalContenedor' : 'modalEditar';
    document.getElementById(id)?.classList.add('hidden');
  }

  private enlazarModales(): void {
    document.querySelectorAll<HTMLElement>('[data-cerrar-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tipo = btn.getAttribute('data-cerrar-modal') as 'ubicacion' | 'contenedor' | 'editar' | null;
        if (tipo) this.cerrarModal(tipo);
      });
    });

    (['modalUbicacion', 'modalContenedor', 'modalEditar'] as const).forEach((idModal) => {
      document.getElementById(idModal)?.addEventListener('click', (e) => {
        if (e.target === document.getElementById(idModal)) {
          document.getElementById(idModal)?.classList.add('hidden');
        }
      });
    });

    (document.getElementById('ubiForm') as HTMLFormElement | null)?.addEventListener('submit', (e) => this.enviarFormUbicacion(e));
    (document.getElementById('conForm') as HTMLFormElement | null)?.addEventListener('submit', (e) => this.enviarFormContenedor(e));
    (document.getElementById('editarForm') as HTMLFormElement | null)?.addEventListener('submit', (e) => this.enviarFormEditar(e));

    this.enlazarInputFoto('ubiFotoInput', 'ubiFotoLabel');
    this.enlazarInputFoto('conFotoInput', 'conFotoLabel');
    this.enlazarInputFotoEditar();
  }

  private enlazarInputFoto(inputId: string, labelId: string): void {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const label = document.getElementById(labelId);
    input?.addEventListener('change', () => {
      const archivo = input.files?.[0];
      if (label) label.textContent = archivo ? archivo.name : 'Seleccionar foto';
    });
  }

  private llenarSelectUbicaciones(): void {
    const select = document.getElementById('conUbicacion') as HTMLSelectElement | null;
    if (!select) return;
    select.innerHTML = '<option value="">Seleccionar ubicación...</option>';
    for (const u of this.ubicaciones) {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.nombre;
      select.appendChild(opt);
    }
  }

  private async enviarFormUbicacion(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const nombre = (document.getElementById('ubiNombre') as HTMLInputElement).value.trim();
    const descripcion = (document.getElementById('ubiDescripcion') as HTMLTextAreaElement).value.trim();
    if (!nombre) {
      this.formError('ubiFormError', 'El nombre es obligatorio.');
      return;
    }
    this.setGuardando('ubi', true);
    try {
      const formData = new FormData();
      formData.append('nombre', nombre);
      formData.append('descripcion', descripcion);
      const largo = (document.getElementById('ubiLargo') as HTMLInputElement).value;
      const ancho = (document.getElementById('ubiAncho') as HTMLInputElement).value;
      const alto = (document.getElementById('ubiAlto') as HTMLInputElement).value;
      if (largo) formData.append('largo', largo);
      if (ancho) formData.append('ancho', ancho);
      if (alto) formData.append('alto', alto);
      const foto = (document.getElementById('ubiFotoInput') as HTMLInputElement).files?.[0];
      if (foto) formData.append('foto', foto);

      const res = await fetch(`${API_BASE_URL}/ubicaciones/`, { method: 'POST', headers: getAuthHeaders(), body: formData });
      if (res.ok) {
        this.cerrarModal('ubicacion');
        form.reset();
        this.toast('✅ Ubicación creada.');
        await this.cargar();
      } else {
        const err = await res.json().catch(() => ({}));
        this.formError('ubiFormError', this.extraerError(err));
      }
    } catch {
      this.formError('ubiFormError', 'Error de conexión.');
    } finally {
      this.setGuardando('ubi', false);
    }
  }

  private async enviarFormContenedor(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const nombre = (document.getElementById('conNombre') as HTMLInputElement).value.trim();
    const descripcion = (document.getElementById('conDescripcion') as HTMLTextAreaElement).value.trim();
    const ubicacion = (document.getElementById('conUbicacion') as HTMLSelectElement).value;
    if (!nombre || !ubicacion) {
      this.formError('conFormError', 'Nombre y ubicación son obligatorios.');
      return;
    }
    this.setGuardando('con', true);
    try {
      const formData = new FormData();
      formData.append('nombre', nombre);
      formData.append('descripcion', descripcion);
      formData.append('ubicacion', ubicacion);
      const largo = (document.getElementById('conLargo') as HTMLInputElement).value;
      const ancho = (document.getElementById('conAncho') as HTMLInputElement).value;
      const alto = (document.getElementById('conAlto') as HTMLInputElement).value;
      if (largo) formData.append('largo', largo);
      if (ancho) formData.append('ancho', ancho);
      if (alto) formData.append('alto', alto);
      const foto = (document.getElementById('conFotoInput') as HTMLInputElement).files?.[0];
      if (foto) formData.append('foto', foto);

      const res = await fetch(`${API_BASE_URL}/contenedores/`, { method: 'POST', headers: getAuthHeaders(), body: formData });
      if (res.ok) {
        this.cerrarModal('contenedor');
        form.reset();
        this.toast('✅ Contenedor creado.');
        await this.cargar();
      } else {
        const err = await res.json().catch(() => ({}));
        this.formError('conFormError', this.extraerError(err));
      }
    } catch {
      this.formError('conFormError', 'Error de conexión.');
    } finally {
      this.setGuardando('con', false);
    }
  }

  private setGuardando(prefix: 'ubi' | 'con' | 'editar', guardando: boolean): void {
    const btn = document.getElementById(`${prefix}SaveBtn`) as HTMLButtonElement | null;
    const text = document.getElementById(`${prefix}SaveText`);
    const spinner = document.getElementById(`${prefix}SaveSpinner`);
    if (btn) btn.disabled = guardando;
    text?.classList.toggle('hidden', guardando);
    spinner?.classList.toggle('hidden', !guardando);
  }

  private formError(id: string, msg: string): void {
    const err = document.getElementById(id);
    if (!err) return;
    err.textContent = msg;
    err.classList.remove('hidden');
  }

  private extraerError(err: any): string {
    if (!err) return 'Error desconocido.';
    if (typeof err === 'string') return err;
    if (err.detail) return String(err.detail);
    if (err.non_field_errors) return String(Array.isArray(err.non_field_errors) ? err.non_field_errors[0] : err.non_field_errors);
    if (err.error) return String(err.error);
    const claves = Object.keys(err);
    if (claves.length) {
      return claves
        .map((k) => {
          const v = err[k];
          if (Array.isArray(v)) return `${k}: ${v[0]}`;
          return `${k}: ${String(v)}`;
        })
        .join(', ');
    }
    return 'Error desconocido.';
  }
}
