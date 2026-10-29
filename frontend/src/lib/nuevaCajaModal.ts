// =============================================================================
// MODAL «+ NUEVA CAJA / CONTENEDOR» · Alta simplificada en /almacenamiento
// -----------------------------------------------------------------------------
// Formulario dedicado a contenedores físicos: Nombre, Foto (opcional),
// Dimensiones (Largo × Ancho × Alto), Descripción y Ubicación/Espacio.
// OMITE DELIBERADAMENTE el «Valor Estimado»: una caja no es un ítem de stock,
// es un espacio que aloja objetos.
//
// Reglas del proyecto respetadas:
//   · Auth centralizada: getAuthHeaders()/enviarFormData() desde services/auth
//     (JWT + X-Estok-Id + CSRF incluidos; NUNCA se define una versión propia).
//   · POST /api/contenedores/ multipart (mismo endpoint que el modal técnico).
//   · Reset absoluto del formulario CADA VEZ que se abre el modal.
//   · Tras el alta se emite `estok:espacios-cambiados` para que el tablero, la
//     canasta y los visores se refresquen sin F5.
//
// El markup vive en components/NuevaCajaModal.astro.
// =============================================================================

import { API_BASE_URL, enviarFormData, getAuthHeaders } from '../services/auth';
import { showToast } from './toast';

/** Opción mínima del selector de espacios (GET /api/ubicaciones/). */
interface UbicacionOpcion {
  id: string;
  nombre: string;
  es_espacio_virtual?: boolean;
}

/** Foto elegida para esta alta (se limpia en cada apertura/cierre). */
let fotoSeleccionada: File | null = null;
/** ObjectURL de la vista previa (se revoca para no filtrar memoria). */
let previewUrl: string | null = null;
/** Evita enlazar dos veces los listeners si el arranque se repite. */
let iniciado = false;

function ref<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

// =============================================================================
// ESTADO VISUAL DEL MODAL
// =============================================================================

function mostrarError(mensaje: string | null): void {
  const error = ref<HTMLElement>('nuevaCajaError');
  if (!error) return;
  if (mensaje) {
    error.textContent = mensaje;
    error.classList.remove('hidden');
  } else {
    error.textContent = '';
    error.classList.add('hidden');
  }
}

function setGuardando(guardando: boolean): void {
  const btn = ref<HTMLButtonElement>('nuevaCajaSaveBtn');
  const texto = ref<HTMLElement>('nuevaCajaSaveText');
  const spinner = ref<HTMLElement>('nuevaCajaSaveSpinner');
  if (btn) btn.disabled = guardando;
  texto?.classList.toggle('hidden', guardando);
  spinner?.classList.toggle('hidden', !guardando);
}

/** Revoca la vista previa y descarta el archivo elegido. */
function limpiarFoto(): void {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  fotoSeleccionada = null;
  const input = ref<HTMLInputElement>('nuevaCajaFoto');
  if (input) input.value = '';
  const label = ref<HTMLElement>('nuevaCajaFotoLabel');
  if (label) label.textContent = 'Sin foto seleccionada';
  const preview = ref<HTMLElement>('nuevaCajaFotoPreview');
  const img = ref<HTMLImageElement>('nuevaCajaFotoPreviewImg');
  if (img) img.removeAttribute('src');
  preview?.classList.add('hidden');
}

/** Reset completo del estado local y del formulario (sin tocar la red). */
function resetModal(): void {
  ref<HTMLFormElement>('nuevaCajaForm')?.reset();
  limpiarFoto();
  mostrarError(null);
  setGuardando(false);
}

// =============================================================================
// UBICACIONES / ESPACIOS
// =============================================================================

function opcionVacia(texto: string): HTMLOptionElement {
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = texto;
  return opt;
}

async function cargarUbicaciones(): Promise<void> {
  const select = ref<HTMLSelectElement>('nuevaCajaUbicacion');
  if (!select) return;
  select.innerHTML = '';
  select.appendChild(opcionVacia('Cargando espacios…'));

  try {
    const res = await fetch(`${API_BASE_URL}/ubicaciones/?page_size=1000`, {
      headers: getAuthHeaders(),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) throw new Error('No se pudieron cargar los espacios.');
    const data = await res.json();
    const lista = ((data.results || data || []) as UbicacionOpcion[])
      // El limbo de mudanza («En Tránsito») NO es un espacio físico elegible.
      .filter((u) => u && !u.es_espacio_virtual)
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));

    select.innerHTML = '';
    if (!lista.length) {
      select.appendChild(opcionVacia('Sin espacios disponibles'));
      mostrarError(
        'Todavía no hay habitaciones o espacios. Creá uno en el mapa antes de registrar una caja.',
      );
      return;
    }
    select.appendChild(opcionVacia('Elegí un espacio / habitación…'));
    for (const u of lista) {
      const opt = document.createElement('option');
      opt.value = String(u.id);
      opt.textContent = u.nombre;
      select.appendChild(opt);
    }
  } catch {
    select.innerHTML = '';
    select.appendChild(opcionVacia('No se pudieron cargar los espacios'));
    mostrarError('No se pudieron cargar los espacios. Cerrá el modal e intentá de nuevo.');
  }
}

// =============================================================================
// APERTURA / CIERRE
// =============================================================================

/**
 * Abre el modal SIEMPRE con el formulario limpio: reset completo + recarga de
 * espacios en caliente. Es el mismo contrato de «Nuevo Objeto».
 */
export function abrirModalNuevaCaja(): void {
  const modal = ref<HTMLElement>('modalNuevaCaja');
  if (!modal) return;
  resetModal();
  modal.classList.remove('hidden');
  void cargarUbicaciones();
  // preventScroll: abrir el modal no debe desplazar el viewport en iOS.
  ref<HTMLInputElement>('nuevaCajaNombre')?.focus({ preventScroll: true });
}

export function cerrarModalNuevaCaja(): void {
  ref<HTMLElement>('modalNuevaCaja')?.classList.add('hidden');
  // Al cerrar se descarta cualquier archivo elegido: la próxima apertura es limpia.
  limpiarFoto();
  mostrarError(null);
}


// =============================================================================
// ENVÍO
// =============================================================================

/** Texto legible de un error de DRF (detail / campos / texto plano). */
function mensajeDeError(err: unknown): string {
  if (!err) return 'Error desconocido.';
  if (typeof err === 'string') return err;
  const datos = err as Record<string, unknown>;
  if (datos.detail) return String(datos.detail);
  if (datos.error) return String(datos.error);
  if (datos.non_field_errors) {
    const valor = datos.non_field_errors;
    return String(Array.isArray(valor) ? valor[0] : valor);
  }
  const claves = Object.keys(datos);
  if (!claves.length) return 'Error desconocido.';
  return claves
    .map((clave) => {
      const valor = datos[clave];
      return `${clave}: ${String(Array.isArray(valor) ? valor[0] : valor)}`;
    })
    .join(', ');
}

async function enviarFormulario(e: Event): Promise<void> {
  e.preventDefault();
  mostrarError(null);

  const nombre = ref<HTMLInputElement>('nuevaCajaNombre')?.value.trim() ?? '';
  const ubicacion = ref<HTMLSelectElement>('nuevaCajaUbicacion')?.value ?? '';
  if (!nombre) {
    mostrarError('El nombre de la caja es obligatorio.');
    ref<HTMLInputElement>('nuevaCajaNombre')?.focus();
    return;
  }
  if (!ubicacion) {
    mostrarError('Elegí la ubicación / espacio donde estará la caja.');
    ref<HTMLSelectElement>('nuevaCajaUbicacion')?.focus();
    return;
  }

  const formData = new FormData();
  formData.append('nombre', nombre);
  formData.append('descripcion', ref<HTMLTextAreaElement>('nuevaCajaDescripcion')?.value.trim() ?? '');
  formData.append('ubicacion', ubicacion);
  // Taxonomía física: caja móvil de inventario, mudable y sin «Valor Estimado».
  formData.append('tipo', 'CAJA');
  formData.append('es_inmueble', 'false');
  formData.append('declarado_movible', 'true');
  const largo = ref<HTMLInputElement>('nuevaCajaLargo')?.value ?? '';
  const ancho = ref<HTMLInputElement>('nuevaCajaAncho')?.value ?? '';
  const alto = ref<HTMLInputElement>('nuevaCajaAlto')?.value ?? '';
  if (largo) formData.append('largo', largo);
  if (ancho) formData.append('ancho', ancho);
  if (alto) formData.append('alto', alto);
  if (fotoSeleccionada) formData.append('foto', fotoSeleccionada);

  setGuardando(true);
  try {
    const res = await enviarFormData('/contenedores/', formData);
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      mostrarError(mensajeDeError(err));
      return;
    }

    const creada = await res.json().catch(() => null);
    showToast(`✅ Caja «${nombre}» creada.`, 'success');
    cerrarModalNuevaCaja();
    resetModal();
    // Latido global: tablero de Almacenamiento, canasta y visores se repintan.
    window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
    window.dispatchEvent(new CustomEvent('estok:objetos-cambiados', { detail: creada }));
  } catch {
    mostrarError('Error de conexión al crear la caja. Intentá de nuevo.');
  } finally {
    setGuardando(false);
  }
}

// =============================================================================
// INICIALIZACIÓN
// =============================================================================

/** Enlaza el botón «+ Nueva Caja / Contenedor», el modal y sus atajos. */
export function initNuevaCajaModal(): void {
  if (iniciado) return;
  const modal = ref<HTMLElement>('modalNuevaCaja');
  if (!modal) return;
  iniciado = true;

  ref<HTMLButtonElement>('nuevaCajaContenedorBtn')?.addEventListener('click', abrirModalNuevaCaja);

  modal.querySelectorAll<HTMLElement>('[data-cerrar-nueva-caja]').forEach((btn) => {
    btn.addEventListener('click', cerrarModalNuevaCaja);
  });

  // Clic en el fondo oscuro = cerrar (mismo patrón que el modal técnico).
  modal.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModalNuevaCaja();
  });

  // Escape = cerrar, sin bloquear el resto de atajos de la página.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) cerrarModalNuevaCaja();
  });

  ref<HTMLFormElement>('nuevaCajaForm')?.addEventListener('submit', (e) => void enviarFormulario(e));

  // FOTO: vista previa local (sin subir nada hasta el submit).
  ref<HTMLInputElement>('nuevaCajaFoto')?.addEventListener('change', (e) => {
    const archivo = (e.target as HTMLInputElement).files?.[0] ?? null;
    limpiarFoto();
    if (!archivo) return;
    fotoSeleccionada = archivo;
    const label = ref<HTMLElement>('nuevaCajaFotoLabel');
    if (label) label.textContent = archivo.name;
    const preview = ref<HTMLElement>('nuevaCajaFotoPreview');
    const img = ref<HTMLImageElement>('nuevaCajaFotoPreviewImg');
    if (preview && img) {
      previewUrl = URL.createObjectURL(archivo);
      img.src = previewUrl;
      preview.classList.remove('hidden');
    }
  });
}
