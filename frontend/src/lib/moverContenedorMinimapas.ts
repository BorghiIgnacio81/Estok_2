// =============================================================================
// ASISTENTE DE MOVIMIENTO POR MINIMAPAS EN CASCADA (modal «Mover»)
// -----------------------------------------------------------------------------
// Controlador del modal «Mover»: reemplaza los selectores de texto y el árbol
// rígido viejos por una NAVEGACIÓN POR MINIMAPAS en cascada sobre el plano
// elástico simétrico REAL del Estok activo:
//
//   NIVEL 0 · ambientes de la planta activa.
//   NIVEL 1 · muebles y cajas raíz del ambiente elegido.
//   NIVEL 2 · INTERIOR del mueble elegido: sus estantes/divisiones reales
//             (sub-contenedores) y, si todavía no tiene ninguno, la CUADRÍCULA
//             INTERNA de casilleros de su grilla (filas × columnas).
//
// NAVEGACIÓN RECURSIVA (regla de oro): tocar un MUEBLE —inmueble o móvil— NUNCA
// dispara la mudanza: lo ABRE (Nivel 2 → Nivel 3 de la cascada) y el mapa de la
// habitación se encoge al encabezado como miga de pan visual. Solo una HOJA del
// inventario (caja/estante sin hijos internos) se traslada con el toque directo.
// La persistencia final SIEMPRE es explícita: el botón «💾 Confirmar ubicación
// aquí» (o soltar la ficha sobre la silueta) envía el destino elegido.
//
// FORMAS DE MOVER (todas ejecutan el PUT atómico en PostgreSQL):
//   · Botón «💾 Confirmar ubicación aquí» sobre el nivel/destino seleccionado.
//   · CLIC sobre un destino FINAL (caja/estante sin hijos o casillero interno).
//   · SOLTAR la ficha del contenedor sobre cualquier sector del plano.
//
// Los datos viven en lib/moverContenedorMinimapasDatos.ts, la miga visual en
// lib/moverContenedorMinimapasRuta.ts y el dibujo en
// lib/moverContenedorMinimapasRender.ts: este archivo solo orquesta estado,
// eventos y persistencia (disciplina de modularidad <400 líneas).
//
// PERSISTENCIA: PUT /api/contenedores/{id}/ con `parent_contenedor` + `ubicacion`
// (+ `parent_grid_row`/`parent_grid_col` cuando el destino es un casillero
// interno del mueble) — el MISMO payload probado del Drag & Drop de
// Almacenamiento (lib/almacenamientoBoard.ts → moverContenedor) y del Visor de
// Contenedores (asignarSubContenedor), tolerado por el backend (`update` con
// partial=True): la reasignación del `parent_contenedor_id` es atómica. Auth
// multi-tenant centralizada: lib/api.ts usa getAuthHeaders() (JWT + X-Estok-Id);
// acá NUNCA se definen headers propios.
// =============================================================================

import { apiPut } from './api';
import type { ApiError } from './api';
import { plantasDe } from './espaciosDePlanta';
import { abrirOverlay, cerrarOverlay } from './cajaOperativaModal';
import { renderAsistenteHtml } from './moverContenedorMinimapasRender';
import type { VistaMover } from './moverContenedorMinimapasRender';
import { nodosMigaMover } from './moverContenedorMinimapasRuta';
import {
  destinoDeSector,
  nombresRecorrido,
  sectoresDelNivel,
} from './moverContenedorMinimapasNiveles';
import type { Destino, NivelRecorrido } from './moverContenedorMinimapasNiveles';
import {
  cargarEstructuraMover,
  contenedorPorId,
  esDescendiente,
  esMuebleIngresable,
} from './moverContenedorMinimapasDatos';
import type { ContenedorMover, EstructuraMover } from './moverContenedorMinimapasDatos';

export type { ContenedorMover } from './moverContenedorMinimapasDatos';

type Refrescar = () => void;

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
    nivel: 0 as NivelRecorrido,
    destino: null as Destino | null,
    guardando: false,
  };

  const nodo = <T extends HTMLElement>(selector: string): T | null =>
    overlay.querySelector(selector) as T | null;

  // ---------------------------------------------------------------------------
  // 1. DERIVACIONES DEL RECORRIDO (sectores por nivel, destino de cada sector y
  // miga de pan textual) · viven en lib/moverContenedorMinimapasNiveles.ts y se
  // consumen con el estado vigente: acá solo hay estado, eventos y persistencia.
  // ---------------------------------------------------------------------------

  /** Repinta el asistente completo con el mapa vigente y la miga de pan. */
  function render(): void {
    const { sectores, aviso } = sectoresDelNivel(estructura, contenedor.id, estado);
    const vista: VistaMover = {
      nivel: estado.nivel,
      nombreContenedor: contenedor.nombre,
      plantas: plantasDe(estructura.estok, estructura.ubicaciones),
      planta: estado.planta,
      recorrido: nombresRecorrido(estructura, estado),
      // MIGA VISUAL: la habitación y el mueble recorridos «encogidos» en el
      // encabezado (solo existen a partir del nivel de contenedores).
      nodos: nodosMigaMover(estructura, {
        planta: estado.planta,
        habitacionId: estado.habitacionId,
        muebleId: estado.nivel === 2 ? estado.muebleId : null,
        contenedorId: contenedor.id,
      }),
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
      estado.destino = estado.habitacionId
        ? destinoDeSector(estructura, estado, estado.habitacionId)
        : null;
    } else if (estado.nivel === 1) {
      estado.habitacionId = null;
      estado.nivel = 0;
      estado.destino = null;
    }
    render();
  }

  /**
   * CLIC en un sector: en el nivel de ambientes NAVEGA al ambiente elegido; en el
   * nivel de contenedores NAVEGA (ABRE) cualquier MUEBLE —inmueble o móvil: el
   * toque jamás lo mueve— y, si el sector es una hoja del inventario (caja/estante
   * sin hijos) o un estante/casillero del mueble ya abierto, ejecuta el traslado.
   */
  function seleccionarSector(sectorId: string): void {
    const destino = destinoDeSector(estructura, estado, sectorId);
    if (!destino) return;

    if (destino.tipo === 'habitacion') {
      estado.habitacionId = destino.id;
      estado.muebleId = null;
      estado.nivel = 1;
      estado.destino = destino;
      render();
      return;
    }

    // MUEBLE: se ABRE (Nivel 2 → Nivel 3 de la cascada). El lienzo central pasa a
    // su interior y el mapa de la habitación sube a la miga del encabezado.
    const destinoContenedor = contenedorPorId(estructura, destino.id);
    if (estado.nivel === 1 && destinoContenedor && esMuebleIngresable(destinoContenedor)) {
      estado.muebleId = destino.id;
      estado.nivel = 2;
      estado.destino = destino;
      render();
      return;
    }
    // Destino FINAL (hoja del inventario o estante/casillero del mueble abierto).
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
    // contenedor → con su ubicación sincronizada y, si el destino elegido fue un
    // CASILLERO de la cuadrícula interna del mueble, con su coordenada F·C exacta
    // (mismo payload que el arrastre del Visor de Contenedores).
    const casillero = destino.casillero ?? null;
    const payload = destino.tipo === 'habitacion'
      ? { ubicacion: destino.ubicacionId, parent_contenedor: null, parent_grid_row: null, parent_grid_col: null }
      : {
          ubicacion: destino.ubicacionId || null,
          parent_contenedor: destino.id,
          parent_grid_row: casillero ? casillero.fila : null,
          parent_grid_col: casillero ? casillero.col : null,
        };

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
        boton.textContent = '💾 Confirmar ubicación aquí';
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
    const destino = sector
      ? destinoDeSector(estructura, estado, sector.getAttribute('data-sector-id') || '')
      : null;
    if (destino) void ejecutarMovimiento(destino);
  });

  // Primer pintado: plano de los ambientes de la planta del contenedor.
  render();
}

