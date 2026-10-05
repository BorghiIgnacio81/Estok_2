// =============================================================================
// NÚCLEO DEL FORMULARIO (/objetos/nuevo) · Persistencia, reset, envío y éxito
// -----------------------------------------------------------------------------
// Desmantelado del <script> de pages/objetos/nuevo.astro (regla de
// modularización <400 líneas por archivo). Responsabilidades:
//   · Persistencia/restauración del formulario en sessionStorage (sobrevive F5).
//   · Reseteo absoluto tras guardar y ante una restauración de BFCache.
//   · Validación final + ENVÍO multipart a POST /api/objetos/ firmado con
//     getAuthHeaders() (Authorization: Bearer + X-Estok-Id multi-tenant). El
//     dueño externo (no usuario) viaja como texto plano `dueno_externo_nombre`.
//   · Modal de éxito direccional ("Cargar otro" / "Volver al inicio").
// La galería de fotos la gestiona objetoCamara.ts (obtenerFotosObjeto /
// limpiarCamara); acá solo se adjuntan los blobs al FormData.
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../../services/auth';
import { base64ToBlob } from '../../services/image';
import { refrescarBotonesIA } from '../botonAutocompletarIA';
import { ref, refOpcional } from '../dom';
import { showToast } from '../toast';
import { limpiarCamara, obtenerFotosObjeto } from './objetoCamara';
import { CLAVE_FORM, CLAVE_FOTO_LEGADA, CLAVE_FOTOS, mensajeError } from './objetoComunes';

// --- Referencias al DOM (se resuelven en initObjetoFormCore) -----------------
let submitBtn: HTMLButtonElement;
let submitText: HTMLElement;
let submitSpinner: HTMLElement;
let exitoModal: HTMLElement | null = null;

// =============================================================================
// PERSISTENCIA DEL FORMULARIO EN SESSIONSTORAGE (input/change)
// =============================================================================

/** Guarda el estado actual del formulario en sessionStorage (sobrevive a F5). */
function persistirDatosFormulario(): void {
  const form = refOpcional<HTMLFormElement>('objetoForm');
  if (!form) return;
  const fd = new FormData(form);
  const datos: Record<string, string> = {};
  fd.forEach((value, key) => {
    datos[key] = value as string;
  });
  try {
    sessionStorage.setItem(CLAVE_FORM, JSON.stringify(datos));
  } catch (e) {
    // Puede fallar si el objeto es muy grande; no es crítico
  }
}

/** Restaura en el formulario los datos guardados en sessionStorage. */
function restaurarDatosFormulario(): void {
  const datosGuardados = sessionStorage.getItem(CLAVE_FORM);
  if (!datosGuardados) return;
  try {
    const campos = JSON.parse(datosGuardados);
    Object.entries(campos).forEach(([name, value]) => {
      const el = document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      if (el && value !== null && value !== undefined) {
        el.value = String(value);
        // La taxonomía es unificada: el único selector de clasificación es
        // "Categoría". Ya no hay campos por sub-tipo que sincronizar.
      }
    });
  } catch (e) { /* ignorar JSON corrupto */ }
  try { sessionStorage.removeItem(CLAVE_FORM); } catch (e) {}
}

// =============================================================================
// RESETEO ABSOLUTO DEL FORMULARIO
// Vacía todos los inputs, desmarca selectores, apaga el feed de la cámara,
// limpia el visor y vacía la galería en memoria + sessionStorage.
// =============================================================================

function resetFormularioCompleto(): void {
  // 1-3) Galería multi-foto, visor principal, feed de cámara e inputs file.
  //      Todo eso vive en objetoCamara.ts (limpiarCamara).
  limpiarCamara();

  // 4) Vaciar inputs de texto y desmarcar selectores/checkboxes del formulario
  const formulario = refOpcional<HTMLFormElement>('objetoForm');
  if (formulario) {
    formulario.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input[type="date"], textarea').forEach((el) => {
      (el as HTMLInputElement | HTMLTextAreaElement).value = '';
    });
    formulario.querySelectorAll('select').forEach((sel) => {
      const select = sel as HTMLSelectElement;
      if (select.options.length > 0) select.selectedIndex = 0;
    });
    formulario.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((el) => {
      (el as HTMLInputElement).checked = false;
    });
    formulario.querySelectorAll('[aria-invalid="true"], .input-error').forEach((el) => {
      el.removeAttribute('aria-invalid');
      el.classList.remove('input-error');
    });
  }

  // 5) Estado de IA y precio de referencia
  // Sin foto tras el reset: el botón IA vuelve a estado inactivo.
  refrescarBotonesIA();
  refOpcional<HTMLElement>('iaStatus')?.classList.add('hidden');
  refOpcional<HTMLElement>('iaProgressContainer')?.classList.add('hidden');
  const precioRef = refOpcional<HTMLElement>('precioReferencia');
  if (precioRef) {
    precioRef.classList.add('hidden');
    precioRef.innerHTML = '';
  }
  refOpcional<HTMLElement>('segundaFotoSection')?.classList.add('hidden');

  // 6) Botón de envío en estado inicial
  submitBtn.disabled = false;
  submitText.classList.remove('hidden');
  submitSpinner.classList.add('hidden');

  // 7) Limpiar persistencia (foto única + galería + datos del formulario)
  try { sessionStorage.removeItem(CLAVE_FOTO_LEGADA); } catch (e) {}
  try { sessionStorage.removeItem(CLAVE_FORM); } catch (e) {}
  try { sessionStorage.removeItem(CLAVE_FOTOS); } catch (e) {}

  // 8) Subir al tope para empezar la captura siguiente
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =============================================================================
// MODAL DE ÉXITO - Control direccional tras guardar un objeto
// =============================================================================

/** Abre el modal de éxito (detiene el flujo visual tras el 201 Created). */
function abrirModalExito(): void {
  if (exitoModal) exitoModal.classList.remove('hidden');
}

/** Cierra el modal de éxito dejando al operador en la misma pantalla. */
function cerrarModalExito(): void {
  if (exitoModal) exitoModal.classList.add('hidden');
}

// =============================================================================
// ENVÍO DEL FORMULARIO - Guardar objeto + subir fotos (multipart multi-foto)
// =============================================================================

/** Valida y envía el formulario; en éxito resetea y abre el modal de éxito. */
async function enviarFormulario(e: Event): Promise<void> {
  e.preventDefault();
  const formOriginal = new FormData(e.target as HTMLFormElement);

  // Validación final: el nombre es obligatorio. El `required` nativo ya bloquea
  // el envío, pero se refuerza por si el formulario se dispara por código.
  if (!formOriginal.get('nombre')) {
    showToast('El nombre del objeto es obligatorio.', 'error');
    refOpcional<HTMLInputElement>('nombre')?.focus();
    return;
  }

  submitBtn.disabled = true;
  submitText.classList.add('hidden');
  submitSpinner.classList.remove('hidden');

  try {
    // Construir payload multipart del objeto.
    // Taxonomía unificada: NO se envía "tipo". El único selector de clasificación
    // es "categoria" (11 oficiales de Mercado Libre). Se omite todo valor vacío
    // para que DRF no intente parsear "" como UUID/entero en las FK opcionales.
    const formData = new FormData();
    const agregarSi = (clave: string, valor: FormDataEntryValue | null) => {
      if (valor !== null && valor !== undefined && String(valor).trim() !== '') {
        formData.append(clave, String(valor));
      }
    };
    agregarSi('nombre', formOriginal.get('nombre'));
    agregarSi('descripcion', formOriginal.get('descripcion'));
    agregarSi('categoria', formOriginal.get('categoria'));
    agregarSi('estado_conservacion', formOriginal.get('estado_conservacion') || 'bueno');
    agregarSi('color', formOriginal.get('color'));
    agregarSi('valor_estimado', formOriginal.get('valor_estimado'));
    agregarSi('ubicacion', formOriginal.get('ubicacion'));
    agregarSi('contenedor', formOriginal.get('contenedor'));
    agregarSi('dueno_original', formOriginal.get('dueno_original'));
    // Dueño EXTERNO (no usuario de la plataforma): string plano de metadata.
    agregarSi('dueno_externo_nombre', formOriginal.get('dueno_externo_nombre'));
    agregarSi('beneficiario', formOriginal.get('beneficiario'));

    // Adjuntar TODAS las fotos acumuladas bajo la clave 'fotos' (multi-foto).
    for (const foto of obtenerFotosObjeto()) {
      try {
        const blob = base64ToBlob(foto.base64);
        formData.append('fotos', blob, `foto_${foto.id}.jpg`);
      } catch (err) {
        console.warn('No se pudo convertir una foto de la galería a Blob:', err);
      }
    }

    // Crear el objeto + subir fotos en una única petición multipart.
    // NO se fija Content-Type: el navegador agrega el boundary solo.
    const createResponse = await fetch(`${API_BASE_URL}/objetos/`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData,
    });

    if (!createResponse.ok) {
      let errorMsg = 'Error al crear el objeto';
      try {
        const errData = await createResponse.json();
        errorMsg = errData.detail || errData.error || JSON.stringify(errData);
      } catch {
        try {
          errorMsg = await createResponse.text();
        } catch {}
      }
      throw new Error(errorMsg);
    }

    // Éxito (201 Created): RESETEO ABSOLUTO del formulario + apertura del modal
    // de confirmación. El flujo visual se detiene: el operador decide
    // direccionalmente entre "Cargar otro" o "Volver al inicio".
    resetFormularioCompleto();
    abrirModalExito();
  } catch (err) {
    showToast(`❌ ${mensajeError(err)}`, 'error');
    submitBtn.disabled = false;
    submitText.classList.remove('hidden');
    submitSpinner.classList.add('hidden');
  }
}

// =============================================================================
// INICIALIZACIÓN
// =============================================================================

/** Inicializa persistencia, BFCache, modal de éxito y envío del formulario. */
export function initObjetoFormCore(): void {
  submitBtn = ref<HTMLButtonElement>('submitBtn');
  submitText = ref<HTMLElement>('submitText');
  submitSpinner = ref<HTMLElement>('submitSpinner');
  exitoModal = refOpcional<HTMLElement>('exitoModal');

  // Restaurar los datos guardados antes de enlazar la persistencia.
  restaurarDatosFormulario();

  const objetoForm = refOpcional<HTMLFormElement>('objetoForm');
  if (objetoForm) {
    objetoForm.addEventListener('input', () => persistirDatosFormulario());
    objetoForm.addEventListener('change', () => persistirDatosFormulario());
    objetoForm.addEventListener('submit', (e) => void enviarFormulario(e));
  }

  // BFCACHE: cuando el navegador restaura la página desde caché (botón Atrás) el
  // DOM conserva el estado aunque sessionStorage ya se haya limpiado; se resetea
  // para no mostrar estado viejo.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      resetFormularioCompleto();
    }
  });

  // "Cargar otro": solo oculta el modal. resetFormularioCompleto() ya vació los
  // campos tras el guardado, así que el formulario queda listo para una nueva
  // carga inmediata sin recargar la página.
  refOpcional<HTMLButtonElement>('cargarOtroBtn')?.addEventListener('click', cerrarModalExito);

  // "Volver al inicio": redirección directa al Dashboard principal.
  refOpcional<HTMLButtonElement>('volverInicioBtn')?.addEventListener('click', () => {
    window.location.href = '/';
  });

  // Exponer el reseteo absoluto para uso externo (ej: cabecera superior) y debug
  (window as any).resetFormularioCompleto = resetFormularioCompleto;
}



