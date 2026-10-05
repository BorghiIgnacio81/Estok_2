// =============================================================================
// SEGUNDA FOTO PARA LIBROS (/objetos/nuevo) · ISBN de la parte trasera
// -----------------------------------------------------------------------------
// Desmantelado del <script> de pages/objetos/nuevo.astro (regla de
// modularización <400 líneas por archivo). Se separó de objetoAutocompletarIa.ts
// para no superar el límite de 400 líneas y porque es un flujo independiente:
//   · Cuando la IA detecta un LIBRO, muestra la sección #segundaFotoSection y el
//     operador captura la parte trasera para leer el código ISBN.
//   · Envía la imagen a POST /objetos/analizar_imagen/ con es_segunda_foto=true y
//     motor gemini, y vuelca el ISBN detectado en [name="isbn_issn"].
// El spinner «Analizando…» se delega en lib/botonAutocompletarIA.ts.
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../../services/auth';
import { comprimirImagenBase64 } from '../../services/image';
import { liberarAnalizandoIA, marcarAnalizandoIA } from '../botonAutocompletarIA';
import { refOpcional } from '../dom';
import { showToast } from '../toast';
import { inputDeEvento, mensajeError } from './objetoComunes';

/** Inicializa la captura de la segunda foto (ISBN de la parte trasera). */
export function initObjetoIaSegundaFoto(): void {
  const segundaFotoInput = refOpcional<HTMLInputElement>('segundaFotoInput');
  const saltarSegundaFotoBtn = refOpcional<HTMLButtonElement>('saltarSegundaFotoBtn');
  const segundaFotoSection = refOpcional<HTMLElement>('segundaFotoSection');

  segundaFotoInput?.addEventListener('change', async (e) => {
    const file = inputDeEvento(e)?.files?.[0];
    if (!file) return;

    // Progreso en el botón IA (ruedita + "Analizando...") y en el bloque de IA.
    marcarAnalizandoIA();
    const iaProgressContainer = refOpcional<HTMLElement>('iaProgressContainer');
    const iaProgressText = refOpcional<HTMLElement>('iaProgressText');
    const iaProgressSubtext = refOpcional<HTMLElement>('iaProgressSubtext');
    const iaProgressBar = refOpcional<HTMLElement>('iaProgressBar');
    const iaProgressPercent = refOpcional<HTMLElement>('iaProgressPercent');
    iaProgressContainer?.classList.remove('hidden');
    if (iaProgressText) iaProgressText.textContent = '📖 Analizando parte trasera del libro...';
    if (iaProgressSubtext) iaProgressSubtext.textContent = 'Buscando código ISBN...';
    if (iaProgressBar) iaProgressBar.style.width = '10%';
    if (iaProgressPercent) iaProgressPercent.textContent = '10%';
    refOpcional<HTMLElement>('iaStatus')?.classList.add('hidden');

    // AbortController con timeout de 250s para el fetch de segunda foto
    const segundaFotoController = new AbortController();
    const segundaFotoTimeoutId = setTimeout(() => {
      console.warn('[SEGUNDA FOTO] Timeout de 250s alcanzado, abortando fetch');
      segundaFotoController.abort();
    }, 250000);

    try {
      const reader = new FileReader();
      const rawBase64 = await new Promise<string>((resolve) => {
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.readAsDataURL(file);
      });
      // Comprimir igual que la primera foto antes de enviar al backend
      let base64Image: string;
      try {
        base64Image = await comprimirImagenBase64(rawBase64);
      } catch (err) {
        console.warn('Error al comprimir segunda foto, usando original:', err);
        base64Image = rawBase64;
      }

      // LOG: tamaño real de la imagen comprimida
      const imgSizeKB = Math.round((base64Image.length * 0.73) / 1024);
      console.log(`[SEGUNDA FOTO] Tamaño comprimido: ~${imgSizeKB}KB`);

      const response = await fetch(`${API_BASE_URL}/objetos/analizar_imagen/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          imagen_base64: base64Image,
          solo_analisis: true,
          es_segunda_foto: true,
          motor: 'gemini', // <-- Siempre Gemini para la segunda foto (más confiable para ISBN)
        }),
        signal: segundaFotoController.signal,
      });

      clearTimeout(segundaFotoTimeoutId);

      if (iaProgressBar) iaProgressBar.style.width = '100%';
      if (iaProgressPercent) iaProgressPercent.textContent = '100%';

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Error al analizar la segunda foto');
      }

      const result = await response.json();

      // Si se detectó ISBN, actualizar el campo
      if (result.isbn_detectado) {
        const isbnInput = document.querySelector<HTMLInputElement>('[name="isbn_issn"]');
        if (isbnInput) {
          isbnInput.value = result.isbn_detectado;
          showToast(`✅ ISBN detectado: ${result.isbn_detectado}`, 'success');
        }
        segundaFotoSection?.classList.add('hidden');
        if (iaProgressText) iaProgressText.textContent = '✅ ISBN capturado correctamente';
      } else {
        // Si no se detectó ISBN, intentar con los datos generales
        const datos = result.datos_ia || result;
        if (datos.isbn_issn) {
          const isbnInput = document.querySelector<HTMLInputElement>('[name="isbn_issn"]');
          if (isbnInput) {
            isbnInput.value = datos.isbn_issn;
            showToast(`✅ ISBN detectado: ${datos.isbn_issn}`, 'success');
          }
          segundaFotoSection?.classList.add('hidden');
          if (iaProgressText) iaProgressText.textContent = '✅ ISBN capturado correctamente';
        } else {
          if (iaProgressText) iaProgressText.textContent = '⚠️ No se pudo detectar el ISBN. Puedes ingresarlo manualmente.';
          showToast('⚠️ No se detectó ISBN en la parte trasera. Intenta de nuevo o ingrésalo manualmente.', 'warning');
        }
      }
    } catch (err) {
      if (iaProgressBar) iaProgressBar.style.width = '0%';
      if (iaProgressPercent) iaProgressPercent.textContent = 'Error';
      if (iaProgressText) iaProgressText.textContent = '❌ Error al analizar segunda foto';
      if (iaProgressSubtext) iaProgressSubtext.textContent = mensajeError(err);
      showToast(`❌ ${mensajeError(err)}`, 'error');
    } finally {
      setTimeout(() => {
        iaProgressContainer?.classList.add('hidden');
        liberarAnalizandoIA();
      }, 3000);
    }

    if (e.target) (e.target as HTMLInputElement).value = '';
  });

  saltarSegundaFotoBtn?.addEventListener('click', () => {
    segundaFotoSection?.classList.add('hidden');
    showToast('👍 Puedes ingresar el ISBN manualmente en el campo correspondiente.', 'info');
  });
}

