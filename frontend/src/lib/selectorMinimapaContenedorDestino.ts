// =============================================================================
// CAJA / CONTENEDOR DE DESTINO · SELECTOR DIRECTO DEL FORMULARIO DE OBJETO
// -----------------------------------------------------------------------------
// El recorrido por minimapas llega a una caja navegando cuarto → mueble → caja.
// Por eso una CAJA que NO cuelga de un mueble (raíz del cuarto, huérfana o
// mudada al limbo «En Tránsito») quedaba fuera de alcance: el plano no la
// dibuja al nivel de muebles y, si no tiene espacio físico fijo, no aparece en
// ningún lienzo.
//
// Este módulo agrega el SELECTOR DESPLEGABLE que lista TODAS las cajas /
// contenedores registrados en el Estok activo (tipo CAJA móvil — la categoría
// «Cajas y contenedores», ej. «Caja 01», y las cajas legacy sin tipo) para
// elegir una DIRECTAMENTE como destino del objeto, esté o no en un espacio
// físico fijo.
//
// Fuente ÚNICA de estado: `estado.contenedores` del selector de minimapas (el
// árbol del Estok activo ya descargado). No hace fetch propio, no duplica la
// taxonomía (reutiliza `esCajaMovil`) ni el concepto del limbo de mudanza
// (`esHabitacionLimbo`). 100% render puro: el clic/`change` lo conecta
// selectorMinimapaNuevoObjeto.ts (capa de navegación).
// =============================================================================

import { escapeHtml } from './mapaJerarquico';
import { estado } from './selectorMinimapaUbicacionEstado';
import type { ContenedorMinimapa } from './selectorMinimapaUbicacionEstado';
import { esCajaMovil, esHabitacionLimbo } from './taxonomiaContenedor';

/** Caja/contenedor ofrecido como destino directo del objeto. */
export interface CajaDestino {
  id: string;
  nombre: string;
  /** Ruta legible: «Living › Mueble 2 › Caja 01» o «En tránsito». */
  ruta: string;
  /** La caja NO tiene espacio físico fijo (limbo de mudanza / huérfana). */
  sinEspacioFijo: boolean;
}

/** Nombre legible de una habitación (incluye el limbo «En Tránsito»). */
function nombreDeUbicacion(ubicacionId?: string | null): string {
  if (!ubicacionId) return '';
  const ubicacion = estado.ubicaciones.find(
    (u) => String(u.id) === String(ubicacionId),
  );
  if (ubicacion) return ubicacion.nombre || '';
  if (estado.limbo && String(estado.limbo.id) === String(ubicacionId)) {
    return estado.limbo.nombre || 'En tránsito';
  }
  return '';
}

/**
 * Ubicación (habitación) EFECTIVA de la caja: la propia o, si es nula, la del
 * primer ancestro que la declare (una sub-caja hereda el cuarto de su mueble).
 * Es la que usa el payload del objeto y la que define si la pieza está en el
 * limbo «En Tránsito».
 */
function ubicacionEfectivaDe(caja: ContenedorMinimapa): string | null {
  const visitados = new Set<string>();
  let cursor: ContenedorMinimapa | null = caja;
  while (cursor && !visitados.has(String(cursor.id))) {
    visitados.add(String(cursor.id));
    if (cursor.ubicacion) return String(cursor.ubicacion);
    const padreId: string | null = cursor.parent_contenedor ?? null;
    cursor = padreId
      ? estado.contenedores.find((c) => String(c.id) === String(padreId)) || null
      : null;
  }
  return null;
}

/**
 * Ruta de la caja subiendo por `parent_contenedor` hasta la raíz del cuarto:
 * queda «Cuarto › Mueble › Caja». La primera habitación encontrada al subir es
 * la del cuarto (las sub-cajas heredan la ubicación de su padre).
 */
function rutaDeCaja(caja: ContenedorMinimapa): { ruta: string; sinEspacioFijo: boolean } {
  const nombres: string[] = [];
  const visitados = new Set<string>();
  let cursor: ContenedorMinimapa | null = caja;
  while (cursor && !visitados.has(String(cursor.id))) {
    visitados.add(String(cursor.id));
    nombres.unshift(cursor.nombre || 'Caja');
    const padreId: string | null = cursor.parent_contenedor ?? null;
    cursor = padreId
      ? estado.contenedores.find((c) => String(c.id) === String(padreId)) || null
      : null;
  }
  const ubicacionId = ubicacionEfectivaDe(caja);
  const cuarto = nombreDeUbicacion(ubicacionId);
  const sinEspacioFijo = !ubicacionId || esHabitacionLimbo(cuarto);
  const ruta = [cuarto || (sinEspacioFijo ? 'En tránsito' : ''), ...nombres]
    .filter(Boolean)
    .join(' › ');
  return { ruta, sinEspacioFijo };
}

/**
 * TODAS las cajas/contenedores del Estok activo, ordenadas por nombre.
 * No se filtra por ubicación: justamente las cajas sin espacio físico fijo
 * (limbo «En Tránsito» o huérfanas) son las que no se pueden alcanzar con el
 * plano y deben poder elegirse igual como destino.
 */
export function cajasDestinoDelEstok(): CajaDestino[] {
  return estado.contenedores
    .filter((contenedor) => esCajaMovil(contenedor))
    .map((contenedor) => {
      const { ruta, sinEspacioFijo } = rutaDeCaja(contenedor);
      return {
        id: String(contenedor.id),
        nombre: contenedor.nombre || 'Caja',
        ruta,
        sinEspacioFijo,
      };
    })
    .sort(
      (a, b) =>
        a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }) ||
        a.ruta.localeCompare(b.ruta, 'es', { sensitivity: 'base' }),
    );
}

/**
 * FILTRADO CASCÁDICO · cajas REALMENTE ubicadas en el espacio elegido.
 *
 * Al seleccionar una habitación en el mapa/árbol, el desplegable de
 * «Contenedor / Caja» sólo ofrece las cajas de ESE espacio: las que declaran la
 * habitación y las sub-cajas que la heredan de su mueble anfitrión
 * (`ubicacionEfectivaDe` sube por `parent_contenedor`). Si el operador eligió el
 * espacio virtual «En tránsito», se ofrecen las cajas del limbo.
 *
 * `null` = todavía no hay espacio elegido (se listan todas, comportamiento
 * histórico: permite rescatar cajas huérfanas o en tránsito).
 */
export function cajasDestinoDeHabitacion(habitacionId: string | null): CajaDestino[] {
  if (!habitacionId) return cajasDestinoDelEstok();
  return cajasDestinoDelEstok().filter((caja) => {
    const real = estado.contenedores.find((c) => String(c.id) === caja.id);
    if (!real) return false;
    return String(ubicacionEfectivaDe(real) || '') === String(habitacionId);
  });
}

/** Espacio activo del recorrido (habitación física o limbo «En tránsito»). */
function espacioActivoId(): string | null {
  if (estado.enTransito && estado.limbo) return String(estado.limbo.id);
  return estado.habitacionId ? String(estado.habitacionId) : null;
}

/**
 * Bloque HTML del selector desplegable (vacío si el Estok todavía no tiene
 * cajas o mientras los espacios se están cargando).
 *
 * El valor de cada opción es el ID REAL del Contenedor: la capa de navegación
 * lo escribe en el input oculto `contenedor` (y resuelve la habitación).
 *
 * CASCADA: con un espacio elegido la lista se limita a las cajas de ESE espacio
 * y la opción vacía dice «Sin caja / Directo en el espacio» (el objeto se
 * guarda suelto en la habitación). Sin espacio elegido se listan todas para no
 * perder el acceso a cajas huérfanas o en tránsito.
 */
export function contenedorDestinoHtml(): string {
  if (estado.cargando) return '';
  const todas = cajasDestinoDelEstok();
  if (!todas.length) return '';
  const espacio = espacioActivoId();
  const cajas = espacio ? cajasDestinoDeHabitacion(espacio) : todas;
  // Selección vigente: la caja elegida (o el mueble activo del recorrido).
  const actual = String(estado.cajaId || estado.muebleId || '');
  // La caja vigente SIEMPRE queda visible, aunque el filtro del espacio la deje
  // fuera: el desplegable nunca debe mentir sobre lo que está seleccionado.
  const vigenteFuera = Boolean(actual) && !cajas.some((caja) => caja.id === actual);
  const vigente = vigenteFuera ? todas.find((caja) => caja.id === actual) : undefined;
  const lista = vigente ? [...cajas, vigente] : cajas;
  const opciones = lista
    .map((caja) => {
      const sufijo = caja.sinEspacioFijo
        ? 'En tránsito'
        : caja.id === vigente?.id && vigenteFuera
          ? `fuera de este espacio · ${caja.ruta}`
          : caja.ruta;
      const texto = sufijo ? `${caja.nombre} · ${sufijo}` : caja.nombre;
      const seleccionada = caja.id === actual ? ' selected' : '';
      return `<option value="${escapeHtml(caja.id)}"${seleccionada}>📦 ${escapeHtml(texto)}</option>`;
    })
    .join('');
  const ayuda = espacio && !cajas.length
    ? 'Este espacio todavía no tiene cajas: el objeto se guardará directo en el espacio. Creá una caja desde Almacenamiento para archivar adentro.'
    : espacio
      ? 'Cajas de este espacio (incluidas las guardadas dentro de sus muebles). «Sin caja» guarda el objeto directo en el espacio.'
      : 'Elegí primero un espacio en el plano para filtrar las cajas, o asigná una caja de cualquier punto del Estok.';
  return `
    <label class="block w-full mb-3">
      <span class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">📦 Contenedor / Caja</span>
      <select data-accion="contenedor-directo"
        class="w-full px-2 py-1.5 text-xs text-gray-800 bg-white border border-gray-300 rounded-lg"
        title="Cajas ubicadas en el espacio seleccionado. «Sin caja» guarda el objeto directo en el espacio.">
        <option value="">— Sin caja / Directo en el espacio —</option>
        ${opciones}
      </select>
      <span class="block mt-1 text-[11px] text-gray-500">${escapeHtml(ayuda)}</span>
    </label>`;
}

/**
 * Puente hacia la capa de navegación del selector de minimapas: la selección
 * por plano vive en selectorMinimapaNuevoObjeto.ts, así que este módulo recibe
 * las dos acciones que necesita en vez de duplicar esa lógica (y sin crear un
 * ciclo de imports: destino → estado, nunca destino → navegación).
 */
export interface AplicadorCajaDestino {
  /** Selecciona el contenedor con la MISMA lógica del plano (ubicación + caja). */
  seleccionarContenedor: (contenedorId: string) => boolean;
  /** Re-escribe los inputs ocultos (`ubicacion`/`contenedor`) y repinta el plano. */
  sincronizar: () => void;
}

/**
 * Aplica la caja eligida en el desplegable como destino del objeto.
 *
 * Resuelve el caso que el plano NO puede alcanzar: una caja RAÍZ del cuarto, una
 * caja huérfana sin ubicación o una caja mudada al limbo «En Tránsito». Si la
 * caja vive en el limbo, deja la tarjeta «En tránsito» encendida: el objeto
 * hereda esa ubicación virtual y la canasta lo rotula como tal.
 *
 * @returns true si la selección quedó aplicada.
 */
export function seleccionarCajaDestino(
  cajaId: string,
  aplicar: AplicadorCajaDestino,
): boolean {
  if (!cajaId) {
    // Opción vacía: se quita la caja y el mueble elegidos sin tocar la UBICACIÓN
    // (el cuarto sigue seleccionado; el objeto queda suelto dentro de él).
    estado.cajaId = null;
    estado.muebleId = null;
    aplicar.sincronizar();
    return false;
  }
  const contenedor = estado.contenedores.find(
    (c) => String(c.id) === String(cajaId),
  );
  if (!contenedor) return false;
  if (!aplicar.seleccionarContenedor(String(contenedor.id))) return false;

  // CAJA EN EL LIMBO de mudanza: no tiene espacio físico fijo (la ubicación se
  // hereda del mueble cuando la sub-caja no la declara).
  const ubicacion = ubicacionEfectivaDe(contenedor);
  const enLimbo = Boolean(estado.limbo && ubicacion && ubicacion === String(estado.limbo.id));
  if (estado.enTransito !== enLimbo) {
    estado.enTransito = enLimbo;
    aplicar.sincronizar();
  }
  return true;
}
