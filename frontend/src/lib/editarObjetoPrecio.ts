// =============================================================================
// EDICIÓN DE OBJETO · PRECIO DE REFERENCIA (comportamiento de la página)
// -----------------------------------------------------------------------------
// Botón «Buscar precio de referencia» del formulario de edición: consulta el
// endpoint del backend (scraping de MercadoLibre + fallback Gemini), completa el
// valor estimado y muestra la tarjeta del resultado.
//
// La interpretación de `fuente` NO se duplica acá: sale del módulo compartido
// lib/precioReferencia.ts (esFuenteMercadoLibre / mensajeSinPrecio), el mismo
// que usa el alta de objetos.
// Vive fuera de la página por la regla de modularización (<400 líneas de UI).
// =============================================================================

import { mensajeSinPrecio } from './precioReferencia';
import { ref } from './dom';
import { showToast } from './toast';
import { categoriaSeleccionadaParaBusqueda } from './objetos/categoriaSeleccionada';
import { isbnYAutorParaBusqueda } from './objetos/datosBusquedaPrecio';
// Consulta y tarjeta del resultado: módulo COMPARTIDO con el alta de objetos y
// con la ficha de detalle (misma versión, sin duplicar markup ni fetch).
import {
  activarAperturaTarjetaPrecio,
  consultarPrecioReferencia,
  tarjetaPrecioReferenciaHtml,
} from './objetos/precioReferenciaConsulta';

/** Refs del formulario que consume el precio de referencia. */
let estimarPrecioBtn: HTMLButtonElement;
let estimarPrecioText: HTMLElement;
let estimarPrecioSpinner: HTMLElement;
let precioReferencia: HTMLElement;
let nombreInput: HTMLInputElement;
let estadoSelect: HTMLSelectElement;
let valorEstimadoInput: HTMLInputElement;

// =============================================================================
// CONSULTA Y RENDER DEL RESULTADO
// =============================================================================

/** Consulta el precio de referencia y muestra la tarjeta del resultado. */
async function buscarPrecio(): Promise<void> {
  const nombre = nombreInput.value.trim();
  if (!nombre) {
    showToast('Primero escribe el nombre del objeto.', 'error');
    nombreInput.focus();
    return;
  }

  estimarPrecioBtn.disabled = true;
  estimarPrecioText.classList.add('hidden');
  estimarPrecioSpinner.classList.remove('hidden');
  precioReferencia.classList.add('hidden');

  try {
    const estadoActual = estadoSelect.value || 'bueno';

    // Consulta con `q` + `categoria` (ID oficial MLA / subtipo / nombre): el
    // backend restringe la búsqueda y, si no hay ítems, reintenta sin filtro.
    // LIBROS: ISBN de la edición + autor habilitan la búsqueda flexible del
    // backend (ISBN estricto + «Título + Autor» para la mediana del mercado).
    // El fetch y su validación viven en el módulo compartido.
    const { isbn, autor } = isbnYAutorParaBusqueda();
    const data = await consultarPrecioReferencia({
      q: nombre,
      estado: estadoActual,
      categoria: categoriaSeleccionadaParaBusqueda(),
      isbn,
      autor,
    });

    if (data.encontrado) {
      // Autocompletar el valor estimado con el precio ajustado
      valorEstimadoInput.value = Number(data.precio_ajustado ?? 0).toFixed(2);
      valorEstimadoInput.dispatchEvent(new Event('input', { bubbles: true }));

      precioReferencia.className = 'mt-2';
      precioReferencia.innerHTML = tarjetaPrecioReferenciaHtml(data);
      precioReferencia.classList.remove('hidden');

      // Click en la tarjeta abre el link del resultado
      activarAperturaTarjetaPrecio(precioReferencia);

      const precio = Number(data.precio_ajustado ?? 0).toFixed(2);
      showToast(`💰 Precio de referencia: $${precio}`, 'success');
    } else {
      // Error CONTROLADO del backend (sin_coincidencia / error_red): nunca se
      // inyecta el precio de un producto que no coincide con la búsqueda.
      // Se muestra el `mensaje` del backend cuando viene (texto único).
      const motivo = mensajeSinPrecio(data.fuente_error, data.mensaje);
      precioReferencia.className = 'mt-2 text-xs text-amber-600';
      precioReferencia.textContent = motivo;
      precioReferencia.classList.remove('hidden');
      showToast(motivo, 'error');
    }
  } catch (err) {
    console.error('Error al buscar precio de referencia:', err);
    // Sólo un fallo REAL de red/servidor llega acá: no se etiqueta como
    // «sin resultados» ni se disfraza un error del servidor como conexión.
    const detalle = err instanceof Error ? err.message : '';
    precioReferencia.className = 'mt-2 text-xs text-red-600';
    precioReferencia.textContent = detalle.startsWith('Error del servidor')
      ? `❌ ${detalle}. No se pudo buscar el precio de referencia.`
      : '❌ Error de conexión al buscar precios.';
    precioReferencia.classList.remove('hidden');
  } finally {
    estimarPrecioBtn.disabled = false;
    estimarPrecioText.classList.remove('hidden');
    estimarPrecioSpinner.classList.add('hidden');
  }
}

/** Arranca el módulo: resuelve refs del DOM y vincula el botón de búsqueda. */
export function inicializarPrecioReferencia(): void {
  estimarPrecioBtn = ref<HTMLButtonElement>('estimarPrecioBtn');
  estimarPrecioText = ref('estimarPrecioText');
  estimarPrecioSpinner = ref('estimarPrecioSpinner');
  precioReferencia = ref('precioReferencia');
  nombreInput = ref<HTMLInputElement>('nombre');
  estadoSelect = ref<HTMLSelectElement>('estado_conservacion');
  valorEstimadoInput = ref<HTMLInputElement>('valor_estimado');

  estimarPrecioBtn.addEventListener('click', () => void buscarPrecio());
}
