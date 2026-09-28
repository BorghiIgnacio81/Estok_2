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

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { esFuenteMercadoLibre, mensajeSinPrecio } from './precioReferencia';
import { ref } from './dom';
import { showToast } from './toast';

/** Etiquetas legibles del estado de conservación aplicado al ajuste de precio. */
const ETIQUETAS_ESTADO: Record<string, string> = {
  excelente: 'Excelente',
  bueno: 'Bueno',
  regular: 'Regular',
  malo: 'Malo',
  muy_malo: 'Muy malo',
};

/** Nombre legible del estado de conservación. */
function getEstadoLabel(estado: string): string {
  return ETIQUETAS_ESTADO[estado] || estado;
}

/** El backend informa el % que SE CONSERVA: el descuento es su complemento. */
function getDescuentoLabel(porcentaje: number): string {
  const descuento = 100 - porcentaje;
  return descuento > 0 ? `-${descuento}%` : '0%';
}

/** Tarjeta del resultado: link externo, precio real de ML o estimación de IA. */
function tarjetaHtml(data: any): string {
  const esML = esFuenteMercadoLibre(data.fuente);
  const tieneLink = Boolean(data.link && data.link.length > 0);
  const claseCaja = esML
    ? 'border border-blue-200 bg-blue-50 hover:bg-blue-100'
    : 'border border-purple-200 bg-purple-50 hover:bg-purple-100';
  const pie = esML
    ? '<p class="text-xs text-blue-600 mt-1">🔗 Ver en MercadoLibre →</p>'
    : tieneLink
      ? '<p class="text-xs text-purple-600 mt-1">🔗 Ver resultados en MercadoLibre →</p>'
      : '<p class="text-xs text-purple-600 mt-1">🤖 Estimación de IA (Gemini)</p>';

  return `
    <div class="${tieneLink ? 'cursor-pointer ' : ''}${claseCaja} rounded-lg p-3 transition-base" ${
      tieneLink ? `data-link="${data.link}"` : ''
    }>
      <div class="flex items-start gap-2">
        <span class="text-lg">${esML ? '📦' : '🤖'}</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 truncate">${data.titulo}</p>
          <div class="mt-1 space-y-0.5">
            <p class="text-xs text-gray-500">Precio original: <span class="font-semibold text-gray-700">$${data.precio_original.toFixed(2)}</span></p>
            <p class="text-xs text-gray-500">Ajuste por estado (${getEstadoLabel(data.estado_aplicado)} ${getDescuentoLabel(data.porcentaje_aplicado)}): <span class="font-semibold text-blue-700">$${data.precio_ajustado.toFixed(2)}</span></p>
            ${pie}
          </div>
        </div>
      </div>
    </div>
  `;
}

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

    // Endpoint de precio de referencia (scraping + Gemini fallback)
    const response = await fetch(
      `${API_BASE_URL}/objetos/buscar_precio_referencia/?q=${encodeURIComponent(nombre)}&estado=${encodeURIComponent(estadoActual)}`,
      { headers: getAuthHeaders() },
    );
    if (!response.ok) throw new Error(`Error del servidor (${response.status})`);

    const data = await response.json();

    if (data.encontrado) {
      // Autocompletar el valor estimado con el precio ajustado
      valorEstimadoInput.value = data.precio_ajustado.toFixed(2);
      valorEstimadoInput.dispatchEvent(new Event('input', { bubbles: true }));

      precioReferencia.className = 'mt-2';
      precioReferencia.innerHTML = tarjetaHtml(data);
      precioReferencia.classList.remove('hidden');

      // Click en la tarjeta abre el link del resultado
      const tarjeta = precioReferencia.querySelector('[data-link]') as HTMLElement | null;
      if (tarjeta) {
        tarjeta.addEventListener('click', () => {
          const link = tarjeta.dataset.link;
          if (link) window.open(link, '_blank');
        });
      }

      showToast(`💰 Precio de referencia: $${data.precio_ajustado.toFixed(2)}`, 'success');
    } else {
      // Error CONTROLADO del backend (sin_coincidencia / error_red): nunca se
      // inyecta el precio de un producto que no coincide con la búsqueda.
      const motivo = mensajeSinPrecio(data.fuente_error);
      precioReferencia.className = 'mt-2 text-xs text-amber-600';
      precioReferencia.textContent = motivo;
      precioReferencia.classList.remove('hidden');
      showToast(motivo, 'error');
    }
  } catch (err) {
    console.error('Error al buscar precio de referencia:', err);
    precioReferencia.className = 'mt-2 text-xs text-red-600';
    precioReferencia.textContent = '❌ Error de conexión al buscar precios.';
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
