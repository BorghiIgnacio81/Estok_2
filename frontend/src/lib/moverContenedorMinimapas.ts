// =============================================================================
// ASISTENTE DE MOVIMIENTO POR MINIMAPAS EN CASCADA (modal «Mover»)
// -----------------------------------------------------------------------------
// Controlador del modal «Mover»: reemplaza los selectores de texto y el árbol
// rígido viejos por una NAVEGACIÓN POR MINIMAPAS en cascada sobre el plano
// elástico simétrico REAL del Estok activo:
//
//   NIVEL 0 · ambientes de la planta activa.
//   NIVEL 1 · muebles y cajas raíz del ambiente elegido.
//   NIVEL 2 · cajas internas del mueble elegido.
//
// El mapa del nivel anterior queda como MIGA DE PAN contextual en el encabezado,
// con el botón «⬅ Volver» para desandar niveles.
//
// FORMAS DE MOVER (todas ejecutan el PUT atómico en PostgreSQL):
//   · CLIC sobre un destino FINAL (caja/estante sin hijos o mueble sin cajas).
//   · SOLTAR la ficha del contenedor sobre cualquier sector del plano.
//   · Botón «📦 Mover a «X»» sobre el nivel seleccionado.
//
// Los datos viven en lib/moverContenedorMinimapasDatos.ts y el dibujo en
// lib/moverContenedorMinimapasRender.ts: este archivo solo orquesta estado,
// eventos y persistencia (disciplina de modularidad <400 líneas).
//
// PERSISTENCIA: PUT /api/contenedores/{id}/ con `parent_contenedor` + `ubicacion`
// y coordenadas de casillero nulas — el MISMO payload probado del Drag & Drop de
// Almacenamiento (lib/almacenamientoBoard.ts → moverContenedor) y tolerado por
// el backend (`update` con partial=True): la reasignación del
// `parent_contenedor_id` es atómica. Auth multi-tenant centralizada: lib/api.ts
// usa getAuthHeaders() (JWT + X-Estok-Id); acá NUNCA se definen headers propios.
// =============================================================================

import { apiPut } from './api';
import type { ApiError } from './api';
import type { SectorMinimapa } from './minimapa';
import { sectoresDeItems } from './sectoresMinimapa';
import { plantasDe } from './espaciosDePlanta';
import { abrirOverlay, cerrarOverlay } from './cajaOperativaModal';
import { renderAsistenteHtml } from './moverContenedorMinimapasRender';
import type { VistaMover } from './moverContenedorMinimapasRender';
import {
  ambientesDePlanta,
  cajasDelMueble,
  cargarEstructuraMover,
  contenedoresDelAmbiente,
  esDescendiente,
} from './moverContenedorMinimapasDatos';
import type { ContenedorMover, EstructuraMover } from './moverContenedorMinimapasDatos';

export type { ContenedorMover } from './moverContenedorMinimapasDatos';

type Refrescar = () => void;
type Nivel = 0 | 1 | 2;

/** Destino final del traslado (ambiente o contenedor del Estok). */
interface Destino {
  tipo: 'habitacion' | 'contenedor';
  id: string;
  nombre: string;
  /** Ubicación que viaja en el PUT (ambiente del destino final). */
  ubicacionId: string;
}

const LAMINA_CARGA =
  '<p class="text-sm text-gray-500 py-6 text-center">⏳ Cargando el plano real del Estok…</p>';

/**
 * Abre el asistente de movimiento por minimapas en cascada para un contenedor.
 * `alRefrescar` se invoca tras el PUT exitoso para re-pintar el listado en vivo.
 */
export async function abrirMoverCajaMinimapas(
  contenedor: ContenedorMover,
  alRefrescar: Refrescar = () => {},
): Promise<void> {
  const { overlay, form } = abrirOverlay('Mover · ' + contenedor.nombre, 'max-w-2xl');
  form.innerHTML = LAMINA_CARGA;

  let estructura: EstructuraMover;
  try {
    estructura = await cargarEstructuraMover(contenedor);
  } catch {
    form.innerHTML =
      '<p class="text-sm text-red-600 py-6 text-center">⚠️ No se pudieron cargar los espacios del Estok activo. Cerrá el modal y reintentá.</p>';
    return;
  }

  const estado = {
    planta: estructura.planta,
    habitacionId: null as string | null,
    muebleId: null as string | null,
    nivel: 0 as Nivel,
    destino: null as Destino | null,
    guardando: false,
  };

  const nodo = <T extends HTMLElement>(selector: string): T | null =>
    overlay.querySelector(selector) as T | null;

  // ---------------------------------------------------------------------------
  // 1. DERIVACIONES DEL RECORRIDO · destino de un sector y sectores por nivel
  // ---------------------------------------------------------------------------

  /** Destino final al que apunta un sector del plano (ambiente o contenedor). */
  function destinoDeSector(sectorId: string): Destino | null {
    if (!sectorId) return null;
    const habitacion = estructura.ubicaciones.find((u) => String(u.id) === sectorId);
    if (habitacion) {
      return {
        tipo: 'habitacion',
        id: String(habitacion.id),
        nombre: habitacion.nombre,
        ubicacionId: String(habitacion.id),
      };
    }
    const destino = estructura.contenedores.find((c) => c.id === sectorId);
    if (!destino) return null;
    return {
      tipo: 'contenedor',
      id: destino.id,
      nombre: destino.nombre,
      ubicacionId: destino.ubicacion || estado.habitacionId || '',
    };
  }

  /**
   * Sectores REALES del nivel visible (geometría ui_* de PostgreSQL). Sin datos
   * devuelve el aviso explicativo: el asistente JAMÁS dibuja un plano inventado.
   */
  function sectoresDelNivel(): { sectores: SectorMinimapa[]; aviso: string } {
    if (estado.nivel === 0) {
      const ambientes = ambientesDePlanta(estructura, estado.planta);
      if (!ambientes.length) {
        return {
          sectores: [],
          aviso: 'Esta planta todavía no tiene ambientes definidos en el plano.',
        };
      }
      return { sectores: sectoresDeItems(ambientes, estado.habitacionId), aviso: '' };
    }

    if (estado.nivel === 1) {
      const items = contenedoresDelAmbiente(estructura, estado.habitacionId, contenedor.id);
      if (!items.length) {
        return {
          sectores: [],
          aviso: 'Este ambiente no tiene muebles ni cajas: tocá «Mover aquí» para dejarlo a nivel del ambiente.',
        };
      }
      return { sectores: sectoresDeItems(items, null), aviso: '' };
    }

    const cajas = cajasDelMueble(estructura, estado.muebleId, contenedor.id);
    if (!cajas.length) {
      return {
        sectores: [],
        aviso: 'Este mueble no tiene cajas internas: tocá «Mover aquí» para dejarlo dentro del mueble.',
      };
    }
    return { sectores: sectoresDeItems(cajas, null), aviso: '' };
  }

  /** Nombres de los niveles ya recorridos (miga de pan contextual). */
  function nombresRecorrido(): string[] {
    const nombres: string[] = [];
    const habitacion = estado.habitacionId
      ? estructura.ubicaciones.find((u) => String(u.id) === String(estado.habitacionId))
      : undefined;
    if (habitacion) nombres.push(habitacion.nombre);
    const mueble = estado.muebleId
      ? estructura.contenedores.find((c) => c.id === estado.muebleId)
      : undefined;
    if (mueble) nombres.push(mueble.nombre);
    return nombres;
  }

  /** Repinta el asistente completo con el mapa vigente y la miga de pan. */
  function render(): void {
    const { sectores, aviso } = sectoresDelNivel();
    const vista: VistaMover = {
      nivel: estado.nivel,
      nombreContenedor: contenedor.nombre,
      plantas: plantasDe(estructura.estok, estructura.ubicaciones),
      planta: estado.planta,
      recorrido: nombresRecorrido(),
      sectores,
      aviso,
      destinoNombre: estado.destino ? estado.destino.nombre : null,
    };
    form.innerHTML = renderAsistenteHtml(vista);
  }

  // ---------------------------------------------------------------------------
  // 2. NAVEGACIÓN POR MINIMAPAS · desandar niveles y elegir el destino final
  // ---------------------------------------------------------------------------

  /** Aviso de error dentro del propio overlay (mismo host que el resto de modales). */
  function mostrarError(mensaje: string): void {
    const host = nodo<HTMLElement>('.js-overlay-error');
    if (!host) return;
    host.textContent = '⚠️ ' + mensaje;
    host.classList.remove('hidden');
  }

  /** «⬅ Volver»: el mapa vigente pasa a ser el del nivel padre (miga de pan). */
  function volverNivel(): void {
    if (estado.nivel === 2) {
      estado.muebleId = null;
      estado.nivel = 1;
      estado.destino = estado.habitacionId ? destinoDeSector(estado.habitacionId) : null;
    } else if (estado.nivel === 1) {
      estado.habitacionId = null;
      estado.nivel = 0;
      estado.destino = null;
    }
    render();
  }

  /**
   * CLIC en un sector: en el primer nivel NAVEGA al ambiente elegido; en los
   * niveles de contenedores NAVEGA al mueble con cajas internas y, si el sector
   * es una hoja del inventario (caja/estante sin hijos), EJECUTA el traslado.
   */
  function seleccionarSector(sectorId: string): void {
    const destino = destinoDeSector(sectorId);
    if (!destino) return;

    if (destino.tipo === 'habitacion') {
      estado.habitacionId = destino.id;
      estado.muebleId = null;
      estado.nivel = 1;
      estado.destino = destino;
      render();
      return;
    }

    if (cajasDelMueble(estructura, destino.id, contenedor.id).length) {
      estado.muebleId = destino.id;
      estado.nivel = 2;
      estado.destino = destino;
      render();
      return;
    }
    // Destino FINAL (hoja del inventario): el clic mueve el contenedor en el acto.
    void ejecutarMovimiento(destino);
  }

  /** PUT /api/contenedores/{id}/ · reasigna `parent_contenedor` de forma atómica. */
  async function ejecutarMovimiento(destino: Destino): Promise<void> {
    if (estado.guardando) return;
    if (destino.tipo === 'contenedor' && esDescendiente(estructura, contenedor.id, destino.id)) {
      mostrarError('No podés mover un contenedor dentro de sí mismo ni de sus sub-contenedores.');
      return;
    }

    estado.guardando = true;
    const boton = nodo<HTMLButtonElement>('.js-mover-confirmar');
    if (boton) {
      boton.disabled = true;
      boton.textContent = 'Moviendo…';
    }

    // Raíz del ambiente → sin padre y con la ubicación nueva; dentro de un
    // contenedor → con su ubicación sincronizada y sin coordenadas de casillero.
    const payload = destino.tipo === 'habitacion'
      ? { ubicacion: destino.ubicacionId, parent_contenedor: null, parent_grid_row: null, parent_grid_col: null }
      : { ubicacion: destino.ubicacionId || null, parent_contenedor: destino.id, parent_grid_row: null, parent_grid_col: null };

    try {
      await apiPut('/contenedores/' + encodeURIComponent(contenedor.id) + '/', payload);
      const win = window as any;
      if (win.showSuccess) win.showSuccess('📦 «' + contenedor.nombre + '» movido a «' + destino.nombre + '».');
      cerrarOverlay();
      alRefrescar();
    } catch (err) {
      const apiErr = err as ApiError;
      mostrarError(apiErr && apiErr.error ? apiErr.error : 'No se pudo mover el contenedor.');
      if (boton) {
        boton.disabled = false;
        boton.textContent = '📦 Mover a «' + destino.nombre + '»';
      }
      estado.guardando = false;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. EVENTOS · clic en sectores, volver, confirmar, planta y soltado (drop)
  // ---------------------------------------------------------------------------

  overlay.addEventListener('click', (evento) => {
    const objetivo = evento.target as Element | null;
    if (!objetivo || typeof objetivo.closest !== 'function') return;

    if (objetivo.closest('.js-mover-volver')) {
      evento.preventDefault();
      volverNivel();
      return;
    }
    if (objetivo.closest('.js-mover-confirmar')) {
      evento.preventDefault();
      if (estado.destino) void ejecutarMovimiento(estado.destino);
      return;
    }
    const sector = objetivo.closest('[data-sector-id]');
    if (sector) {
      evento.preventDefault();
      seleccionarSector(sector.getAttribute('data-sector-id') || '');
    }
  });

  // Cambio de planta activa: el recorrido vuelve al nivel de ambientes.
  overlay.addEventListener('change', (evento) => {
    const objetivo = evento.target as HTMLElement | null;
    if (!objetivo || !objetivo.classList || !objetivo.classList.contains('js-mover-planta')) return;
    estado.planta = Math.max(1, Math.floor(Number((objetivo as HTMLSelectElement).value) || 1));
    estado.habitacionId = null;
    estado.muebleId = null;
    estado.nivel = 0;
    estado.destino = null;
    render();
  });

  // SOLTAR la ficha del contenedor sobre un sector ejecuta el traslado directo.
  overlay.addEventListener('dragstart', (evento) => {
    const objetivo = evento.target as Element | null;
    if (!objetivo || typeof objetivo.closest !== 'function' || !objetivo.closest('.js-mover-arrastrar')) return;
    const data = (evento as DragEvent).dataTransfer;
    if (data) {
      data.setData('text/plain', contenedor.id);
      data.effectAllowed = 'move';
    }
  });

  /** El plano es la única zona de suelta: `dragover` debe cancelarse para permitirla. */
  function esZonaSoltado(objetivo: Element | null): boolean {
    return Boolean(objetivo && typeof objetivo.closest === 'function' && objetivo.closest('[data-mover-plano]'));
  }

  overlay.addEventListener('dragover', (evento) => {
    if (!esZonaSoltado(evento.target as Element | null)) return;
    evento.preventDefault();
  });

  overlay.addEventListener('drop', (evento) => {
    const objetivo = evento.target as Element | null;
    if (!esZonaSoltado(objetivo)) return;
    evento.preventDefault();
    const sector = objetivo ? objetivo.closest('[data-sector-id]') : null;
    const destino = sector ? destinoDeSector(sector.getAttribute('data-sector-id') || '') : null;
    if (destino) void ejecutarMovimiento(destino);
  });

  // Primer pintado: plano de los ambientes de la planta del contenedor.
  render();
}

