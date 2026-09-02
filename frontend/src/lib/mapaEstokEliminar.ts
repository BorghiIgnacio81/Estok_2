// =============================================================================
// ELIMINACIÓN FÍSICA EN CALIENTE DE UNA CELDA PERSISTIDA DEL WIZARD
// -----------------------------------------------------------------------------
// Módulo aislado del controlador (mapaEstokWizardUI.ts) para mantener la
// disciplina de modularidad (<400-500 líneas por archivo). Orquesta el flujo:
//   1. Advertencia destructiva controlada (confirm) ANTES de tocar el server.
//   2. DELETE /api/ubicaciones/{id}/ (Niveles 1-2) o
//      DELETE /api/contenedores/{id}/ (Niveles 3-4) con JWT + X-Estok-Id.
//   3. Sobre éxito: limpia la celda del estado del wizard (cuadrante vacío),
//      re-renderiza el modal EN CALIENTE y refresca el lienzo/visor/bandeja.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import type { CeldaWizard } from './mapaEstokWizard';

export interface OpcionesEliminarCelda {
  /** Celdas del nivel actual del wizard (estado.celdas o nodo.hijos). */
  celdas: CeldaWizard[];
  /** Índice de la celda dentro de `celdas`. */
  indice: number;
  /** Nivel del wizard actual (1-4). Niveles 1-2 → Ubicación; 3-4 → Contenedor. */
  nivel: number;
  /** Callback para pintar errores dentro del modal del wizard. */
  mostrarError: (mensaje: string) => void;
  /** Callback que re-renderiza el modal (sin recargar la pantalla completa). */
  render: () => void;
}

/**
 * Ejecuta el borrado físico de una celda persistida de la jerarquía
 * (Planta/División y Habitación → /api/ubicaciones/{id}/ ; Mueble y
 * Estantería → /api/contenedores/{id}/).
 */
export async function eliminarCeldaPersistida(opts: OpcionesEliminarCelda): Promise<boolean> {
  const { celdas, indice, nivel, mostrarError, render } = opts;
  const celda = celdas[indice];
  if (!celda?.id) return false;
  if (celda.es_inmueble) {
    mostrarError('📌 Este mueble es inmueble fijo (es_inmueble) y no puede eliminarse.');
    return false;
  }

  const esUbicacion = nivel <= 2;
  const url = `${API_BASE_URL}/${esUbicacion ? 'ubicaciones' : 'contenedores'}/${celda.id}/`;
  const nombre = celda.nombre.trim() || (esUbicacion ? 'estructura' : 'contenedor');

  // Cartel de advertencia destructiva controlada (frena la ejecución hasta que
  // el usuario confirme o cancele explícitamente).
  const ADVERTENCIA =
    'Si elimina este contenedor/ubicacion todo su contenido quedara sin ubicacion, se perdera su estructura etc. ¿Está seguro de que desea proceder?';
  if (!window.confirm(ADVERTENCIA)) return false;

  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { ...getAuthHeaders() },
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      mostrarError(String(data?.error || data?.detail || `No se pudo eliminar (${res.status}).`));
      return false;
    }

    // Éxito del servidor → remover el cuadrante EN CALIENTE: la celda queda
    // vacía (sin id/nombre/hijos) y no se vuelve a persistir en el Guardado.
    celda.id = undefined;
    celda.nombre = '';
    celda.hijos = [];
    render();
    // Refresco en vivo del lienzo, el Visor y la bandeja de «por ubicar».
    window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
    (window as any).showSuccess?.(`🗑 «${nombre}» eliminado. Su contenido quedó en la bandeja de «por ubicar».`);
    return true;
  } catch {
    mostrarError('Error de conexión al eliminar la estructura.');
    return false;
  }
}
