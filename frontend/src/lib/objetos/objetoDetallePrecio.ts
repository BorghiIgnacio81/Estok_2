// =============================================================================
// FICHA DE OBJETO · «COMPARAR PRECIO EN MERCADO LIBRE» (precio de referencia)
// -----------------------------------------------------------------------------
// Reemplaza la antigua redirección a https://www.mercadolibre.com.ar/search?q=…
// (búsqueda web genérica, sin validar coincidencia de título ni moneda) por la
// MISMA lógica del botón «Buscar precio de referencia» del alta de objetos:
//   · GET /api/objetos/buscar_precio_referencia/ (Mercado Libre Argentina +
//     fallback Gemini, siempre en ARS).
//   · Tarjeta con precio original, ajuste por estado de conservación y el
//     enlace que decide el backend (permalink del ítem o
//     https://listado.mercadolibre.com.ar/<búsqueda>).
//
// La consulta y el markup NO se duplican acá: viven en el módulo compartido
// lib/objetos/precioReferenciaConsulta.ts, el mismo que usan /objetos/nuevo y
// /objetos/<id>/editar. La interpretación de `fuente` / `fuente_error` sale de
// lib/precioReferencia.ts.
// Vive fuera de la página por la regla de modularización (<400 líneas de UI).
// =============================================================================

import { refOpcional } from '../dom';
import { mensajeSinPrecio } from '../precioReferencia';
import { showToast } from '../toast';
import {
  activarAperturaTarjetaPrecio,
  consultarPrecioReferencia,
  tarjetaPrecioReferenciaHtml,
} from './precioReferenciaConsulta';
import type { ConsultaPrecioReferencia } from './precioReferenciaConsulta';

/** Datos del objeto que alimentan la búsqueda (payload de GET /objetos/<id>/). */
export interface ObjetoPrecioDetalle {
  nombre?: string | null;
  estado_conservacion?: string | null;
  /** Subtipo de la categoría: «ropa», «libro», «tecnologia», «mueble_arte». */
  categoria_subtipo?: string | null;
  categoria_nombre?: string | null;
  /** Bloque del serializer con ISBN/ISSN y autor (búsqueda flexible de libros). */
  datos_especificos?: Record<string, unknown> | null;
}

const BOTON_ID = 'buscarPrecioMLBtn';
const PANEL_ID = 'precioReferenciaDetalle';

let objetoActual: ObjetoPrecioDetalle | null = null;
let botonBuscar: HTMLButtonElement | null = null;
let panelResultado: HTMLElement | null = null;
let enlazado = false;

/** Texto normalizado ('' cuando no hay valor utilizable). */
function texto(valor: unknown): string {
  return String(valor ?? '').trim();
}

/**
 * Actualiza los datos del objeto mostrado en la ficha. Lo llama la página cada
 * vez que termina de cargar el detalle (`GET /objetos/<id>/`).
 */
export function actualizarObjetoPrecioDetalle(objeto: ObjetoPrecioDetalle | null): void {
  objetoActual = objeto;
}

/** Nombre del objeto: el del payload cargado o, como respaldo, el del título. */
function nombreDelObjeto(): string {
  const nombre = texto(objetoActual?.nombre)
    || texto(document.getElementById('nombreObj')?.textContent);
  return nombre === 'Cargando...' ? '' : nombre;
}

/**
 * Arma la consulta con los atributos REALES del objeto: estado de conservación
 * (ajuste del precio), categoría (restringe la búsqueda en MLA) e ISBN/autor
 * para libros (búsqueda estricta por edición + «Título + Autor»).
 */
function consultaDesdeObjeto(nombre: string): ConsultaPrecioReferencia {
  const especificos = objetoActual?.datos_especificos || {};
  return {
    q: nombre,
    estado: texto(objetoActual?.estado_conservacion) || 'bueno',
    categoria: texto(objetoActual?.categoria_subtipo)
      || texto(objetoActual?.categoria_nombre),
    isbn: texto(especificos.isbn_issn),
    autor: texto(especificos.autor),
  };
}

/** Consulta el precio de referencia y pinta el resultado bajo el botón. */
async function buscarPrecio(): Promise<void> {
  if (!botonBuscar || !panelResultado) return;

  const nombre = nombreDelObjeto();
  if (!nombre) {
    showToast('El objeto todavía no terminó de cargarse.', 'error');
    return;
  }

  botonBuscar.disabled = true;
  botonBuscar.classList.add('opacity-60', 'cursor-wait');
  panelResultado.classList.add('hidden');

  try {
    const data = await consultarPrecioReferencia(consultaDesdeObjeto(nombre));

    if (data.encontrado) {
      panelResultado.className = 'mt-2 w-full';
      panelResultado.innerHTML = tarjetaPrecioReferenciaHtml(data);
      panelResultado.classList.remove('hidden');
      activarAperturaTarjetaPrecio(panelResultado);
      const precio = Number(data.precio_ajustado ?? 0).toFixed(2);
      showToast(`💰 Precio de referencia: $${precio}`, 'success');
    } else {
      // Error CONTROLADO del backend (sin_coincidencia / error_red): nunca se
      // inyecta el precio de un producto que no coincide con la búsqueda.
      const motivo = mensajeSinPrecio(data.fuente_error, data.mensaje);
      panelResultado.className = 'mt-2 w-full text-xs text-amber-600';
      panelResultado.textContent = motivo;
      panelResultado.classList.remove('hidden');
      showToast(motivo, 'info');
    }
  } catch (err) {
    console.error('Error al buscar precio de referencia:', err);
    // Sólo un fallo REAL de red/servidor llega acá: no se etiqueta como
    // «sin resultados» ni se disfraza un error del servidor como conexión.
    const detalle = err instanceof Error ? err.message : '';
    panelResultado.className = 'mt-2 w-full text-xs text-red-600';
    panelResultado.textContent = detalle.startsWith('Error del servidor')
      ? `❌ ${detalle}. No se pudo buscar el precio de referencia.`
      : '❌ Error de conexión al buscar precios.';
    panelResultado.classList.remove('hidden');
  } finally {
    botonBuscar.disabled = false;
    botonBuscar.classList.remove('opacity-60', 'cursor-wait');
  }
}

/** Arranca el módulo: resuelve refs de la ficha y vincula el botón. */
export function inicializarPrecioReferenciaDetalle(): void {
  if (enlazado) return;
  botonBuscar = refOpcional<HTMLButtonElement>(BOTON_ID);
  panelResultado = refOpcional<HTMLElement>(PANEL_ID);
  if (!botonBuscar || !panelResultado) return;
  enlazado = true;
  botonBuscar.addEventListener('click', () => void buscarPrecio());
}
