// =============================================================================
// EDICIÓN DE OBJETO · ORQUESTADOR (comportamiento de la página de edición)
// -----------------------------------------------------------------------------
// Carga el objeto desde la API, completa el formulario, hidrata el mapa de
// ubicación (minimapas interactivos) y envía el PUT con la selección vigente del
// mapa. Los bloques independientes viven en sus propios módulos:
//   · lib/editarObjetoFotos.ts  → grilla + subida secuencial de fotos
//   · lib/editarObjetoPrecio.ts → precio de referencia (MercadoLibre / IA)
//   · lib/toast.ts              → notificaciones (único punto de invocación)
//
// Auth centralizada en services/auth (getAuthHeaders / getToken): este módulo
// NUNCA define headers propios.
// Vive fuera de pages/objetos/[id]/editar/index.astro por la regla de
// modularización (<400 líneas por archivo de UI).
// =============================================================================

import { getAuthHeaders, getToken, API_BASE_URL } from '../services/auth';
import { fijarSeleccionMinimapa, obtenerSeleccionMinimapa } from './selectorMinimapaNuevoObjeto';
import { ref } from './dom';
import { showToast } from './toast';
import { inicializarFotos, cargarFotos } from './editarObjetoFotos';
import { inicializarPrecioReferencia } from './editarObjetoPrecio';

/** ID del objeto editado: /objetos/<id>/editar → <id>. */
function idObjetoDesdeRuta(): string {
  return window.location.pathname.split('/').filter(Boolean).slice(-2, -1)[0] || '';
}

// --- Estado del módulo -------------------------------------------------------
let objetoId = '';
let loadingState: HTMLElement;
let errorState: HTMLElement;
let errorMessage: HTMLElement;
let retryBtn: HTMLElement;
let form: HTMLFormElement;
let saveBtn: HTMLButtonElement;
let saveText: HTMLElement;
let saveSpinner: HTMLElement;
let editSubtitle: HTMLElement;
let categoriaSelect: HTMLSelectElement;
let duenoSelect: HTMLSelectElement;
let beneficiarioSelect: HTMLSelectElement;

// =============================================================================
// CARGA DE DATOS DEL OBJETO
// =============================================================================

/** Trae el objeto, completa todos los campos y deja el formulario visible. */
async function cargarObjeto(): Promise<void> {
  loadingState.classList.remove('hidden');
  errorState.classList.add('hidden');
  form.classList.add('hidden');

  try {
    const response = await fetch(`${API_BASE_URL}/objetos/${objetoId}/`, {
      headers: getAuthHeaders(),
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!response.ok) throw new Error(`Error del servidor (${response.status})`);

    const obj = await response.json();

    // === Llenar campos básicos ===
    setFieldValue('nombre', obj.nombre);
    setFieldValue('descripcion', obj.descripcion);
    setFieldValue('estado_conservacion', obj.estado_conservacion);
    setFieldValue('color', obj.color);
    setFieldValue('valor_estimado', obj.valor_estimado);

    // === Cargar categorías (11 oficiales) y seleccionar la del objeto ===
    await cargarCategorias(obj.categoria);

    // === Llenar campos específicos ===
    if (obj.datos_especificos) {
      Object.entries(obj.datos_especificos).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          setFieldValue(key, value);
        }
      });
    }

    // === Ubicación inicial del mapa analítico (sector activo en NARANJA) ===
    // El mapa reconstruye la cadena habitación → mueble → caja con el
    // `parent_contenedor` persistido del contenedor del objeto y escribe la
    // selección en los inputs ocultos `ubicacion` / `contenedor` del form.
    await fijarSeleccionMinimapa(obj.ubicacion, obj.contenedor);

    // === Cargar usuarios y seleccionar dueño/beneficiario ===
    await cargarUsuarios(obj.dueno_original, obj.beneficiario);

    // === Cargar fotos ===
    await cargarFotos();

    // === Mostrar formulario ===
    editSubtitle.textContent = `Editando: ${obj.nombre}`;
    loadingState.classList.add('hidden');
    errorState.classList.add('hidden');
    form.classList.remove('hidden');
  } catch (err: any) {
    console.error('Error al cargar objeto:', err);
    loadingState.classList.add('hidden');
    errorState.classList.remove('hidden');
    errorMessage.textContent = err.message || 'Error de conexión.';
  }
}

/** Asigna un valor a un campo del formulario y notifica el cambio. */
function setFieldValue(fieldName: string, value: any): void {
  if (value === null || value === undefined) return;
  const el = document.getElementById(fieldName) as
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement
    | null;
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// =============================================================================
// CATEGORÍAS OFICIALES (11 de Mercado Libre vía /api/categorias/)
// =============================================================================

/** Llena el select de categorías y deja seleccionada la del objeto. */
async function cargarCategorias(selectedId?: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/categorias/`, { headers: getAuthHeaders() });
    if (res.ok) {
      const data = await res.json();
      const categorias = data.results || data;
      categorias.forEach((cat: any) => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.nombre;
        if (selectedId && cat.id === selectedId) opt.selected = true;
        categoriaSelect.appendChild(opt);
      });
    }
  } catch {
    // Silencioso: el select queda con "Sin categoría"
  }
}

// =============================================================================
// USUARIOS (legado: dueño original / beneficiario)
// =============================================================================
// La ubicación NO se carga por <select>: la resuelve el selector de minimapas
// (lib/selectorMinimapaNuevoObjeto.ts) al abrir la página con
// fijarSeleccionMinimapa().

/** Llena dueño original y beneficiario con los usuarios del Estok. */
async function cargarUsuarios(duenoId?: string, beneficiarioId?: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/usuarios/`, { headers: getAuthHeaders() });
    if (res.ok) {
      const data = await res.json();
      const usuarios = data.results || data;
      usuarios.forEach((user: any) => {
        const nombre = user.first_name
          ? `${user.first_name} ${user.last_name || ''}`
          : user.username;

        const optD = document.createElement('option');
        optD.value = user.id;
        optD.textContent = nombre;
        if (duenoId && user.id === duenoId) optD.selected = true;
        duenoSelect.appendChild(optD);

        const optB = document.createElement('option');
        optB.value = user.id;
        optB.textContent = nombre;
        if (beneficiarioId && user.id === beneficiarioId) optB.selected = true;
        beneficiarioSelect.appendChild(optB);
      });
    }
  } catch { /* ignore */ }
}

// =============================================================================
// GUARDADO (PUT)
// =============================================================================

/** Submit del formulario: PUT a la API con la ubicación vigente del mapa. */
async function enviarFormulario(evento: Event): Promise<void> {
  evento.preventDefault();

  if (!getToken()) {
    showToast('Debes iniciar sesión.', 'error');
    setTimeout(() => { window.location.href = '/login'; }, 1500);
    return;
  }

  saveBtn.disabled = true;
  saveText.classList.add('hidden');
  saveSpinner.classList.remove('hidden');

  try {
    const formData = new FormData(form);
    const payload: Record<string, any> = {};
    formData.forEach((value, key) => {
      if (value && value !== '') payload[key] = value;
    });

    // Sincronía mapa → payload: la ubicación sale SIEMPRE del selector de
    // minimapas. Con la selección vacía ("Quitar ubicación") viaja null
    // explícito para desasignar el objeto; si no, los IDs que escribió el mapa.
    const seleccionUbicacion = obtenerSeleccionMinimapa();
    payload['ubicacion'] = seleccionUbicacion.ubicacion;
    payload['contenedor'] = seleccionUbicacion.contenedor;

    const response = await fetch(`${API_BASE_URL}/objetos/${objetoId}/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      showToast('✅ Objeto actualizado correctamente', 'success');
      setTimeout(() => { window.location.href = `/objetos/${objetoId}`; }, 1000);
      return;
    }

    const error = await response.json();
    const errorMsg = error.detail || error.error || Object.values(error).flat().join(', ');
    showToast(`❌ Error: ${errorMsg}`, 'error');
  } catch (err) {
    showToast('❌ Error de conexión.', 'error');
    console.error(err);
  }

  saveBtn.disabled = false;
  saveText.classList.remove('hidden');
  saveSpinner.classList.add('hidden');
}

// =============================================================================
// ARRANQUE
// =============================================================================

/** Arranca la pantalla de edición (una sola vez por carga de página). */
export function iniciarEdicionObjeto(): void {
  objetoId = idObjetoDesdeRuta();

  loadingState = ref('loadingState');
  errorState = ref('errorState');
  errorMessage = ref('errorMessage');
  retryBtn = ref('retryBtn');
  form = ref<HTMLFormElement>('objetoForm');
  saveBtn = ref<HTMLButtonElement>('saveBtn');
  saveText = ref('saveText');
  saveSpinner = ref('saveSpinner');
  editSubtitle = ref('editSubtitle');
  categoriaSelect = ref<HTMLSelectElement>('categoria');
  duenoSelect = ref<HTMLSelectElement>('dueno_original');
  beneficiarioSelect = ref<HTMLSelectElement>('beneficiario');

  retryBtn.addEventListener('click', () => void cargarObjeto());
  form.addEventListener('submit', (e) => void enviarFormulario(e));

  if (!objetoId) {
    errorMessage.textContent = 'ID de objeto no válido.';
    errorState.classList.remove('hidden');
    loadingState.classList.add('hidden');
    return;
  }

  // Bloques independientes (fotos y precio de referencia) + carga del objeto.
  inicializarFotos(objetoId);
  inicializarPrecioReferencia();
  void cargarObjeto();
}
