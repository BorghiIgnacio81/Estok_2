// =============================================================================
// EDICIÓN DE OBJETO · «AUTOCOMPLETAR CON IA» (Gemini)
// -----------------------------------------------------------------------------
// La página de edición NO captura fotos nuevas desde este flujo: analiza la
// foto principal ya guardada del objeto con el endpoint proxy del backend
//     POST /objetos/<id>/analizar_con_ia/
// que usa GEMINI_API_KEY en el servidor (100% nube, sin IA local).
//
// · El botón se habilita SOLO cuando el objeto tiene fotos cargadas
//   (evento EVENTO_FOTOS_ACTUALIZADAS que emite editarObjetoFotos.ts).
// · No hay heartbeat ni health-check previo que bloquee el botón.
// · El estado visual (spinner / disabled) lo gobierna botonAutocompletarIA.ts.
// · Al responder, los campos se vuelcan con el mapeo compartido
//   objetos/objetoIaCampos.ts y se notifica por toast qué se completó.
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../services/auth';
import {
  establecerFotoDisponible,
  liberarAnalizandoIA,
  marcarAnalizandoIA,
  vincularBotonesIA,
} from './botonAutocompletarIA';
import { EVENTO_FOTOS_ACTUALIZADAS } from './editarObjetoFotos';
import {
  aplicarCamposIa,
  listarCamposCompletados,
  resumenCamposCompletados,
} from './objetos/objetoIaCampos';
import { showToast } from './toast';

let objetoId = '';
let hayFotos = false;

/** Analiza la foto principal del objeto y vuelca los campos en el formulario. */
async function analizarObjetoConIa(): Promise<void> {
  if (!hayFotos) {
    showToast('❌ El objeto necesita al menos una foto para analizarla.', 'error');
    return;
  }

  marcarAnalizandoIA();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(`${API_BASE_URL}/objetos/${objetoId}/analizar_con_ia/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      // solo_analisis: el backend devuelve los campos SIN persistirlos; el PUT
      // del formulario es el único que guarda lo que el usuario confirma.
      body: JSON.stringify({ solo_analisis: true }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(
        errData.error || errData.detail || `Error del servidor (${response.status})`,
      );
    }

    const result = await response.json();
    const datos = result.datos || result.datos_ia || result;
    aplicarCamposIa(datos);

    const etiquetas = listarCamposCompletados(datos);
    if (etiquetas.length > 0) {
      showToast(
        `🤖 Campos completados: ${resumenCamposCompletados(datos)}. Revisá y guardá los cambios.`,
        'success',
      );
    } else {
      showToast(
        '⚠️ La IA no detectó campos nuevos. Podés completarlos manualmente.',
        'info',
      );
    }
  } catch (err) {
    const mensaje =
      err instanceof Error && err.name === 'AbortError'
        ? 'El análisis tardó demasiado. Intentá de nuevo.'
        : err instanceof Error
          ? err.message
          : 'Error al analizar con IA';
    showToast(`❌ ${mensaje}`, 'error');
  } finally {
    clearTimeout(timeoutId);
    liberarAnalizandoIA();
  }
}

/** Arranca el botón IA de la pantalla de edición (una sola vez por carga). */
export function inicializarIaEdicion(id: string): void {
  objetoId = id;

  // Sin fotos conocidas todavía: botón deshabilitado hasta que carguen.
  hayFotos = false;
  establecerFotoDisponible(false);

  document.addEventListener(EVENTO_FOTOS_ACTUALIZADAS, (evento) => {
    const total = Number(
      (evento as CustomEvent<{ total?: number }>).detail?.total ?? 0,
    );
    hayFotos = total > 0;
    establecerFotoDisponible(hayFotos);
  });

  vincularBotonesIA(analizarObjetoConIa);
}
