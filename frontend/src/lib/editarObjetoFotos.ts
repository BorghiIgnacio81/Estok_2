// =============================================================================
// EDICIÓN DE OBJETO · FOTOS (comportamiento de la página de edición)
// -----------------------------------------------------------------------------
// Encapsula TODO lo relativo a las fotos del objeto editado:
//   · grilla de fotos existentes (★ marcar principal / 🗑️ eliminar),
//   · carga desde la API (/objetos/<id>/),
//   · subida con EDICIÓN SECUENCIAL: cada foto pasa primero por el ImageEditor
//     (window.openImageEditor) y recién después se sube ya comprimida.
//
// Vive fuera de pages/objetos/[id]/editar/index.astro por la regla de
// modularización (<400 líneas por archivo de UI): la página solo llama a
// inicializarFotos(objetoId) y, al recargar el objeto, a cargarFotos().
// Auth centralizada: los headers salen SIEMPRE de services/auth.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { comprimirImagenBase64 } from '../services/image';
import { ref } from './dom';
import { showToast } from './toast';

/** Foto del objeto tal como la devuelve la API. */
interface Foto {
  id: string;
  imagen: string;
  descripcion?: string | null;
  es_principal?: boolean;
}

// --- Estado del módulo -------------------------------------------------------
let objetoId = '';
let fotosExistentes: HTMLElement;
let fotosEmpty: HTMLElement;
let fotoInput: HTMLInputElement;
let subirFotosBtn: HTMLButtonElement;
let subirFotosText: HTMLElement;
let subirFotosSpinner: HTMLElement;
let subirFotosProgress: HTMLElement;

/** Fotos vigentes del objeto (cache de la última carga). */
let fotosActuales: Foto[] = [];
/** Cola de fotos pendientes de editar antes de subir. */
let colaEdicion: { file: File; dataUrl: string }[] = [];
let editandoCola = false;

// =============================================================================
// CARGA Y GRILLA DE FOTOS
// =============================================================================

/** Recarga la grilla de fotos desde la API (silenciosa: no bloquea la edición). */
export async function cargarFotos(): Promise<void> {
  if (!objetoId || !fotosExistentes) return;
  try {
    const res = await fetch(`${API_BASE_URL}/objetos/${objetoId}/`, {
      headers: getAuthHeaders(),
    });
    if (res.ok) {
      const obj = await res.json();
      renderFotos(obj.fotos || []);
    }
  } catch {
    // Silencioso - no bloquear la edición
  }
}

/** Pinta la grilla de fotos existentes (o el estado vacío). */
function renderFotos(fotos: Foto[]): void {
  fotosActuales = fotos;
  fotosExistentes.innerHTML = '';

  if (!fotos.length) {
    fotosExistentes.classList.add('hidden');
    fotosEmpty.classList.remove('hidden');
    return;
  }
  fotosExistentes.classList.remove('hidden');
  fotosEmpty.classList.add('hidden');

  // Una sola inserción al DOM por render (sin reflow por cada foto).
  const fragmento = document.createDocumentFragment();
  fotos.forEach((foto) => fragmento.appendChild(tarjetaFoto(foto)));
  fotosExistentes.appendChild(fragmento);
}

/** Tarjeta de una foto con su overlay de acciones (★ principal / 🗑️ eliminar). */
function tarjetaFoto(foto: Foto): HTMLElement {
  const card = document.createElement('div');
  card.className = 'relative group bg-gray-50 rounded-lg overflow-hidden border border-gray-200';

  const img = document.createElement('img');
  img.src = foto.imagen;
  img.alt = foto.descripcion || 'Foto';
  img.className = 'w-full aspect-square object-cover';
  card.appendChild(img);

  // Badge "Principal"
  if (foto.es_principal) {
    const badge = document.createElement('div');
    badge.className =
      'absolute top-1 left-1 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded';
    badge.textContent = '★ PRINCIPAL';
    card.appendChild(badge);
  }

  // Overlay de acciones al hover
  const overlay = document.createElement('div');
  overlay.className =
    'absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2';
  if (!foto.es_principal) overlay.appendChild(botonPrincipal(foto));
  overlay.appendChild(botonEliminar(foto));

  card.appendChild(overlay);
  return card;
}

/** Botón «★ Hacer principal» de una foto (PATCH /fotos/<id>/). */
function botonPrincipal(foto: Foto): HTMLButtonElement {
  const etiqueta = '★ Hacer principal';
  const boton = document.createElement('button');
  boton.className =
    'w-full px-2 py-1.5 text-xs font-medium bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-base';
  boton.textContent = etiqueta;

  boton.addEventListener('click', async () => {
    boton.disabled = true;
    boton.textContent = '...';
    try {
      const res = await fetch(`${API_BASE_URL}/fotos/${foto.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ es_principal: true }),
      });
      if (res.ok) {
        showToast('✅ Foto marcada como principal', 'success');
        await cargarFotos();
        return;
      }
      const err = await res.json().catch(() => ({}));
      showToast(`❌ Error: ${err.detail || 'No se pudo actualizar'}`, 'error');
    } catch {
      showToast('❌ Error de conexión', 'error');
    }
    boton.disabled = false;
    boton.textContent = etiqueta;
  });

  return boton;
}

/** Botón «🗑️ Eliminar» de una foto (DELETE /fotos/<id>/). */
function botonEliminar(foto: Foto): HTMLButtonElement {
  const etiqueta = '🗑️ Eliminar';
  const boton = document.createElement('button');
  boton.className =
    'w-full px-2 py-1.5 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 transition-base';
  boton.textContent = etiqueta;

  boton.addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta foto definitivamente?')) return;
    boton.disabled = true;
    boton.textContent = '...';
    try {
      const res = await fetch(`${API_BASE_URL}/fotos/${foto.id}/`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok || res.status === 204) {
        showToast('✅ Foto eliminada', 'success');
        await cargarFotos();
        return;
      }
      const err = await res.json().catch(() => ({}));
      showToast(`❌ Error: ${err.detail || 'No se pudo eliminar'}`, 'error');
    } catch {
      showToast('❌ Error de conexión', 'error');
    }
    boton.disabled = false;
    boton.textContent = etiqueta;
  });

  return boton;
}

// =============================================================================
// SUBIDA DE FOTO(S) CON EDICIÓN SECUENCIAL
// El usuario selecciona varias fotos y se van editando una por una en el
// ImageEditor antes de subirlas (Opción D del diseño original).
// =============================================================================

/** Convierte un File a dataURL (entrada del ImageEditor). */
function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Convierte un dataURL base64 a Blob (cuerpo del multipart de subida). */
function base64ToBlob(base64: string, mimeType = 'image/jpeg'): Blob {
  const byteChars = atob(base64.split(',')[1]);
  const byteArrays: BlobPart[] = [];
  for (let offset = 0; offset < byteChars.length; offset += 512) {
    const slice = byteChars.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  return new Blob(byteArrays, { type: mimeType });
}

/** Sube UNA foto ya editada (base64), comprimida antes de salir a la red. */
async function subirFotoEditada(base64: string, index: number, esPrimera: boolean): Promise<boolean> {
  try {
    // Comprimir la imagen antes de subirla (max 1024px, calidad 0.7)
    const comprimida = await comprimirImagenBase64(base64, 1024, 0.7);
    const blob = base64ToBlob(comprimida);
    const formData = new FormData();
    formData.append('imagen', blob, `foto_${Date.now()}.jpg`);
    formData.append('es_principal', esPrimera && fotosActuales.length === 0 ? 'true' : 'false');
    formData.append('descripcion', `Foto ${index + 1}`);

    const res = await fetch(`${API_BASE_URL}/objetos/${objetoId}/subir_foto/`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Reporta el resultado final de la subida (mismos mensajes del diseño original). */
function reportarResultado(subidas: number, errores: number): void {
  if (errores === 0 && subidas > 0) {
    subirFotosProgress.textContent = `✅ ${subidas} foto(s) subida(s) correctamente`;
    subirFotosProgress.className = 'mt-2 text-sm text-green-600';
    showToast(`✅ ${subidas} foto(s) subida(s)`, 'success');
  } else if (subidas > 0) {
    subirFotosProgress.textContent = `⚠️ ${subidas} subida(s), ${errores} error(es)`;
    subirFotosProgress.className = 'mt-2 text-sm text-amber-600';
    showToast(`⚠️ ${subidas} subida(s), ${errores} error(es)`, 'error');
  } else if (subidas === 0 && errores === 0) {
    subirFotosProgress.textContent = 'ℹ️ No se subieron fotos';
    subirFotosProgress.className = 'mt-2 text-sm text-gray-500';
  } else {
    subirFotosProgress.textContent = '❌ Error al subir las fotos';
    subirFotosProgress.className = 'mt-2 text-sm text-red-600';
    showToast('❌ Error al subir fotos', 'error');
  }
}

/** Procesa la cola: abre el editor por cada foto y sube las confirmadas. */
async function procesarColaEdicion(): Promise<void> {
  if (editandoCola || colaEdicion.length === 0) return;
  editandoCola = true;

  subirFotosBtn.disabled = true;
  subirFotosText.classList.add('hidden');
  subirFotosSpinner.classList.remove('hidden');
  subirFotosProgress.classList.remove('hidden');

  let subidas = 0;
  let errores = 0;
  const total = colaEdicion.length;

  for (let i = 0; i < total; i++) {
    const item = colaEdicion[i];
    subirFotosProgress.textContent = `Editando foto ${i + 1} de ${total}...`;

    // El editor lo expone ImageEditor.astro: espera corta si aún no cargó.
    let editorFn = (window as any).openImageEditor;
    if (!editorFn) {
      await new Promise((r) => setTimeout(r, 500));
      editorFn = (window as any).openImageEditor;
    }
    if (!editorFn) {
      showToast('⚠️ Editor de imagen no disponible', 'error');
      errores++;
      continue;
    }

    const editedImage = await editorFn(item.dataUrl);
    if (editedImage) {
      subirFotosProgress.textContent = `Subiendo foto ${i + 1} de ${total}...`;
      if (await subirFotoEditada(editedImage, i, i === 0)) subidas++;
      else errores++;
    } else {
      // Usuario canceló la edición de esta foto — no la subimos
      subirFotosProgress.textContent = `Foto ${i + 1} omitida (edición cancelada)`;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Limpiar cola y resetear el input
  colaEdicion = [];
  editandoCola = false;
  fotoInput.value = '';
  subirFotosBtn.disabled = true;
  subirFotosSpinner.classList.add('hidden');
  subirFotosText.classList.remove('hidden');

  reportarResultado(subidas, errores);

  // Recargar fotos
  await cargarFotos();

  setTimeout(() => {
    subirFotosProgress.classList.add('hidden');
  }, 5000);
}

// =============================================================================
// EVENTOS Y ARRANQUE
// =============================================================================

/** Carga a la cola los archivos elegidos y arranca la edición secuencial. */
async function alSeleccionarArchivos(): Promise<void> {
  const files = fotoInput.files;
  if (!files || files.length === 0) return;

  // Deshabilitar el botón mientras se prepara la cola
  subirFotosBtn.disabled = true;
  subirFotosProgress.classList.remove('hidden');
  subirFotosProgress.textContent = `Preparando ${files.length} foto(s)...`;

  for (let i = 0; i < files.length; i++) {
    try {
      const dataUrl = await fileToDataURL(files[i]);
      colaEdicion.push({ file: files[i], dataUrl });
    } catch {
      console.warn(`Error leyendo archivo ${i + 1}`);
    }
  }

  if (colaEdicion.length > 0) {
    // Procesar la cola inmediatamente
    await procesarColaEdicion();
  } else {
    subirFotosProgress.classList.add('hidden');
  }
}

/** Arranca el módulo de fotos: resuelve refs del DOM y vincula los eventos. */
export function inicializarFotos(id: string): void {
  objetoId = id;
  fotosExistentes = ref('fotosExistentes');
  fotosEmpty = ref('fotosEmpty');
  fotoInput = ref<HTMLInputElement>('fotoInput');
  subirFotosBtn = ref<HTMLButtonElement>('subirFotosBtn');
  subirFotosText = ref('subirFotosText');
  subirFotosSpinner = ref('subirFotosSpinner');
  subirFotosProgress = ref('subirFotosProgress');

  fotoInput.addEventListener('change', alSeleccionarArchivos);

  // El botón «Subir foto(s)» inicia/reanuda la edición de la cola; si no hay
  // cola, abre el selector de archivos (mismo comportamiento original).
  subirFotosBtn.addEventListener('click', async () => {
    if (colaEdicion.length > 0) await procesarColaEdicion();
    else fotoInput.click();
  });
}
