// =============================================================================
// CONTROLADOR UI DEL WIZARD "MAPA DE ESTOK" (modal de alta de Estok)
// -----------------------------------------------------------------------------
// Orquesta el estado del wizard (mapaEstokWizard.ts) sobre el DOM, maneja la
// navegación entre niveles, los nombres en caliente, los selectores numéricos
// de la grilla y la persistencia atómica hacia POST /api/estoks/{id}/mapa/.
// Auth centralizado: usa ÚNICAMENTE getAuthHeaders() (services/auth.ts).
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { inyectarCssMinimapa } from './minimapa';
import {
  NIVEL_MAXIMO,
  clampGrilla,
  configPorFila,
  coordenadasDeIndice,
  normalizarConfig,
  nombreDefault,
  nodoDeRuta,
  nivelActual,
  celdaDeRuta,
  reajustarCeldas,
  construirPayload,
  renderVistaWizard,
} from './mapaEstokWizard';
import type { MapaEstokWizardState, CeldaWizard } from './mapaEstokWizard';
import { estructuraDesdeDatos } from './mapaEstokEstructura';
import type { DatosEstructuraEstok, UbiDTO, ContDTO } from './mapaEstokEstructura';

// =============================================================================
// TIPOS
// =============================================================================

export interface MapaEstokWizardOpciones {
  /** Se invoca cuando el backend confirma el guardado del mapa. */
  onGuardado?: () => void;
  /** Se invoca cuando el usuario cierra el modal sin guardar. */
  onCerrar?: () => void;
}

// =============================================================================
// CONTROLADOR
// =============================================================================

export class MapaEstokWizardUI {
  private root: HTMLElement;
  private state: MapaEstokWizardState | null = null;
  private opciones: MapaEstokWizardOpciones = {};
  /** true = modo "Editar Estructura" (Almacenamiento); false = alta de Estok. */
  private modoEdicion = false;
  /** Datos completos del Estok cargados del GET (para el PUT con campos requeridos). */
  private estokOriginal: Record<string, unknown> = {};

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Abre el wizard para un Estok recién creado (estok.id + estok.nombre). */
  abrir(estok: { id: string; nombre: string }, opciones: MapaEstokWizardOpciones = {}): void {
    this.opciones = opciones;
    this.modoEdicion = false;
    this.estokOriginal = {};
    inyectarCssMinimapa();
    this.state = {
      estokId: estok.id,
      estokNombre: estok.nombre,
      grid_filas: 2,
      grid_columnas: 2,
      grid_filas_config: null,
      celdas: reajustarCeldas([], 2, 2, null, 1),
      ruta: [],
    };
    this.render();
  }

  /**
   * Abre el wizard en MODO EDICIÓN (botón "✏️ Editar Estructura" de
   * Almacenamiento): precarga la grilla actual del Estok y sus sub-divisiones
   * desde el backend. Al "Guardar Mapa" hace PUTs granulares por nodo.
   */
  async abrirEdicion(estok: { id: string; nombre: string }, opciones: MapaEstokWizardOpciones = {}): Promise<void> {
    this.opciones = opciones;
    this.modoEdicion = true;
    inyectarCssMinimapa();
    const { estok: estokData, datos } = await this.cargarEstructura(estok.id);
    this.estokOriginal = estokData;
    this.state = {
      estokId: estok.id,
      estokNombre: estok.nombre,
      ...datos,
      ruta: [],
    };
    this.render();
  }

  /** Carga el Estok + ubicaciones + contenedores del backend (X-Estok-Id). */
  private async cargarEstructura(estokId: string): Promise<{ estok: Record<string, unknown>; datos: DatosEstructuraEstok }> {
    const headers = getAuthHeaders();
    const [estokRes, ubiRes, contRes] = await Promise.all([
      fetch(`${API_BASE_URL}/estoks/${estokId}/`, { headers }),
      fetch(`${API_BASE_URL}/ubicaciones/?page_size=1000`, { headers }),
      fetch(`${API_BASE_URL}/contenedores/?page_size=1000`, { headers }),
    ]);
    if (estokRes.status === 401 || ubiRes.status === 401 || contRes.status === 401) {
      window.location.href = '/login';
      throw new Error('Sesión expirada.');
    }
    if (!estokRes.ok || !ubiRes.ok || !contRes.ok) {
      throw new Error('No se pudo cargar la estructura actual del Estok.');
    }
    const estok = (await estokRes.json()) as Record<string, unknown>;
    const ubiData = (await ubiRes.json()) as { results?: UbiDTO[] };
    const contData = (await contRes.json()) as { results?: ContDTO[] };
    const datos = estructuraDesdeDatos(estok, ubiData.results || [], contData.results || []);
    return { estok, datos };
  }

  /** Cierra el modal sin guardar (invoca onCerrar). */
  cerrar(): void {
    this.state = null;
    this.root.innerHTML = '';
    this.opciones.onCerrar?.();
  }

  // ---------------------------------------------------------------------------
  // RENDER + EVENTOS (delegación por render, sin listeners globales)
  // ---------------------------------------------------------------------------

  private render(): void {
    if (!this.state) return;
    this.root.innerHTML = renderVistaWizard(this.state);
    this.enlazar();
  }

  private celdasActuales(estado: MapaEstokWizardState): CeldaWizard[] {
    if (estado.ruta.length === 0) return estado.celdas;
    const nodo = celdaDeRuta(estado, estado.ruta);
    return nodo ? nodo.hijos : [];
  }

  private enlazar(): void {
    const root = this.root;
    const estado = this.state;
    if (!estado) return;

    const filasActuales = (): number => {
      if (nivelActual(estado) === 1) return estado.grid_filas;
      return celdaDeRuta(estado, estado.ruta)?.grid_filas ?? 2;
    };

    const columnaFilaActual = (fila: number): number => {
      if (nivelActual(estado) === 1) {
        return configPorFila(estado.grid_filas, estado.grid_columnas, estado.grid_filas_config)[fila - 1];
      }
      const nodo = celdaDeRuta(estado, estado.ruta);
      if (!nodo) return 2;
      return configPorFila(nodo.grid_filas, nodo.grid_columnas, nodo.grid_filas_config)[fila - 1];
    };

    root.querySelectorAll<HTMLButtonElement>('[data-cerrar-wizard]').forEach((b) =>
      b.addEventListener('click', () => this.cerrar()),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-guardar-mapa]').forEach((b) =>
      b.addEventListener('click', () => void this.guardar()),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-volver]').forEach((b) =>
      b.addEventListener('click', () => this.navegarA(estado.ruta.length - 1)),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-ir-nivel]').forEach((b) =>
      b.addEventListener('click', () => this.navegarA(Number(b.dataset.irNivel) || 0)),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-entrar]').forEach((b) =>
      b.addEventListener('click', () => this.entrar(Number(b.dataset.entrar) || 0)),
    );
    root.querySelectorAll<HTMLInputElement>('[data-nombre-celda]').forEach((inp) =>
      inp.addEventListener('input', () => this.renombrar(Number(inp.dataset.nombreCelda) || 0, inp.value)),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-filas-mas]').forEach((b) =>
      b.addEventListener('click', () => this.cambiarFilas(filasActuales() + 1)),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-filas-menos]').forEach((b) =>
      b.addEventListener('click', () => this.cambiarFilas(filasActuales() - 1)),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-col-mas]').forEach((b) =>
      b.addEventListener('click', () => {
        const fila = Number(b.dataset.colMas) || 1;
        this.cambiarColumnaFila(fila, columnaFilaActual(fila) + 1);
      }),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-col-menos]').forEach((b) =>
      b.addEventListener('click', () => {
        const fila = Number(b.dataset.colMenos) || 1;
        this.cambiarColumnaFila(fila, columnaFilaActual(fila) - 1);
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // MUTACIONES DEL ESTADO
  // ---------------------------------------------------------------------------

  private renombrar(indice: number, valor: string): void {
    const estado = this.state;
    if (!estado) return;
    const celdas = this.celdasActuales(estado);
    if (celdas[indice]) celdas[indice].nombre = valor;
  }

  /** Entra a la celda seleccionada (abre el sub-mapa del nivel siguiente). */
  private entrar(indice: number): void {
    const estado = this.state;
    if (!estado) return;
    if (nivelActual(estado) >= NIVEL_MAXIMO) return;
    const celdas = this.celdasActuales(estado);
    if (!celdas[indice]) return;
    if (!celdas[indice].nombre) {
      const vista = nodoDeRuta(estado, estado.ruta);
      const { fila, col } = coordenadasDeIndice(indice, vista.filas, vista.columnas, vista.config);
      celdas[indice].nombre = nombreDefault(nivelActual(estado), fila, col);
    }
    estado.ruta = [...estado.ruta, indice];
    this.render();
  }

  /** Sube/baja el breadcrumb (0 = nivel raíz). */
  private navegarA(nivel: number): void {
    const estado = this.state;
    if (!estado) return;
    const destino = Math.max(0, Math.min(estado.ruta.length, nivel));
    estado.ruta = estado.ruta.slice(0, destino);
    this.render();
  }

  private cambiarFilas(nuevas: number): void {
    const estado = this.state;
    if (!estado) return;
    const nivel = nivelActual(estado);
    const filas = clampGrilla(nuevas);
    if (nivel === 1) {
      const arr = configPorFila(estado.grid_filas, estado.grid_columnas, estado.grid_filas_config);
      while (arr.length < filas) arr.push(estado.grid_columnas);
      arr.length = filas;
      estado.grid_filas = filas;
      estado.grid_filas_config = normalizarConfig(arr, estado.grid_columnas);
      estado.celdas = reajustarCeldas(estado.celdas, filas, estado.grid_columnas, estado.grid_filas_config, 1);
    } else {
      const nodo = celdaDeRuta(estado, estado.ruta);
      if (!nodo) return;
      const arr = configPorFila(nodo.grid_filas, nodo.grid_columnas, nodo.grid_filas_config);
      while (arr.length < filas) arr.push(nodo.grid_columnas);
      arr.length = filas;
      nodo.grid_filas = filas;
      nodo.grid_filas_config = normalizarConfig(arr, nodo.grid_columnas);
      nodo.hijos = reajustarCeldas(nodo.hijos, filas, nodo.grid_columnas, nodo.grid_filas_config, nivel);
    }
    this.render();
  }

  private cambiarColumnaFila(fila: number, nuevas: number): void {
    const estado = this.state;
    if (!estado) return;
    const nivel = nivelActual(estado);
    const col = clampGrilla(nuevas);
    const f = Math.max(1, Math.floor(Number(fila)) || 1);
    if (nivel === 1) {
      const arr = configPorFila(estado.grid_filas, estado.grid_columnas, estado.grid_filas_config);
      arr[f - 1] = col;
      estado.grid_filas_config = normalizarConfig(arr, estado.grid_columnas);
      estado.celdas = reajustarCeldas(estado.celdas, estado.grid_filas, estado.grid_columnas, estado.grid_filas_config, 1);
    } else {
      const nodo = celdaDeRuta(estado, estado.ruta);
      if (!nodo) return;
      const arr = configPorFila(nodo.grid_filas, nodo.grid_columnas, nodo.grid_filas_config);
      arr[f - 1] = col;
      nodo.grid_filas_config = normalizarConfig(arr, nodo.grid_columnas);
      nodo.hijos = reajustarCeldas(nodo.hijos, nodo.grid_filas, nodo.grid_columnas, nodo.grid_filas_config, nivel);
    }
    this.render();
  }

  // ---------------------------------------------------------------------------
  // PERSISTENCIA
  //  - Alta de Estok      : POST /api/estoks/{id}/mapa/ (crea la jerarquía).
  //  - Editar Estructura  : PUTs granulares por nodo (Almacenamiento).
  // ---------------------------------------------------------------------------

  private async guardar(): Promise<void> {
    const estado = this.state;
    if (!estado) return;

    // Guard anti "ID undefined": nunca golpear /api/estoks//mapa/
    if (!estado.estokId) {
      this.mostrarErrorEnModal('Falta el ID del Estok para guardar el mapa. Recargá la página y volvé a intentar.');
      return;
    }

    const btn = this.root.querySelector<HTMLButtonElement>('[data-guardar-mapa]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Guardando...';
    }
    try {
      if (this.modoEdicion) {
        await this.guardarEdicion(estado);
      } else {
        const payload = construirPayload(estado);
        await this.requestOk(`${API_BASE_URL}/estoks/${estado.estokId}/mapa/`, 'POST', payload);
      }

      this.state = null;
      this.root.innerHTML = '';
      (window as any).showSuccess?.('✅ Mapa de Estok guardado correctamente.');
      this.opciones.onGuardado?.();
    } catch (err: any) {
      // Error visible DENTRO del modal (opaco, por encima del backdrop-blur)
      // + toast global de respaldo.
      this.mostrarErrorEnModal(err?.message || 'Error al guardar el mapa del Estok.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '💾 Guardar Mapa';
      }
    }
  }

  /**
   * Guardado de EDICIÓN: PUT/POST granulares con JWT + X-Estok-Id para
   * actualizar PostgreSQL y refrescar el lienzo del Drag & Drop en vivo.
   */
  private async guardarEdicion(estado: MapaEstokWizardState): Promise<void> {
    // 1. Grilla del macro-Estok (PUT completo: incluye campos requeridos).
    await this.requestOk(`${API_BASE_URL}/estoks/${estado.estokId}/`, 'PUT', {
      nombre: (this.estokOriginal.nombre as string) || estado.estokNombre,
      descripcion: (this.estokOriginal.descripcion as string) || '',
      tipo_layout: (this.estokOriginal.tipo_layout as string) || 'VISTA_PLANTA_UNICA',
      grid_filas: estado.grid_filas,
      grid_columnas: estado.grid_columnas,
      grid_filas_config: estado.grid_filas_config,
    });

    // 2. Reconciliación de los 4 niveles (PUT si existe, POST si es nueva).
    for (let i = 0; i < estado.celdas.length; i++) {
      const { fila, col } = coordenadasDeIndice(i, estado.grid_filas, estado.grid_columnas, estado.grid_filas_config);
      await this.reconciliarCelda(estado.celdas[i], 1, {
        parentRow: fila,
        parentCol: col,
        parentId: null,
        habitacionId: null,
      });
    }

    // 3. Refresco en vivo del lienzo (el tablero DnD escucha este evento).
    window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
  }

  /** Reconciliación recursiva de una celda del árbol (PUT existente / POST nuevo). */
  private async reconciliarCelda(
    celda: CeldaWizard,
    nivel: number,
    ctx: { parentRow: number; parentCol: number; parentId: string | null; habitacionId: string | null },
  ): Promise<string | null> {
    const nombreFinal = celda.nombre || nombreDefault(nivel, ctx.parentRow, ctx.parentCol);
    let id = celda.id ?? null;

    if (id) {
      // Nodo existente → PUT (UbicacionViewSet y ContenedorViewSet son parciales).
      const body: Record<string, unknown> = {
        nombre: nombreFinal,
        parent_grid_row: ctx.parentRow,
        parent_grid_col: ctx.parentCol,
        grid_filas: celda.grid_filas,
        grid_columnas: celda.grid_columnas,
        grid_filas_config: celda.grid_filas_config,
      };
      if (nivel <= 2) {
        await this.requestOk(`${API_BASE_URL}/ubicaciones/${id}/`, 'PUT', body);
      } else {
        await this.requestOk(`${API_BASE_URL}/contenedores/${id}/`, 'PUT', body);
      }
    } else {
      // Celda nueva → POST de creación con sus coordenadas.
      const body: Record<string, unknown> = {
        nombre: nombreFinal,
        parent_grid_row: ctx.parentRow,
        parent_grid_col: ctx.parentCol,
        grid_filas: celda.grid_filas,
        grid_columnas: celda.grid_columnas,
        grid_filas_config: celda.grid_filas_config,
      };
      let respuesta: Record<string, unknown>;
      if (nivel === 1) {
        body.piso = ctx.parentRow === 1 ? 'PRIMER_PISO' : 'PLANTA_BAJA';
        body.grid_colspan = 1;
        body.grid_rowspan = 1;
        respuesta = await this.requestJson(`${API_BASE_URL}/ubicaciones/`, 'POST', body);
      } else if (nivel === 2) {
        body.parent_ubicacion = ctx.parentId;
        body.grid_colspan = 1;
        body.grid_rowspan = 1;
        respuesta = await this.requestJson(`${API_BASE_URL}/ubicaciones/`, 'POST', body);
      } else if (nivel === 3) {
        body.ubicacion = ctx.habitacionId ?? ctx.parentId;
        respuesta = await this.requestJson(`${API_BASE_URL}/contenedores/`, 'POST', body);
      } else {
        body.ubicacion = ctx.habitacionId;
        body.parent_contenedor = ctx.parentId;
        respuesta = await this.requestJson(`${API_BASE_URL}/contenedores/`, 'POST', body);
      }
      id = (respuesta?.id as string) ?? null;
    }

    // Recurrir hijos (el padre recién creado/actualizado es su contexto).
    if (nivel < 4) {
      const habitacionId = nivel === 2 ? id : ctx.habitacionId;
      for (let i = 0; i < celda.hijos.length; i++) {
        const { fila, col } = coordenadasDeIndice(i, celda.grid_filas, celda.grid_columnas, celda.grid_filas_config);
        await this.reconciliarCelda(celda.hijos[i], nivel + 1, {
          parentRow: fila,
          parentCol: col,
          parentId: id,
          habitacionId,
        });
      }
    }
    return id;
  }

  /** Fetch JSON con auth centralizada (JWT + X-Estok-Id) que valida y parsea. */
  private async requestJson(url: string, method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method,
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      window.location.href = '/login';
      throw new Error('Sesión expirada.');
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Error del servidor (${response.status}).`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  /** Fetch con auth centralizada que solo valida el estado HTTP. */
  private async requestOk(url: string, method: string, body: Record<string, unknown>): Promise<void> {
    await this.requestJson(url, method, body);
  }

  /** Pinta el cartel rojo del modal con texto 100% legible (sin difuminado). */
  private mostrarErrorEnModal(mensaje: string): void {
    const box = this.root.querySelector<HTMLElement>('#wizardError');
    if (box) {
      box.textContent = `⚠️ ${mensaje}`;
      box.classList.remove('hidden');
    }
    (window as any).showError?.(mensaje);
  }
}

