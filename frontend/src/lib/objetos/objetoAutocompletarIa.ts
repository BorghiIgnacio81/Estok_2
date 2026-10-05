// =============================================================================
// AUTOCOMPLETAR CON IA (Google Gemini) · /objetos/nuevo
// -----------------------------------------------------------------------------
// Desmantelado del <script> de pages/objetos/nuevo.astro (regla de
// modularización <400 líneas por archivo). Responsabilidades:
//   · Health-check del motor de IA (Gemini) contra el backend + badge del
//     encabezado (#aiStatusBadge/#aiStatusDot/#aiStatusText) y polling periódico.
//   · Handler del ÚNICO botón «Autocompletar con IA» (botonera de Fotos del
//     Objeto): muestra el progreso indeterminado y el spinner «Analizando…»
//     (delegado en lib/botonAutocompletarIA.ts).
//   · Llamada a POST /objetos/analizar_imagen/ y MAPEO DEFENSIVO multi-key de los
//     campos devueltos por Gemini hacia el formulario.
// El estado visual del botón (disabled / texto / spinner) NO se toca a mano: lo
// gobierna lib/botonAutocompletarIA.ts. La segunda foto para libros (ISBN) vive
// en objetoIaSegundaFoto.ts.
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../../services/auth';
import {
  esIaDisponible,
  establecerIaDisponible,
  liberarAnalizandoIA,
  marcarAnalizandoIA,
  refrescarBotonesIA,
  vincularBotonesIA,
} from '../botonAutocompletarIA';
import { ref, refOpcional } from '../dom';
import { showToast } from '../toast';
import { ID_INPUT_FOTO, mensajeError } from './objetoComunes';

// --- Referencias al DOM (se resuelven en initObjetoAutocompletarIa) ----------
let iaStatus: HTMLElement;
let aiStatusBadge: HTMLElement;
let aiStatusDot: HTMLElement;
let aiStatusText: HTMLElement;
let iaProgressContainer: HTMLElement;
let iaProgressText: HTMLElement;
let iaProgressSubtext: HTMLElement;

/** Health-check del motor de IA (Gemini) contra el backend. */
async function checkAIAvailability(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${API_BASE_URL}/objetos/test_ia_stress/?motor=gemini`, {
      method: 'GET',
      headers: getAuthHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch (err) {
    console.warn('[IA] Heartbeat error:', err);
    return false;
  }
}

/** Consulta el motor y repinta el badge del encabezado + el botón IA. */
async function updateAIStatus(): Promise<void> {
  const connected = await checkAIAvailability();
  // Guarda la disponibilidad y repinta el botón IA (foto cargada + motor
  // disponible = habilitado; si falta alguno de los dos = opaco).
  establecerIaDisponible(connected);
  if (connected) {
    aiStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700';
    aiStatusDot.className = 'w-2 h-2 rounded-full bg-green-500';
    aiStatusText.textContent = '☁️ Gemini conectado';
    iaStatus.classList.add('hidden');
  } else {
    aiStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500';
    aiStatusDot.className = 'w-2 h-2 rounded-full bg-gray-400';
    aiStatusText.textContent = '☁️ Gemini no disponible';
    iaStatus.className = 'mt-2 text-xs text-amber-600';
    iaStatus.textContent = '💡 El motor de IA no está disponible. Verificá que la API key esté configurada en el servidor.';
    iaStatus.classList.remove('hidden');
  }
}

/**
 * Vuelca en el formulario los campos devueltos por Gemini.
 * Mapeo DEFENSIVO multi-key: soporta las keys del backend optimizado (nombre,
 * descripcion, precio_estimado_mercado, meli_category_id) y sus alias (titulo,
 * description, price, categoria_id) por robustez. `datos` proviene de
 * `result.datos_ia || result`.
 */
function aplicarCamposIa(datos: any): void {
  // Nombre
  const nombreInput = refOpcional<HTMLInputElement>('nombre');
  const nombreValor = datos.titulo || datos.nombre || '';
  if (nombreInput && nombreValor) {
    nombreInput.value = nombreValor;
    nombreInput.dispatchEvent(new Event('input'));
  }

  // Descripción
  const descripcionInput = refOpcional<HTMLTextAreaElement>('descripcion');
  const descripcionValor = datos.descripcion || datos.description || '';
  if (descripcionInput && descripcionValor) {
    descripcionInput.value = descripcionValor;
    descripcionInput.dispatchEvent(new Event('input'));
  }

  // Estado de conservación (solo si la opción existe en el select)
  const estadoSelect = refOpcional<HTMLSelectElement>('estado_conservacion');
  if (estadoSelect && datos.estado_conservacion) {
    if ([...estadoSelect.options].some((o) => o.value === datos.estado_conservacion)) {
      estadoSelect.value = datos.estado_conservacion;
      estadoSelect.dispatchEvent(new Event('change'));
    }
  }

  // Color
  const colorInput = refOpcional<HTMLInputElement>('color');
  if (colorInput && datos.color) {
    colorInput.value = datos.color;
    colorInput.dispatchEvent(new Event('input'));
  }

  // Categoría (combobox dinámico): el backend puede devolver 'categoria_id'
  // (UUID), 'meli_category_id' (MLAxxxxx) o 'categoria' (nombre). Se selecciona
  // la opción y se dispara 'change' para que el formulario persista y actualice
  // cualquier dependencia del select.
  const categoriaId =
    datos.categoria_id ||
    datos.meli_category_id ||
    (typeof datos.categoria === 'object' && datos.categoria ? datos.categoria.id : null);
  const categoriaNombre =
    typeof datos.categoria === 'string' && datos.categoria.trim()
      ? datos.categoria.trim()
      : null;
  if (categoriaId || categoriaNombre) {
    const categoriaSelect = refOpcional<HTMLSelectElement>('categoria');
    if (categoriaSelect) {
      const targetId = String(categoriaId ?? '');
      const opt = [...categoriaSelect.options].find(
        (o) =>
          (targetId && (o.value === targetId || o.dataset.meliId === targetId)) ||
          (categoriaNombre && o.textContent?.trim().includes(categoriaNombre))
      );
      if (opt) {
        categoriaSelect.value = opt.value;
        categoriaSelect.dispatchEvent(new Event('change'));
      }
    }
  }

  // Precio estimado de mercado
  const precioInput = refOpcional<HTMLInputElement>('valor_estimado');
  const precioValor = datos.precio_estimado_mercado ?? datos.precio ?? datos.price ?? '';
  if (precioInput && precioValor !== '' && precioValor != null) {
    precioInput.value = String(precioValor);
    precioInput.dispatchEvent(new Event('input'));
  }

  // Campos específicos (libros, electrónica, música, etc.). Se escriben por
  // `name` y NO disparan eventos: replican el comportamiento original.
  const camposEspecificos: Array<[string, unknown]> = [
    ['autor', datos.autor],
    ['marca', datos.marca],
    ['nombre_serie', datos.nombre_serie],
    ['titulo_tomo', datos.titulo_tomo],
    ['numero_tomo', datos.numero_tomo],
    ['editorial', datos.editorial],
    ['idioma', datos.idioma],
    ['isbn_issn', datos.isbn_issn],
    ['edicion', datos.edicion],
  ];
  camposEspecificos.forEach(([nombre, valor]) => {
    if (valor) {
      const el = document.querySelector<HTMLInputElement>(`[name="${nombre}"]`);
      if (el) el.value = String(valor);
    }
  });
}

/**
 * Muestra en #iaStatus el resumen del análisis (éxito total / parcial / nulo),
 * la sección de segunda foto si la IA detectó un libro y el ISBN si vino.
 */
function reportarResultadoIa(datos: any, result: any): void {
  // Mostrar campos pendientes - MENSAJE ÚNICO, no contradictorio
  const camposPendientes: any[] = result.campos_pendientes || datos.campos_pendientes || [];
  const camposCompletados = Object.entries(datos)
    .filter(([k, v]) => {
      if (k === 'raw_response' || k === 'confianza_general' || k === 'campos_pendientes') return false;
      return v !== null && v !== undefined && v !== '';
    })
    .map(([k]) => k);

  if (camposPendientes.length === 0) {
    // Éxito total: todos los campos se autocompletaron
    iaStatus.className = 'mt-3 text-sm text-green-600';
    iaStatus.textContent = '✅ Todos los campos fueron completados por la IA.';
    showToast('🤖 Todos los campos autocompletados por IA correctamente.', 'success');
  } else if (camposCompletados.length > 0) {
    // Éxito parcial: algunos campos se autocompletaron, otros no
    iaStatus.className = 'mt-3 text-sm text-amber-600';
    iaStatus.innerHTML = `⚠️ Se autocompletaron: <strong>${camposCompletados.join(', ')}</strong>. Quedaron pendientes: <strong>${camposPendientes.join(', ')}</strong>. Revisalos manualmente.`;
    showToast(`🤖 Se autocompletaron ${camposCompletados.length} campo(s). Revisá los pendientes.`, 'info');
  } else {
    // No se autocompletó nada
    iaStatus.className = 'mt-3 text-sm text-red-600';
    iaStatus.textContent = '❌ La IA no pudo determinar ningún campo. Revisá la foto e intentá de nuevo.';
    showToast('❌ La IA no pudo autocompletar ningún campo.', 'error');
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

    // Validar que la IA esté disponible (por si el botón se habilitó mal)
    if (!esIaDisponible()) {
      showToast('❌ El motor de IA no está disponible. Verificá que la API key esté configurada en el servidor.', 'error');
      return;
    }

    // Mostrar progreso (indicador indeterminado - sin porcentaje falso).
    // `marcarAnalizandoIA` pasa el botón a ruedita + "Analizando...".
    marcarAnalizandoIA();
    iaProgressContainer.classList.remove('hidden');
    iaProgressText.textContent = '🤖 Analizando imagen con IA...';
    iaProgressSubtext.textContent = '☁️ Procesando en Google Gemini (nube)';
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
    if (mensajeError(err) === 'AbortError') {
      mensaje = 'El análisis está tardando más de lo esperado. La IA puede estar ocupada o no disponible. Intentá de nuevo.';
    } else if (err instanceof Error) {
      mensaje = mensajeError(err);
    }
    if (iaProgressText) iaProgressText.textContent = '❌ Error en el análisis';
    if (iaProgressSubtext) iaProgressSubtext.textContent = mensaje;
    showToast(`❌ ${mensaje}`, 'error');
  } finally {
    setTimeout(() => {
      if (iaProgressContainer) iaProgressContainer.classList.add('hidden');
      // El botón IA vuelve a su estado natural (texto fijo, y deshabilitado
      // si ya no hay foto o el motor no está disponible).
      liberarAnalizandoIA();
    }, 3000);
  }
}

/** Inicializa el health-check, el polling y el handler del botón IA. */
export function initObjetoAutocompletarIa(): void {
  aiStatusBadge = ref<HTMLElement>('aiStatusBadge');
  aiStatusDot = ref<HTMLElement>('aiStatusDot');
  aiStatusText = ref<HTMLElement>('aiStatusText');
  iaStatus = ref<HTMLElement>('iaStatus');
  iaProgressContainer = ref<HTMLElement>('iaProgressContainer');
  iaProgressText = ref<HTMLElement>('iaProgressText');
  iaProgressSubtext = ref<HTMLElement>('iaProgressSubtext');

  // Estado inicial del botón IA: texto fijo y deshabilitado sin foto.
  refrescarBotonesIA();

  // El handler se vincula al botón IA de la botonera de Fotos del Objeto.
  vincularBotonesIA(analizarConIa);

  void updateAIStatus();
  // Polling: verificar cada 30s si hay conexión, cada 120s si no.
  setInterval(async () => {
    if (!esIaDisponible()) {
      const connected = await checkAIAvailability();
      if (connected) {
        void updateAIStatus();
      }
    } else {
      void updateAIStatus();
    }
  }, esIaDisponible() ? 30000 : 120000);
}




