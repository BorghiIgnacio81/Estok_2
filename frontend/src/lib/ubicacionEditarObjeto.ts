// =============================================================================
// EDICIÓN DE UBICACIÓN · MUEBLE / OBJETO DECLARADO DENTRO DEL ESPACIO
// -----------------------------------------------------------------------------
// La Ubicación (habitación/división) no tiene `declarado_movible` propio: los
// muebles declarados «Mueble / Objeto» son Contenedores raíz dentro de ella.
// Este módulo:
//   1. detecta los Contenedores declarados de la ubicación,
//   2. inyecta la MISMA interfaz de objeto del formulario de espacios
//      (fuente única: objetoEspacioCampos.ts),
//   3. precarga el mueble seleccionado y expone sus datos para que el PATCH de
//      la ubicación los envíe en la MISMA operación.
//
// Si la ubicación no tiene ningún mueble declarado, la sección no se muestra y
// la edición de la ubicación sigue funcionando exactamente igual.
// Auth centralizada: getAuthHeaders()/API_BASE_URL desde services/auth.
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../services/auth';
import {
  camposObjetoEspacioHtml,
  conectarCamposObjeto,
  obtenerControladorCamposObjeto,
} from './objetoEspacioCampos';

const HOST_ID = 'ubicacionObjetoCampos';

/** Contenedor raíz con la declaración explícita «Mueble / Objeto». */
interface MuebleDeclarado {
  id: string;
  nombre: string;
}

/** Estado del mueble actualmente seleccionado para editar. */
let contenedorActualId = '';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hostObjeto(): HTMLElement | null {
  return document.getElementById(HOST_ID);
}

/** Texto del selector de muebles (sólo se muestra si hay más de uno). */
function opcionesMuebleHtml(muebles: MuebleDeclarado[]): string {
  if (muebles.length <= 1) return '';
  return `<label for="ubicacionMuebleSelect" class="block text-sm font-medium text-gray-700 mb-1">
      Mueble / Objeto a editar
    </label>
    <select id="ubicacionMuebleSelect"
      class="w-full px-4 py-3 mb-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-base text-base bg-white">
      ${muebles
        .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.nombre)}</option>`)
        .join('')}
    </select>`;
}

/**
 * Busca muebles declarados en la ubicación y monta el panel unificado.
 * Idempotente: el markup se inyecta una sola vez por carga de página.
 */
export async function prepararObjetoUbicacion(ubicacionId: string): Promise<void> {
  const host = hostObjeto();
  if (!host) return;

  try {
    const res = await fetch(
      `${API_BASE_URL}/contenedores/?ubicacion=${encodeURIComponent(ubicacionId)}&page_size=1000`,
      { headers: getAuthHeaders() },
    );
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) {
      host.classList.add('hidden');
      return;
    }
    const data = await res.json();
    const filas: (MuebleDeclarado & { declarado_movible?: boolean })[] =
      Array.isArray(data) ? data : data.results || [];
    const muebles = filas.filter((c) => Boolean(c.declarado_movible));
    if (muebles.length === 0) {
      host.classList.add('hidden');
      return;
    }

    host.classList.remove('hidden');
    if (!host.dataset.inicializado) {
      host.innerHTML = `<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 class="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <span aria-hidden="true">🧾</span>
          Mueble / Objeto de este espacio
        </h2>
        <p class="text-sm text-gray-400 mb-4">
          Datos del Objeto vinculado al mueble declarado. Se guardan junto con la ubicación
          en la misma operación.
        </p>
        ${opcionesMuebleHtml(muebles)}
        ${camposObjetoEspacioHtml()}
      </div>`;
      host.dataset.inicializado = '1';
    }

    const controlador = conectarCamposObjeto(host);
    const selector = host.querySelector<HTMLSelectElement>('#ubicacionMuebleSelect');
    const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement | null;

    const cargarSeleccion = async (id: string): Promise<void> => {
      contenedorActualId = id;
      if (saveBtn) saveBtn.disabled = true;
      try {
        await controlador.cargar(
          `${API_BASE_URL}/contenedores/${id}/propiedades_objeto/`,
        );
      } catch {
        // Sin precarga, `recolectarObjetoUbicacion()` devuelve null: el PATCH
        // guarda la ubicación y NO pisa las propiedades del objeto.
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    };

    if (selector && !selector.dataset.conectado) {
      selector.dataset.conectado = '1';
      selector.addEventListener('change', () => {
        if (selector.value) void cargarSeleccion(selector.value);
      });
    }
    const inicial = selector?.value || muebles[0].id;
    await cargarSeleccion(inicial);
  } catch {
    // La sección es opcional: un fallo de red no bloquea la edición del espacio.
    host.classList.add('hidden');
  }
}

/**
 * Datos del objeto a anexar al PATCH de la ubicación:
 * `objeto_contenedor_id` + campos `objeto_*` + fotos.
 * Devuelve null si no hay mueble declarado visible o la precarga no terminó.
 */
export function recolectarObjetoUbicacion(): {
  contenedorId: string;
  datos: Record<string, string>;
  fotos: File[];
} | null {
  const host = hostObjeto();
  if (!host || host.classList.contains('hidden') || !contenedorActualId) return null;
  const controlador = obtenerControladorCamposObjeto(host);
  if (!controlador || !controlador.estaListo()) return null;
  return { contenedorId: contenedorActualId, ...controlador.recolectar() };
}
