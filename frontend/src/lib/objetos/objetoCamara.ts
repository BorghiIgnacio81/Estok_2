// =============================================================================
// CAPTURA DE FOTOS DEL OBJETO (/objetos/nuevo) · Cámara, galería y drag & drop
// -----------------------------------------------------------------------------
// Desmantelado del <script> de pages/objetos/nuevo.astro (regla de
// modularización <400 líneas por archivo). Responsabilidades:
//   · Cámara y galería nativas (input[type=file] con capture) y, en MÓVIL, el
//     botón «Subir foto del objeto» (#mobileFotoInput), que abre la cámara o la
//     galería del teléfono de forma nativa sin pasar por el drag & drop.
//   · Drag & drop de archivos sobre la zona compacta (#photoPreview).
//   · Compresión en frontend (services/image) + GALERÍA MULTI-FOTO: cada captura
//     se ACUMULA; el visor muestra la última y las miniaturas la galería entera.
//   · Editor de imagen (window.openImageEditor de ImageEditor.astro).
//   · Persistencia de la galería en sessionStorage para sobrevivir a un F5.
// El envío del formulario lee la galería con obtenerFotosObjeto(); el reseteo
// absoluto la vacía con limpiarCamara().
// =============================================================================

import { comprimirImagenBase64 } from '../../services/image';
import { refrescarBotonesIA } from '../botonAutocompletarIA';
import { ref, refOpcional } from '../dom';
import { showToast } from '../toast';
import { CLAVE_FOTOS, CLAVE_FOTO_LEGADA, inputDeEvento } from './objetoComunes';

/** Una captura de la galería: id único + base64 (con prefijo data:image/...). */
export interface FotoCaptura {
  id: string;
  base64: string;
}

// --- Estado del módulo (galería en memoria) ---------------------------------
let fotosArreglo: FotoCaptura[] = [];
let fotoActualId: string | null = null;

// --- Referencias al DOM (se resuelven en initObjetoCamara) -------------------
let cameraInput: HTMLInputElement;
let galleryInput: HTMLInputElement;
let mobileFotoInput: HTMLInputElement | null = null;
let photoPreview: HTMLElement;
let photoPlaceholder: HTMLElement;
let photoImage: HTMLImageElement;
let imagenBase64: HTMLInputElement;
let editPhotoBtn: HTMLButtonElement;
let clearPhotoBtn: HTMLButtonElement;
let fotosThumbnails: HTMLElement | null = null;

/** Identificador único para cada captura de la galería. */
function nuevoIdFoto(): string {
  return `foto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Renderiza la fila horizontal de miniaturas debajo del visor principal. */
function renderFotosThumbnails(): void {
  if (!fotosThumbnails) return;
  fotosThumbnails.innerHTML = '';
  if (fotosArreglo.length === 0) {
    fotosThumbnails.classList.add('hidden');
    fotosThumbnails.classList.remove('flex');
    return;
  }
  fotosThumbnails.classList.remove('hidden');
  fotosThumbnails.classList.add('flex');
  fotosArreglo.forEach((foto) => {
    const cont = document.createElement('div');
    cont.className = 'relative shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden border-2 border-gray-200 hover:border-blue-500 transition-base cursor-pointer group';
    cont.title = 'Ver y editar esta foto';

    const img = document.createElement('img');
    img.src = foto.base64;
    img.alt = 'Miniatura de foto capturada';
    img.className = 'w-full h-full object-cover';
    cont.appendChild(img);

    const btnEliminar = document.createElement('button');
    btnEliminar.type = 'button';
    btnEliminar.className = 'absolute top-0 right-0 w-5 h-5 bg-red-600 text-white text-xs font-bold rounded-bl-lg flex items-center justify-center opacity-80 hover:opacity-100';
    btnEliminar.textContent = '×';
    btnEliminar.title = 'Quitar foto';
    btnEliminar.addEventListener('click', (ev) => {
      ev.stopPropagation();
      eliminarFoto(foto.id);
    });
    cont.appendChild(btnEliminar);

    cont.addEventListener('click', () => seleccionarFoto(foto.id));
    fotosThumbnails!.appendChild(cont);
  });
}

/** Carga una foto de la galería en el visor principal (y abre el editor). */
function seleccionarFoto(id: string, abrirEditor = true): void {
  const foto = fotosArreglo.find((f) => f.id === id);
  if (!foto) return;
  fotoActualId = id;
  photoImage.src = foto.base64;
  photoImage.classList.remove('hidden');
  photoPlaceholder.classList.add('hidden');
  imagenBase64.value = foto.base64;
  editPhotoBtn.classList.remove('hidden');
  clearPhotoBtn.classList.remove('hidden');
  // Hay foto: el botón IA se habilita si el motor está disponible.
  refrescarBotonesIA();
  refOpcional<HTMLElement>('iaStatus')?.classList.add('hidden');
  if (abrirEditor) void openEditor();
}

/** Elimina una foto de la galería y re-renderiza el visor si era la actual. */
function eliminarFoto(id: string): void {
  const indice = fotosArreglo.findIndex((f) => f.id === id);
  if (indice === -1) return;
  fotosArreglo.splice(indice, 1);
  renderFotosThumbnails();
  if (fotoActualId === id) {
    if (fotosArreglo.length > 0) {
      const ultima = fotosArreglo[fotosArreglo.length - 1];
      seleccionarFoto(ultima.id, false);
    } else {
      fotoActualId = null;
      photoImage.src = '';
      photoImage.classList.add('hidden');
      photoPlaceholder.classList.remove('hidden');
      imagenBase64.value = '';
      editPhotoBtn.classList.add('hidden');
      clearPhotoBtn.classList.add('hidden');
      // Se quedó sin fotos: el botón IA vuelve a estado inactivo.
      refrescarBotonesIA();
      refOpcional<HTMLElement>('iaStatus')?.classList.add('hidden');
      try { sessionStorage.removeItem(CLAVE_FOTO_LEGADA); } catch (e) {}
    }
  }
  persistirFotos();
}

/** Persiste la galería en sessionStorage para sobrevivir a refrescos (F5). */
function persistirFotos(): void {
  try {
    sessionStorage.setItem(CLAVE_FOTOS, JSON.stringify(fotosArreglo));
  } catch (e) {
    // Puede fallar si la galería supera la cuota de sessionStorage (~5MB)
    console.warn('No se pudo persistir la galería de fotos en sessionStorage:', e);
  }
}

/** Abre el editor de imagen (window.openImageEditor de ImageEditor.astro). */
async function openEditor(): Promise<void> {
  if (!imagenBase64.value) return;
  // El editor puede cargar después que este módulo: se reintenta una vez.
  let editorFn = (window as any).openImageEditor;
  if (!editorFn) {
    await new Promise((r) => setTimeout(r, 500));
    editorFn = (window as any).openImageEditor;
  }
  if (!editorFn) {
    console.warn('ImageEditor no disponible');
    showToast('⚠️ Editor de imagen no disponible. Intenta de nuevo.', 'warning');
    return;
  }
  const editedImage = await editorFn(imagenBase64.value);
  if (editedImage) {
    // Actualizar la entrada correspondiente de la galería multi-foto
    if (fotoActualId) {
      const fotoGaleria = fotosArreglo.find((f) => f.id === fotoActualId);
      if (fotoGaleria) fotoGaleria.base64 = editedImage;
    }
    imagenBase64.value = editedImage;
    photoImage.src = editedImage;
    renderFotosThumbnails();
    persistirFotos();
    showToast('✅ Imagen editada correctamente', 'success');
  }
}

/** Comprime la imagen elegida y la ACUMULA en la galería multi-foto. */
function handleFileSelected(file: File): void {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const result = (e.target as FileReader).result as string;
    // Comprimir antes de guardar
    let compressed: string;
    try {
      compressed = await comprimirImagenBase64(result);
    } catch (err) {
      console.warn('Error al comprimir imagen, usando original:', err);
      compressed = result;
    }
    // Acumular en la galería multi-foto (NO sobreescribir la anterior)
    const esPrimeraFoto = fotosArreglo.length === 0;
    const nuevaFoto: FotoCaptura = { id: nuevoIdFoto(), base64: compressed };
    fotosArreglo.push(nuevaFoto);
    fotoActualId = nuevaFoto.id;

    photoImage.src = compressed;
    photoImage.classList.remove('hidden');
    photoPlaceholder.classList.add('hidden');
    imagenBase64.value = compressed;
    editPhotoBtn.classList.remove('hidden');
    clearPhotoBtn.classList.remove('hidden');
    // Foto nueva cargada: el botón IA se habilita (si hay motor).
    refrescarBotonesIA();
    refOpcional<HTMLElement>('iaStatus')?.classList.add('hidden');
    renderFotosThumbnails();
    persistirFotos();
    // El editor se abre automáticamente SOLO con la primera foto, para no
    // interrumpir el flujo de captura rápida de varias fotos.
    if (esPrimeraFoto) {
      setTimeout(() => void openEditor(), 300);
    }
  };
  reader.readAsDataURL(file);
}

/** Restaura la galería desde sessionStorage (sobrevive a un refresco). */
function restaurarGaleria(): void {
  // 1) Galería multi-foto
  const fotosGuardadas = sessionStorage.getItem(CLAVE_FOTOS);
  if (fotosGuardadas) {
    try {
      const arrParseado = JSON.parse(fotosGuardadas);
      if (Array.isArray(arrParseado) && arrParseado.length > 0) {
        fotosArreglo = arrParseado.filter(
          (f: any) => f && typeof f.id === 'string' && typeof f.base64 === 'string'
        );
        renderFotosThumbnails();
        const ultima = fotosArreglo[fotosArreglo.length - 1];
        if (ultima) {
          fotoActualId = ultima.id;
          photoImage.src = ultima.base64;
          photoImage.classList.remove('hidden');
          photoPlaceholder.classList.add('hidden');
          imagenBase64.value = ultima.base64;
          editPhotoBtn.classList.remove('hidden');
          clearPhotoBtn.classList.remove('hidden');
          refrescarBotonesIA();
        }
      }
    } catch (e) { /* JSON corrupto: ignorar */ }
    try { sessionStorage.removeItem(CLAVE_FOTOS); } catch (e) {}
  } else {
    // Compatibilidad con el flujo anterior de foto única
    const fotoGuardada = sessionStorage.getItem(CLAVE_FOTO_LEGADA);
    if (fotoGuardada) {
      fotosArreglo = [{ id: nuevoIdFoto(), base64: fotoGuardada }];
      fotoActualId = fotosArreglo[0].id;
      photoImage.src = fotoGuardada;
      photoImage.classList.remove('hidden');
      photoPlaceholder.classList.add('hidden');
      imagenBase64.value = fotoGuardada;
      editPhotoBtn.classList.remove('hidden');
      clearPhotoBtn.classList.remove('hidden');
      refrescarBotonesIA();
      renderFotosThumbnails();
      try { sessionStorage.removeItem(CLAVE_FOTO_LEGADA); } catch (e) {}
    }
  }
}

/**
 * Galería actual del objeto (para el envío multipart del formulario).
 * Devuelve la referencia viva del arreglo del módulo.
 */
export function obtenerFotosObjeto(): FotoCaptura[] {
  return fotosArreglo;
}

/**
 * Vacía el visor y la galería en memoria, apaga el feed de cámara si quedara un
 * stream activo (getUserMedia) y limpia los inputs file. La usa el reseteo
 * absoluto del formulario (objetoFormCore).
 */
export function limpiarCamara(): void {
  fotosArreglo = [];
  fotoActualId = null;

  photoImage.src = '';
  photoImage.classList.add('hidden');
  photoPlaceholder.classList.remove('hidden');
  imagenBase64.value = '';
  editPhotoBtn.classList.add('hidden');
  clearPhotoBtn.classList.add('hidden');
  renderFotosThumbnails();

  // Apagar el feed de la cámara si quedara algún stream activo (getUserMedia)
  const videoCamara = document.querySelector<HTMLVideoElement>(
    'video[data-camera], video#cameraFeed'
  );
  if (videoCamara && (videoCamara as any).srcObject) {
    const stream = (videoCamara as any).srcObject as MediaStream;
    stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    (videoCamara as any).srcObject = null;
  }
  // Limpiar los inputs file de cámara/galería (incluido el botón móvil)
  cameraInput.value = '';
  galleryInput.value = '';
  if (mobileFotoInput) mobileFotoInput.value = '';
}

/** Inicializa la captura: resuelve refs, restaura estado y enlaza listeners. */
export function initObjetoCamara(): void {
  cameraInput = ref<HTMLInputElement>('cameraInput');
  galleryInput = ref<HTMLInputElement>('galleryInput');
  mobileFotoInput = refOpcional<HTMLInputElement>('mobileFotoInput');
  photoPreview = ref<HTMLElement>('photoPreview');
  photoPlaceholder = ref<HTMLElement>('photoPlaceholder');
  photoImage = ref<HTMLImageElement>('photoImage');
  imagenBase64 = ref<HTMLInputElement>('imagenBase64');
  editPhotoBtn = ref<HTMLButtonElement>('editPhotoBtn');
  clearPhotoBtn = ref<HTMLButtonElement>('clearPhotoBtn');
  fotosThumbnails = refOpcional<HTMLElement>('fotosThumbnails');

  // Restaurar la galería guardada antes de enlazar los listeners.
  restaurarGaleria();

  clearPhotoBtn.addEventListener('click', () => {
    if (fotoActualId) {
      eliminarFoto(fotoActualId);
      showToast('🗑️ Foto eliminada', 'info');
    }
  });

  cameraInput.addEventListener('change', (e) => {
    const file = inputDeEvento(e)?.files?.[0];
    if (file) handleFileSelected(file);
    if (e.target) (e.target as HTMLInputElement).value = '';
  });

  galleryInput.addEventListener('change', (e) => {
    const file = inputDeEvento(e)?.files?.[0];
    if (file) handleFileSelected(file);
    if (e.target) (e.target as HTMLInputElement).value = '';
  });

  // MÓVIL: el botón nativo «Subir foto del objeto» alimenta el MISMO flujo de
  // compresión + galería multi-foto (handleFileSelected), sin lógica duplicada.
  mobileFotoInput?.addEventListener('change', (e) => {
    const input = inputDeEvento(e);
    const file = input?.files?.[0];
    if (file) handleFileSelected(file);
    if (input) input.value = '';
  });

  photoPreview.addEventListener('click', () => cameraInput.click());

  const tomarOtraFotoBtn = refOpcional<HTMLButtonElement>('tomarOtraFotoBtn');
  tomarOtraFotoBtn?.addEventListener('click', () => cameraInput.click());

  // DRAG & DROP DE FOTOS sobre la zona compacta (#photoPreview).
  // Reutiliza handleFileSelected(): mismas reglas de compresión, galería
  // multi-foto y persistencia que la cámara y la galería (sin lógica duplicada).
  const resaltarDrop = (activo: boolean) => {
    photoPreview.classList.toggle('border-blue-500', activo);
    photoPreview.classList.toggle('bg-blue-50', activo);
  };
  photoPreview.addEventListener('dragover', (e) => {
    e.preventDefault();
    resaltarDrop(true);
  });
  photoPreview.addEventListener('dragleave', () => resaltarDrop(false));
  photoPreview.addEventListener('drop', (e) => {
    e.preventDefault();
    resaltarDrop(false);

    const archivos = Array.from(e.dataTransfer?.files || []).filter((archivo) =>
      archivo.type.startsWith('image/'),
    );
    if (!archivos.length) {
      showToast('❌ Soltá un archivo de imagen (JPG, PNG o WEBP).', 'error');
      return;
    }

    // Se procesa UNA imagen por drop para respetar el flujo del editor y de la
    // galería multi-foto; el resto se avisa para usar «Otra foto».
    const [primera, ...restantes] = archivos;
    handleFileSelected(primera);
    if (restantes.length) {
      showToast(
        `🖼️ Se agregó 1 foto. Usá «Otra foto» para las ${restantes.length} restantes.`,
        'info',
      );
    }
  });

  editPhotoBtn.addEventListener('click', () => void openEditor());
}



