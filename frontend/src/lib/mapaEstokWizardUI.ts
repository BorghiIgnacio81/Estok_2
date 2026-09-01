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

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Abre el wizard para un Estok recién creado (estok.id + estok.nombre). */
  abrir(estok: { id: string; nombre: string }, opciones: MapaEstokWizardOpciones = {}): void {
    this.opciones = opciones;
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
  // PERSISTENCIA (POST /api/estoks/{id}/mapa/)
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
      const payload = construirPayload(estado);
      const response = await fetch(`${API_BASE_URL}/estoks/${estado.estokId}/mapa/`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || `Error del servidor (${response.status}).`);
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

