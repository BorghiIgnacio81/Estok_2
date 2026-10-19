// =============================================================================
// AUTOCOMPLETAR CON IA (Google Gemini) · /objetos/nuevo
// -----------------------------------------------------------------------------
// Desmantelado del <script> de pages/objetos/nuevo.astro (regla de
// modularización <400 líneas por archivo). Responsabilidades:
//   · Handler del ÚNICO botón «Autocompletar con IA» (botonera de Fotos del
//     Objeto): muestra el progreso indeterminado y el spinner «Analizando…»
//     (delegado en lib/botonAutocompletarIA.ts).
//   · Llamada a POST /objetos/analizar_imagen/ (proxy del backend, que usa
//     GEMINI_API_KEY en el servidor) y MAPEO DEFENSIVO multi-key de los campos
//     devueltos hacia el formulario (lib/objetos/objetoIaCampos.ts).
// El botón NO depende de ningún health-check/heartbeat: se habilita con solo
// tener una foto cargada. Si la API en la nube falla, se avisa por toast y el
// usuario puede seguir completando el formulario a mano.
// El estado visual del botón (disabled / texto / spinner) NO se toca a mano: lo
// gobierna lib/botonAutocompletarIA.ts. La segunda foto para libros (ISBN) vive
// en objetoIaSegundaFoto.ts.
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../../services/auth';
import {
  liberarAnalizandoIA,
  marcarAnalizandoIA,
  refrescarBotonesIA,
  vincularBotonesIA,
} from '../botonAutocompletarIA';
import { ref, refOpcional } from '../dom';
import { showToast } from '../toast';
import { ID_INPUT_FOTO } from './objetoComunes';
import {
  aplicarCamposIa,
  listarCamposCompletados,
  resumenCamposCompletados,
} from './objetoIaCampos';

// --- Referencias al DOM (se resuelven en initObjetoAutocompletarIa) ----------
let iaStatus: HTMLElement;
let iaProgressContainer: HTMLElement;
let iaProgressText: HTMLElement;
let iaProgressSubtext: HTMLElement;


/**
 * Muestra en #iaStatus el resumen del análisis (éxito total / parcial / nulo),
 * la sección de segunda foto si la IA detectó un libro y el ISBN si vino.
 */
function reportarResultadoIa(datos: any, result: any): void {
  // Mostrar campos pendientes - MENSAJE ÚNICO, no contradictorio
  const camposPendientes: any[] = result.campos_pendientes || datos.campos_pendientes || [];
  const etiquetasCompletadas = listarCamposCompletados(datos);

  if (camposPendientes.length === 0 && etiquetasCompletadas.length > 0) {
    // Éxito total: la IA completó los campos y no quedó nada pendiente
    iaStatus.className = 'mt-3 text-sm text-green-600';
    iaStatus.textContent = `✅ La IA completó: ${etiquetasCompletadas.join(', ')}. Revisá los datos y guardá el objeto.`;
    showToast(`🤖 Campos completados: ${resumenCamposCompletados(datos)}.`, 'success');
  } else if (etiquetasCompletadas.length > 0) {
    // Éxito parcial: algunos campos se autocompletaron, otros no
    iaStatus.className = 'mt-3 text-sm text-amber-600';
    iaStatus.innerHTML = `⚠️ Se autocompletaron: <strong>${etiquetasCompletadas.join(', ')}</strong>. Quedaron pendientes: <strong>${camposPendientes.join(', ')}</strong>. Revisalos manualmente.`;
    showToast(`🤖 Campos completados: ${resumenCamposCompletados(datos)}. Revisá los pendientes.`, 'info');
  } else {
    // No se autocompletó nada
    iaStatus.className = 'mt-3 text-sm text-red-600';
    iaStatus.textContent = '❌ La IA no pudo determinar ningún campo. Revisá la foto e intentá de nuevo.';
    showToast('❌ La IA no pudo autocompletar ningún campo. Podés completarlos manualmente.', 'error');
  }
  iaStatus.classList.remove('hidden');

  // Verificar si la IA detectó que es un libro y necesita segunda foto
  if (result.necesita_segunda_foto) {
    const segundaFotoSection = refOpcional<HTMLElement>('segundaFotoSection');
    const segundaFotoMotivo = refOpcional<HTMLElement>('segundaFotoMotivo');
    if (segundaFotoSection && segundaFotoMotivo) {
      segundaFotoMotivo.textContent = result.motivo_segunda_foto || 'Toma una foto de la parte trasera para capturar el código ISBN.';
      segundaFotoSection.classList.remove('hidden');
      showToast('📖 Libro detectado. Toma una foto de la parte trasera para obtener el ISBN.', 'info');
    }
  }

  // Si es la segunda foto y se detectó ISBN, mostrarlo
  if (result.isbn_detectado) {
    const isbnInput = document.querySelector<HTMLInputElement>('[name="isbn_issn"]');
    if (isbnInput) {
      isbnInput.value = result.isbn_detectado;
      showToast(`✅ ISBN detectado: ${result.isbn_detectado}`, 'success');
    }
    // Ocultar la sección de segunda foto
    refOpcional<HTMLElement>('segundaFotoSection')?.classList.add('hidden');
  }
}

/** Handler del clic en el botón «Autocompletar con IA». */
async function analizarConIa(): Promise<void> {
  // Todo el handler envuelto en try/catch desde la primera línea para evitar
  // errores silenciosos antes del fetch.
  try {
    console.log('[IA] Click en Analizar IA detectado');

    // Guard clauses: verificar que los elementos del DOM existan
    const imagenInput = refOpcional<HTMLInputElement>(ID_INPUT_FOTO);
    if (!imagenInput) { console.error('[IA] elemento imagenBase64 no encontrado en el DOM'); return; }
    if (!iaProgressContainer) { console.error('[IA] iaProgressContainer no encontrado en el DOM'); return; }
    if (!iaProgressText) { console.error('[IA] iaProgressText no encontrado en el DOM'); return; }
    if (!iaProgressSubtext) { console.error('[IA] iaProgressSubtext no encontrado en el DOM'); return; }
    if (!iaStatus) { console.error('[IA] iaStatus no encontrado en el DOM'); return; }

    // Validar que haya foto cargada
    const base64Image = imagenInput.value;
    if (!base64Image) {
      showToast('❌ Primero toma o selecciona una foto.', 'error');
      return;
    }

    // No hay guard previo de "IA disponible": la única condición para analizar
    // es tener una foto. Si Gemini falla, el catch informa con un toast y el
    // formulario sigue editable a mano.

    // Mostrar progreso (indicador indeterminado - sin porcentaje falso).
    // `marcarAnalizandoIA` pasa el botón a ruedita + "Analizando...".
    marcarAnalizandoIA();
    iaProgressContainer.classList.remove('hidden');
    iaProgressText.textContent = '🤖 Analizando con Gemini...';
    iaProgressSubtext.textContent = '☁️ Procesando la imagen en la nube (Google Gemini)';
    iaStatus.classList.add('hidden');

    // AbortController con timeout de 250s (mayor que Gunicorn 240s y Nginx 200s)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn('[IA] Timeout de 250s alcanzado, abortando fetch');
      controller.abort();
    }, 250000);

    // Mensajes de expectativa para el usuario mientras espera
    setTimeout(() => {
      iaProgressText.textContent = '⏳ La IA está procesando... esto puede tomar hasta 3 minutos.';
      iaProgressSubtext.textContent = 'No cierres la página, el análisis sigue en curso.';
    }, 30000);
    setTimeout(() => {
      iaProgressText.textContent = '⏳ Sigo procesando... gracias por esperar.';
      iaProgressSubtext.textContent = 'Si no responde en 2 minutos más, se cancelará automáticamente.';
    }, 90000);

    console.log('[IA] Enviando fetch a analizar_imagen con timeout de 250s');
    const response = await fetch(`${API_BASE_URL}/objetos/analizar_imagen/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        imagen_base64: base64Image,
        solo_analisis: true,
        motor: 'gemini',
      }),
      signal: controller.signal,
    });

    console.log('[IA] Fetch completado, status:', response.status);
    clearTimeout(timeoutId);
    iaProgressText.textContent = '✅ Análisis completado';

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Error al analizar con IA');
    }

    const result = await response.json();
    const datos = result.datos_ia || result;

    // AUDITORÍA: estructura exacta del payload JSON que entrega el backend
    // (debug de sincronización de keys entre Django y este módulo).
    console.log('[IA] Respuesta cruda del backend:', JSON.stringify(result));
    console.log('[IA] Claves de datos_ia:', Object.keys(datos));

    aplicarCamposIa(datos);
    reportarResultadoIa(datos, result);
  } catch (err) {
    console.error('[IA] Error en handler de Analizar IA:', err);
    let mensaje = 'Error al analizar con IA';
    if (err instanceof Error && err.name === 'AbortError') {
      mensaje = 'El análisis está tardando más de lo esperado. La IA puede estar ocupada o no disponible. Intentá de nuevo.';
    } else if (err instanceof Error) {
      mensaje = err.message || mensaje;
    }
    if (iaProgressText) iaProgressText.textContent = '❌ Error en el análisis';
    if (iaProgressSubtext) iaProgressSubtext.textContent = mensaje;
    showToast(`❌ ${mensaje}`, 'error');
  } finally {
    setTimeout(() => {
      if (iaProgressContainer) iaProgressContainer.classList.add('hidden');
      // El botón IA vuelve a su estado natural (texto fijo, y habilitado si
      // sigue habiendo foto; deshabilitado solo si se quitó la foto).
      liberarAnalizandoIA();
    }, 3000);
  }
}

/** Inicializa el handler del botón IA (sin heartbeat ni polling). */
export function initObjetoAutocompletarIa(): void {
  iaStatus = ref<HTMLElement>('iaStatus');
  iaProgressContainer = ref<HTMLElement>('iaProgressContainer');
  iaProgressText = ref<HTMLElement>('iaProgressText');
  iaProgressSubtext = ref<HTMLElement>('iaProgressSubtext');

  // Estado inicial del botón IA: texto fijo y deshabilitado sin foto.
  refrescarBotonesIA();

  // El handler se vincula al botón IA de la botonera de Fotos del Objeto.
  vincularBotonesIA(analizarConIa);
}




