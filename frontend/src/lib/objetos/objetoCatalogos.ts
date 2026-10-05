// =============================================================================
// CATÁLOGOS + ALTA RÁPIDA DE ESPACIOS (/objetos/nuevo)
// -----------------------------------------------------------------------------
// Desmantelado del <script> de pages/objetos/nuevo.astro (regla de
// modularización <400 líneas por archivo). Agrupa dos responsabilidades afines:
//   · Carga de catálogos del Estok: ubicaciones, usuarios (dueño/beneficiario) y
//     categorías (11 oficiales de Mercado Libre). Avisa por los eventos
//     'estok:usuariosCargados' (LegadoTrazabilidad) y 'categoriaCreada'.
//   · Modales in-place de creación rápida de UBICACIONES y CONTENEDORES: POSTean
//     a /api/ubicaciones/ y /api/contenedores/ con getAuthHeaders() (JWT +
//     X-Estok-Id) y refrescan en vivo el SELECTOR DE MINIMAPAS, sin recargar la
//     página (para no perder la foto analizada ni los textos ya escritos).
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../../services/auth';
import { refOpcional } from '../dom';
import {
  refrescarSelectorMinimapaUbicacion,
  seleccionarEspacioMinimapa,
} from '../selectorMinimapaNuevoObjeto';
import { showToast } from '../toast';

// Lista plana de ubicaciones del Estok: alimenta el select del modal de alta
// rápida de contenedores.
let ubicacionesPlano: { id: string; nombre: string }[] = [];

// =============================================================================
// CARGA DE CATÁLOGOS
// =============================================================================

/** Trae las ubicaciones del Estok (lista plana para el modal de contenedores). */
async function cargarUbicaciones(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/ubicaciones/`, {
      headers: getAuthHeaders(),
    });
    if (response.ok) {
      const data = await response.json();
      const ubicaciones = data.results || data;
      ubicacionesPlano = (ubicaciones || []).map((u: any) => ({
        id: String(u.id),
        nombre: u.nombre,
      }));
    }
  } catch (err) {
    console.error('Error cargando ubicaciones:', err);
  }
}

/** Trae los usuarios del Estok y llena los comboboxes dueño/beneficiario. */
async function cargarUsuarios(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/usuarios/`, {
      headers: getAuthHeaders(),
    });
    if (response.ok) {
      const data = await response.json();
      const usuarios = data.results || data;
      const duenoSelect = refOpcional<HTMLSelectElement>('dueno_original');
      const benSelect = refOpcional<HTMLSelectElement>('beneficiario');
      if (!duenoSelect || !benSelect) return;
      usuarios.forEach((u: any) => {
        const opt1 = document.createElement('option');
        opt1.value = u.id;
        opt1.textContent = u.full_name || u.username || u.email;
        duenoSelect.appendChild(opt1);
        const opt2 = document.createElement('option');
        opt2.value = u.id;
        opt2.textContent = u.full_name || u.username || u.email;
        benSelect.appendChild(opt2);
      });
    }
  } catch (err) {
    console.error('Error cargando usuarios:', err);
  } finally {
    // El widget de Legado recalcula su aviso de votación cuando el padrón del
    // Estok ya está cargado en los comboboxes.
    window.dispatchEvent(new CustomEvent('estok:usuariosCargados'));
  }
}

/** Trae las categorías (11 oficiales de Mercado Libre) al combobox `categoria`. */
async function cargarCategorias(): Promise<void> {
  const select = refOpcional<HTMLSelectElement>('categoria');
  if (!select) return;
  try {
    const response = await fetch(`${API_BASE_URL}/categorias/`, {
      headers: getAuthHeaders(),
    });
    if (response.ok) {
      const data = await response.json();
      const categorias = data.results || data;
      // Preservar opción "Sin categoría"
      select.innerHTML = '<option value="">Sin categoría</option>';
      categorias.forEach((c: any) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        // Guarda el ID de Mercado Libre de la categoría para que el autocompletado
        // de IA pueda seleccionarla por su ID oficial (MLAxxxxx).
        opt.dataset.meliId = c.mercadolibre_category_id ? String(c.mercadolibre_category_id) : '';
        opt.textContent = `${c.icono || '🏷️'} ${c.nombre}`;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Error cargando categorías:', err);
  }
}

// =============================================================================
// HELPERS DE MODALES Y REFRESCO DEL SELECTOR DE MINIMAPAS
// =============================================================================

/** Convierte el payload de error del backend en un mensaje legible. */
async function leerErrorApi(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data === 'string') return data;
    const detalle = data?.detail || data?.error || data?.non_field_errors?.[0] || '';
    if (detalle) return detalle;
    const primerCampo = Object.keys(data || {}).find((k) => Array.isArray(data[k]) && data[k].length);
    return primerCampo ? data[primerCampo][0] : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Recarga los espacios del Estok y deja SELECCIONADO el espacio recién creado
 * en el selector de minimapas (alta rápida in-place desde los modales).
 */
async function refrescarYSeleccionar(tipo: 'ubicacion' | 'contenedor', id: string): Promise<void> {
  await refrescarSelectorMinimapaUbicacion();
  if (seleccionarEspacioMinimapa(tipo, id)) return;

  // El listado puede llegar con un frame de retraso: se reintenta una vez.
  requestAnimationFrame(() => {
    void refrescarSelectorMinimapaUbicacion().then(() => seleccionarEspacioMinimapa(tipo, id));
  });
}

/** Elimina un modal del DOM por id. */
function cerrarModal(modalId: string): void {
  document.getElementById(modalId)?.remove();
}

// =============================================================================
// MODAL: CREAR UNA NUEVA UBICACIÓN (POST /api/ubicaciones/)
// =============================================================================

function abrirModalNuevaUbicacion(): void {
  const modalId = 'modalNuevaUbicacion';
  if (document.getElementById(modalId)) return;

  const overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-sm';
  overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden transform transition-all">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 class="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span class="text-xl">📁</span> Nueva Ubicación
          </h3>
          <button id="cerrarNuevaUbicacionBtn" type="button" class="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-base">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="p-6 space-y-4">
          <div>
            <label for="inputNombreUbicacion" class="block text-sm font-medium text-gray-700 mb-1">Nombre de la ubicación <span class="text-red-500">*</span></label>
            <input id="inputNombreUbicacion" type="text" placeholder="Ej: Living, Garaje, Biblioteca, Dormitorio..." autofocus
              class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-base" />
          </div>
          <div>
            <label for="inputDescripcionUbicacion" class="block text-sm font-medium text-gray-700 mb-1">Descripción (opcional)</label>
            <textarea id="inputDescripcionUbicacion" rows="2" placeholder="Detalles del espacio..."
              class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-base"></textarea>
          </div>
          <div id="errorNuevaUbicacion" class="hidden p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"></div>
        </div>
        <div class="flex gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button id="cancelarNuevaUbicacionBtn" type="button"
            class="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-base">Cancelar</button>
          <button id="guardarNuevaUbicacionBtn" type="button"
            class="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-base shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">Crear Ubicación</button>
        </div>
      </div>
    `;
  document.body.appendChild(overlay);

  const inputNombre = overlay.querySelector<HTMLInputElement>('#inputNombreUbicacion')!;
  const inputDescripcion = overlay.querySelector<HTMLTextAreaElement>('#inputDescripcionUbicacion')!;
  const errorDiv = overlay.querySelector<HTMLElement>('#errorNuevaUbicacion')!;
  const guardarBtn = overlay.querySelector<HTMLButtonElement>('#guardarNuevaUbicacionBtn')!;

  overlay.querySelector('#cerrarNuevaUbicacionBtn')!.addEventListener('click', () => cerrarModal(modalId));
  overlay.querySelector('#cancelarNuevaUbicacionBtn')!.addEventListener('click', () => cerrarModal(modalId));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrarModal(modalId);
  });
  inputNombre.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') guardarBtn.click();
  });

  guardarBtn.addEventListener('click', async () => {
    const nombre = inputNombre.value.trim();
    if (!nombre) {
      errorDiv.textContent = 'El nombre de la ubicación es obligatorio.';
      errorDiv.classList.remove('hidden');
      inputNombre.focus();
      return;
    }
    errorDiv.classList.add('hidden');
    guardarBtn.disabled = true;
    guardarBtn.textContent = 'Guardando...';
    try {
      const response = await fetch(`${API_BASE_URL}/ubicaciones/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ nombre, descripcion: inputDescripcion.value.trim() }),
      });
      if (!response.ok) {
        throw new Error(await leerErrorApi(response, 'Error al crear la ubicación.'));
      }
      const data = await response.json();
      const nuevoId = String(data.id);
      // Actualizar la lista en memoria y seleccionar el espacio nuevo en el
      // selector de minimapas (sin recargar la página ni perder la foto).
      ubicacionesPlano.push({ id: nuevoId, nombre: data.nombre });
      refrescarYSeleccionar('ubicacion', nuevoId);
      showToast(`📁 Ubicación "${data.nombre}" creada y seleccionada`, 'success');
      cerrarModal(modalId);
    } catch (err) {
      errorDiv.textContent = err instanceof Error ? err.message : 'Error al crear la ubicación.';
      errorDiv.classList.remove('hidden');
      guardarBtn.disabled = false;
      guardarBtn.textContent = 'Crear Ubicación';
    }
  });

  setTimeout(() => inputNombre.focus(), 100);
}

// =============================================================================
// MODAL: CREAR UN NUEVO CONTENEDOR (POST /api/contenedores/)
// =============================================================================

function abrirModalNuevoContenedor(): void {
  const modalId = 'modalNuevoContenedor';
  if (document.getElementById(modalId)) return;

  // Ubicación padre: la seleccionada en el selector de minimapas o un select con todas.
  const ubicacionInput = document.getElementById('ubicacionSeleccionada') as HTMLInputElement | null;
  const ubicacionActual = ubicacionInput?.value || '';
  const opcionesUbicaciones = ubicacionesPlano
    .map((n) => `<option value="${n.id}"${n.id === ubicacionActual ? ' selected' : ''}>📁 ${n.nombre}</option>`)
    .join('');
  const sinUbicaciones = opcionesUbicaciones === '';

  const overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-sm';
  overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden transform transition-all">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 class="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span class="text-xl">📦</span> Nuevo Contenedor
          </h3>
          <button id="cerrarNuevoContenedorBtn" type="button" class="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-base">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="p-6 space-y-4">
          <div>
            <label for="inputUbicacionContenedor" class="block text-sm font-medium text-gray-700 mb-1">Ubicación padre <span class="text-red-500">*</span></label>
            <select id="inputUbicacionContenedor"
              class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-base">
              <option value="">${sinUbicaciones ? 'Primero creá una ubicación' : 'Seleccionar ubicación...'}</option>
              ${opcionesUbicaciones}
            </select>
          </div>
          <div>
            <label for="inputNombreContenedor" class="block text-sm font-medium text-gray-700 mb-1">Nombre del contenedor <span class="text-red-500">*</span></label>
            <input id="inputNombreContenedor" type="text" placeholder="Ej: Caja N°1, Estante A, Cajón..." autofocus
              class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-base" />
          </div>
          <div id="errorNuevoContenedor" class="hidden p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"></div>
        </div>
        <div class="flex gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button id="cancelarNuevoContenedorBtn" type="button"
            class="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-base">Cancelar</button>
          <button id="guardarNuevoContenedorBtn" type="button"
            class="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-base shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">Crear Contenedor</button>
        </div>
      </div>
    `;
  document.body.appendChild(overlay);

  const selectUbicacion = overlay.querySelector<HTMLSelectElement>('#inputUbicacionContenedor')!;
  const inputNombre = overlay.querySelector<HTMLInputElement>('#inputNombreContenedor')!;
  const errorDiv = overlay.querySelector<HTMLElement>('#errorNuevoContenedor')!;
  const guardarBtn = overlay.querySelector<HTMLButtonElement>('#guardarNuevoContenedorBtn')!;

  overlay.querySelector('#cerrarNuevoContenedorBtn')!.addEventListener('click', () => cerrarModal(modalId));
  overlay.querySelector('#cancelarNuevoContenedorBtn')!.addEventListener('click', () => cerrarModal(modalId));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrarModal(modalId);
  });
  inputNombre.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') guardarBtn.click();
  });

  guardarBtn.addEventListener('click', async () => {
    const ubicacionId = selectUbicacion.value;
    const nombre = inputNombre.value.trim();
    if (!ubicacionId) {
      errorDiv.textContent = sinUbicaciones
        ? 'Primero creá una ubicación para poder agregar un contenedor.'
        : 'Seleccioná la ubicación donde irá el contenedor.';
      errorDiv.classList.remove('hidden');
      if (!sinUbicaciones) selectUbicacion.focus();
      return;
    }
    if (!nombre) {
      errorDiv.textContent = 'El nombre del contenedor es obligatorio.';
      errorDiv.classList.remove('hidden');
      inputNombre.focus();
      return;
    }
    errorDiv.classList.add('hidden');
    guardarBtn.disabled = true;
    guardarBtn.textContent = 'Guardando...';
    try {
      const response = await fetch(`${API_BASE_URL}/contenedores/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ nombre, ubicacion: ubicacionId }),
      });
      if (!response.ok) {
        throw new Error(await leerErrorApi(response, 'Error al crear el contenedor.'));
      }
      const data = await response.json();
      const nuevoId = String(data.id);
      // El contenedor nuevo se refleja al recargar el selector de minimapas:
      // refrescarYSeleccionar() pide los espacios y lo deja seleccionado.
      refrescarYSeleccionar('contenedor', nuevoId);
      showToast(`📦 Contenedor "${data.nombre}" creado y seleccionado`, 'success');
      cerrarModal(modalId);
    } catch (err) {
      errorDiv.textContent = err instanceof Error ? err.message : 'Error al crear el contenedor.';
      errorDiv.classList.remove('hidden');
      guardarBtn.disabled = false;
      guardarBtn.textContent = 'Crear Contenedor';
    }
  });

  setTimeout(() => inputNombre.focus(), 100);
}

// =============================================================================
// INICIALIZACIÓN
// =============================================================================

/** Inicializa la carga de catálogos, los modales in-place y sus disparadores. */
export function initObjetoCatalogos(): void {
  // La ubicación se resuelve con el selector de minimapas, que se autoinicializa
  // con el componente (SelectorMinimapaUbicacion.astro). Acá solo se cargan los
  // catálogos y se enlazan los botones de alta rápida.
  void cargarUbicaciones();
  void cargarUsuarios();
  void cargarCategorias();

  // Recargar categorías cuando se crea una nueva
  window.addEventListener('categoriaCreada', () => {
    void cargarCategorias();
  });

  // Conectar los botones de creación rápida de la sección de almacenamiento.
  // Son <img> interactivas (imágenes físicas locales); el id kebab-case se
  // corresponde con el marcado de ObjetoFormFields.astro.
  refOpcional<HTMLElement>('btn-nueva-ubicacion')?.addEventListener('click', abrirModalNuevaUbicacion);
  refOpcional<HTMLElement>('btn-nuevo-contenedor')?.addEventListener('click', abrirModalNuevoContenedor);
}




