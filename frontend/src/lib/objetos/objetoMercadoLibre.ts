// =============================================================================
// PRECIO DE REFERENCIA · MERCADO LIBRE ARGENTINA (/objetos/nuevo)
// -----------------------------------------------------------------------------
// Desmantelado del <script> de pages/objetos/nuevo.astro (regla de
// modularización <400 líneas por archivo). Responsabilidad única: el botón
// «Buscar precio de referencia» (#estimarPrecioBtn).
//   · Consulta GET /objetos/buscar_precio_referencia/ (scraping MLA pineado en
//     pesos argentinos + fallback Gemini) y muestra el precio AJUSTADO por estado
//     de conservación.
//   · Interpreta el campo `fuente` y los errores controlados con el módulo
//     compartido lib/precioReferencia.ts (NO compara literales a mano).
// Auth centralizada en services/auth (getAuthHeaders).
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../../services/auth';
import { refOpcional } from '../dom';
import { esFuenteMercadoLibre, mensajeSinPrecio } from '../precioReferencia';
import { showToast } from '../toast';

/** Etiqueta legible del estado de conservación aplicado al precio. */
function etiquetaEstado(estado: string): string {
  const labels: Record<string, string> = {
    excelente: 'Excelente',
    bueno: 'Bueno',
    regular: 'Regular',
    malo: 'Malo',
    muy_malo: 'Muy malo',
  };
  return labels[estado] || estado;
}

/** Porcentaje de descuento aplicado por estado (100 - porcentaje). */
function etiquetaDescuento(porcentaje: number): string {
  const descuento = 100 - porcentaje;
  return descuento > 0 ? `-${descuento}%` : '0%';
}

/** Inicializa el botón «Buscar precio de referencia» (Mercado Libre MLA). */
export function initObjetoMercadoLibre(): void {
  const estimarPrecioBtn = refOpcional<HTMLButtonElement>('estimarPrecioBtn');
  const estimarPrecioText = refOpcional<HTMLElement>('estimarPrecioText');
  const estimarPrecioSpinner = refOpcional<HTMLElement>('estimarPrecioSpinner');
  const precioReferencia = refOpcional<HTMLElement>('precioReferencia');
  const nombreInput = refOpcional<HTMLInputElement>('nombre');
  if (!estimarPrecioBtn || !estimarPrecioText || !estimarPrecioSpinner || !precioReferencia) {
    return;
  }

  estimarPrecioBtn.addEventListener('click', async () => {
    const nombre = nombreInput?.value?.trim();
    if (!nombre) {
      showToast('Primero escribe el nombre del objeto.', 'error');
      nombreInput?.focus();
      return;
    }
    estimarPrecioBtn.disabled = true;
    estimarPrecioText.classList.add('hidden');
    estimarPrecioSpinner.classList.remove('hidden');
    precioReferencia.classList.add('hidden');
    try {
      const estadoActual = refOpcional<HTMLSelectElement>('estado_conservacion')?.value || 'bueno';

      // Llamar al endpoint de precio referencia (scraping MLA + Gemini fallback)
      const response = await fetch(
        `${API_BASE_URL}/objetos/buscar_precio_referencia/?q=${encodeURIComponent(nombre)}&estado=${encodeURIComponent(estadoActual)}`,
        { headers: getAuthHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Error del servidor (${response.status})`);
      }

      const data = await response.json();

      if (data.encontrado) {
        // Autocompletar valor estimado con el precio ajustado
        const valorEstimado = refOpcional<HTMLInputElement>('valor_estimado');
        if (valorEstimado) {
          valorEstimado.value = data.precio_ajustado.toFixed(2);
          valorEstimado.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Mostrar tarjeta con el resultado
        const esML = esFuenteMercadoLibre(data.fuente);
        const tieneLink = data.link && data.link.length > 0;
        precioReferencia.className = 'mt-2';

        precioReferencia.innerHTML = `
          <div class="${tieneLink ? 'cursor-pointer ' : ''}${esML ? 'border border-blue-200 bg-blue-50 hover:bg-blue-100' : 'border border-purple-200 bg-purple-50 hover:bg-purple-100'} rounded-lg p-3 transition-base" ${tieneLink ? `data-link="${data.link}"` : ''}>
            <div class="flex items-start gap-2">
              <span class="text-lg">${esML ? '📦' : '🤖'}</span>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900 truncate">${data.titulo}</p>
                <div class="mt-1 space-y-0.5">
                  <p class="text-xs text-gray-500">Precio original: <span class="font-semibold text-gray-700">$${data.precio_original.toFixed(2)}</span></p>
                  <p class="text-xs text-gray-500">Ajuste por estado (${etiquetaEstado(data.estado_aplicado)} ${etiquetaDescuento(data.porcentaje_aplicado)}): <span class="font-semibold text-blue-700">$${data.precio_ajustado.toFixed(2)}</span></p>
                  ${esML
                    ? '<p class="text-xs text-blue-600 mt-1">🔗 Ver en MercadoLibre →</p>'
                    : tieneLink
                      ? '<p class="text-xs text-purple-600 mt-1">🔗 Ver resultados en MercadoLibre →</p>'
                      : '<p class="text-xs text-purple-600 mt-1">🤖 Estimación de IA (Gemini)</p>'
                  }
                </div>
              </div>
            </div>
          </div>
        `;
        precioReferencia.classList.remove('hidden');

        // Click en la tarjeta abre el link
        if (tieneLink) {
          const tarjeta = precioReferencia.querySelector('[data-link]') as HTMLElement;
          if (tarjeta) {
            tarjeta.addEventListener('click', () => {
              const link = tarjeta.dataset.link;
              if (link) {
                window.open(link, '_blank');
              }
            });
          }
        }

        showToast(`💰 Precio de referencia: $${data.precio_ajustado.toFixed(2)}`, 'success');
      } else {
        // Error CONTROLADO del backend (sin_coincidencia / error_red): nunca se
        // inyecta el precio de un producto que no coincide con la búsqueda.
        const motivo = mensajeSinPrecio(data.fuente_error);
        precioReferencia.className = 'mt-2 text-xs text-amber-600';
        precioReferencia.textContent = motivo;
        precioReferencia.classList.remove('hidden');
        showToast(motivo, 'info');
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
  });
}

