// =============================================================================
// RESULTADO DEL ESCANEO · RENDER (contenido + ruta de ubicación completa)
// -----------------------------------------------------------------------------
// Construye el panel de resultado del modal con NODOS creados por código:
// nunca se inyecta HTML armado con datos de la API (nombres de objetos/cajas,
// categorías, etc.), así que no hay vector de XSS ni necesidad de escapar.
//
//   · Cabecera: nombre + insignia de tipo (Contenedor / Objeto) + descripción.
//   · Ruta: «📍 Habitación › Mueble › Caja» (ruta completa, no sólo el padre).
//   · Sub-cajas enlazadas a /contenedores/<id> y objetos a /objetos/<id>.
//   · Pie: «Abrir ficha completa» + «Escanear otro».
// =============================================================================

import {
  fotoDeObjeto,
  formatearValor,
  type ContenedorApi,
  type ContenedorResuelto,
  type ObjetoApi,
} from './escanerQrContenido';

/** Crea un nodo con clases y texto (SIEMPRE textContent: nunca HTML crudo). */
function crear<K extends keyof HTMLElementTagNameMap>(
  etiqueta: K,
  clase = '',
  texto = '',
): HTMLElementTagNameMap[K] {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto) nodo.textContent = texto;
  return nodo;
}

/** Línea de ruta de ubicación con pin (📍) y el texto completo. */
function filaRuta(ruta: string): HTMLElement {
  const fila = crear('p', 'flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[13px] font-semibold text-amber-900');
  const pin = crear('span', 'shrink-0', '📍');
  pin.setAttribute('aria-hidden', 'true');
  fila.append(pin, crear('span', 'min-w-0 break-words', ruta || 'Sin ubicación registrada'));
  return fila;
}

/** Tarjeta superior del resultado: nombre + tipo + descripción. */
function encabezadoResultado(nombre: string, tipo: string, descripcion: string): HTMLElement {
  const caja = crear('div', 'rounded-xl border border-gray-200 bg-white px-4 py-3');
  const fila = crear('div', 'flex items-start justify-between gap-2');
  fila.append(
    crear('h4', 'min-w-0 text-base font-bold text-gray-900 break-words', nombre),
    crear('span', 'shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700', tipo),
  );
  caja.append(fila);
  if (descripcion) caja.append(crear('p', 'mt-1 text-xs text-gray-500', descripcion));
  return caja;
}

/** Bloque con título de sección y sus filas (o el texto de vacío). */
function bloqueSeccion(titulo: string, filas: HTMLElement[], vacio: string): HTMLElement {
  const bloque = crear('div', 'space-y-1.5');
  bloque.append(crear('p', 'text-[11px] font-bold uppercase tracking-wide text-gray-400', titulo));
  if (filas.length) filas.forEach((fila) => bloque.append(fila));
  else bloque.append(crear('p', 'rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500', vacio));
  return bloque;
}

/** Miniatura del objeto (o el ícono de respaldo). */
function miniaturaObjeto(objeto: ObjetoApi): HTMLElement {
  const foto = fotoDeObjeto(objeto);
  if (!foto) {
    return crear('span', 'shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-base', '🧸');
  }
  const img = crear('img', 'h-10 w-10 shrink-0 rounded-lg bg-gray-100 object-cover');
  img.src = foto;
  img.alt = '';
  img.loading = 'lazy';
  return img;
}

/** Fila enlazada de un objeto contenido. */
function filaObjeto(objeto: ObjetoApi): HTMLElement {
  const enlace = crear('a', 'flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 hover:bg-gray-50 transition-base');
  enlace.href = `/objetos/${objeto.id}`;
  const datos = crear('div', 'min-w-0 flex-1');
  datos.append(crear('p', 'truncate text-sm font-semibold text-gray-900', objeto.nombre));
  datos.append(crear('p', 'truncate text-[11px] text-gray-500', objeto.categoria_nombre || 'Sin categoría'));
  enlace.append(miniaturaObjeto(objeto), datos);
  enlace.append(crear('span', 'shrink-0 text-xs font-semibold text-gray-700', formatearValor(objeto.valor_estimado)));
  return enlace;
}

/** Fila enlazada de una sub-caja del contenedor. */
function filaSubcontenedor(sub: ContenedorApi): HTMLElement {
  const enlace = crear('a', 'flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 hover:bg-amber-100 transition-base');
  enlace.href = `/contenedores/${sub.id}`;
  enlace.append(crear('span', 'shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-base', '📦'));
  const datos = crear('div', 'min-w-0 flex-1');
  datos.append(crear('p', 'truncate text-sm font-semibold text-gray-900', sub.nombre));
  datos.append(crear('p', 'text-[11px] text-gray-500', `${sub.objetos_count ?? 0} objetos`));
  enlace.append(datos);
  return enlace;
}

/** Pie del resultado: ficha completa + «Escanear otro». */
function pieResultado(href: string, etiqueta: string, alEscanearOtro: () => void): HTMLElement {
  const pie = crear('div', 'flex flex-col sm:flex-row gap-2 pt-1');
  const abrir = crear('a', 'flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-base', etiqueta);
  abrir.href = href;
  const otro = crear('button', 'flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-base', '🔄 Escanear otro');
  otro.type = 'button';
  otro.addEventListener('click', alEscanearOtro);
  pie.append(abrir, otro);
  return pie;
}

/**
 * Pinta el resultado de una CAJA escaneada dentro del host del modal.
 * Devuelve el nombre de la caja para el estado `aria-live`.
 */
export function pintarResultadoContenedor(
  host: HTMLElement,
  datos: ContenedorResuelto,
  alEscanearOtro: () => void,
): string {
  const { contenedor, ruta, contenido } = datos;

  const bloque = crear('div', 'space-y-3');
  bloque.append(encabezadoResultado(contenedor.nombre, 'Contenedor', contenedor.descripcion || ''));
  bloque.append(filaRuta(ruta));

  if (contenido.subcontenedores.length) {
    bloque.append(bloqueSeccion(
      `Sub-contenedores · ${contenido.subcontenedores.length}`,
      contenido.subcontenedores.map(filaSubcontenedor),
      '',
    ));
  }

  bloque.append(bloqueSeccion(
    `Contenido · ${contenido.objetos.length} objetos`,
    contenido.objetos.map(filaObjeto),
    contenido.subcontenedores.length
      ? 'No hay objetos sueltos: el contenido está dentro de las sub-cajas.'
      : 'Esta caja está vacía.',
  ));
  bloque.append(pieResultado(`/contenedores/${contenedor.id}`, '🔎 Abrir ficha completa', alEscanearOtro));

  host.replaceChildren(bloque);
  host.classList.remove('hidden');
  return contenedor.nombre;
}

/**
 * Pinta el resultado de un OBJETO escaneado dentro del host del modal.
 * Devuelve el nombre del objeto para el estado `aria-live`.
 */
export function pintarResultadoObjeto(
  host: HTMLElement,
  objeto: ObjetoApi,
  alEscanearOtro: () => void,
): string {
  const bloque = crear('div', 'space-y-3');
  bloque.append(encabezadoResultado(objeto.nombre, 'Objeto', objeto.categoria_nombre || 'Sin categoría'));
  bloque.append(filaRuta(objeto.ubicacion_display || ''));
  bloque.append(filaObjeto(objeto));
  bloque.append(pieResultado(`/objetos/${objeto.id}`, '🔎 Abrir ficha completa', alEscanearOtro));

  host.replaceChildren(bloque);
  host.classList.remove('hidden');
  return objeto.nombre;
}
