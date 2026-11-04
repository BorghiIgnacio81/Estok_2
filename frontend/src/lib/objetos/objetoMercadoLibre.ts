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
// La consulta al backend y el markup de la tarjeta viven en el módulo
// compartido lib/objetos/precioReferenciaConsulta.ts (mismo código que la
// edición y la ficha de detalle del objeto).
// Auth centralizada en services/auth (getAuthHeaders, dentro del módulo común).
// =============================================================================

import { refOpcional } from '../dom';
import { mensajeSinPrecio } from '../precioReferencia';
import { showToast } from '../toast';
import { categoriaSeleccionadaParaBusqueda } from './categoriaSeleccionada';
import { isbnYAutorParaBusqueda } from './datosBusquedaPrecio';
import {
  activarAperturaTarjetaPrecio,
  consultarPrecioReferencia,
  tarjetaPrecioReferenciaHtml,
} from './precioReferenciaConsulta';

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

      // Consulta con `q` + `categoria` (ID oficial MLA / subtipo / nombre): el
      // backend restringe la búsqueda y, si no hay ítems, reintenta sin filtro.
      // LIBROS: ISBN de la edición + autor habilitan la búsqueda flexible del
      // backend (ISBN estricto + «Título + Autor» para la mediana local). El
      // ISBN también se detecta dentro del nombre si el campo está vacío.
      const { isbn, autor } = isbnYAutorParaBusqueda();
      const data = await consultarPrecioReferencia({
        q: nombre,
        estado: estadoActual,
        categoria: categoriaSeleccionadaParaBusqueda(),
        isbn,
        autor,
      });

      if (data.encontrado) {
        // Autocompletar valor estimado con el precio ajustado
        const valorEstimado = refOpcional<HTMLInputElement>('valor_estimado');
        if (valorEstimado) {
          valorEstimado.value = Number(data.precio_ajustado ?? 0).toFixed(2);
          valorEstimado.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Mostrar tarjeta con el resultado
        precioReferencia.className = 'mt-2';
        precioReferencia.innerHTML = tarjetaPrecioReferenciaHtml(data);
        precioReferencia.classList.remove('hidden');

        // Click en la tarjeta abre el link
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
        showToast(motivo, 'info');
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
  });
}

