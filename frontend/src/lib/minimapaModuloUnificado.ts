// =============================================================================
// MÓDULO UNIFICADO DE MINIMAPAS - MOTOR DE RESOLUCIÓN AUTÓNOMO (por ID)
// -----------------------------------------------------------------------------
// Capa de datos del componente global `components/MinimapaModuloUnificado.astro`.
// Recibe SÓLO el/los ID del contenedor y/o del ambiente activo y resuelve la RUTA
// JERÁRQUICA COMPLETA HACIA ARRIBA (Planta → Habitación → Espacio/Mueble →
// División/Caja) sin que la pantalla aporte la jerarquía.
//
// El DIBUJO no se duplica acá: la geometría REAL (ui_left/ui_top/ui_width/
// ui_height persistidos en PostgreSQL) y el trazo canónico (fondo crema, borde
// negro de puntas redondeadas, fusión «Pasillo Escalera» como un único contorno,
// NARANJA #f97316 en la celda/ambiente final activa) los emite el MISMO motor de
// toda la app: lib/rutaCajaMinimapas.ts → rutaMinimapasHtml → (sectoresDeItems +
// minimapaSectoresSvg de lib/minimapa.ts). Cero lógica de dibujo inline.
//
// Auth centralizada: `cargarContextoRutaCaja` usa getAuthHeaders() de
// src/services/auth. Este módulo JAMÁS define sus propios headers ni su propio
// fetch: delega 100% en la fuente única de contexto espacial.
// =============================================================================

import {
  cargarContextoRutaCaja,
  rutaMinimapasHtml,
  entidadUbicableDeContenedor,
} from './rutaCajaMinimapas';
import { ASPECTO_LIENZO, minimapaSectoresSvg } from './minimapa';
import type { SectorMinimapa } from './minimapa';
import { hostPlanoMinimapaHtml } from './minimapaRutaHost';

/**
 * Datos mínimos de entrada del módulo. Todos son IDs: la jerarquía se resuelve
 * puertas adentro.
 */
export interface DatosModuloMinimapa {
  /** ID del CONTENEDOR activo (el más profundo) cuya ruta se sube hacia arriba. */
  containerId?: string | null;
  /** ID del AMBIENTE/ubicación activo (cuando no hay contenedor). */
  ubicacionId?: string | null;
  /**
   * ID del objeto activo (vista de detalle). Se conserva por compatibilidad de
   * la API pública del módulo: el objeto por sí solo no aporta geometría, así
   * que la pantalla debe acompañarlo con `containerId`/`ubicacionId`.
   */
  objetoId?: string | null;
}

/** Normaliza un ID a string o null (descarta vacíos sin inventar entidades). */
function idONull(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const texto = String(valor).trim();
  return texto === '' ? null : texto;
}

/**
 * Resuelve y devuelve el HTML de la SUCESIÓN HORIZONTAL de minimapas asimétricos
 * de la ruta de la entidad indicada. Devuelve '' cuando no hay ruta real que
 * dibujar (sin ID, sin ambiente ni contenedor): nunca un plano inventado.
 *
 * Orden de resolución:
 *   1. Con `containerId`: sube la cadena raíz→hoja del contenedor, deriva el
 *      ambiente real y dibuja Planta → Habitación → … → Contenedor.
 *   2. Sin contenedor pero con `ubicacionId`: dibuja Planta → Habitación.
 */
export async function resolverCadenaMinimapas(datos: DatosModuloMinimapa = {}): Promise<string> {
  const containerId = idONull(datos.containerId);
  let ubicacionId = idONull(datos.ubicacionId);

  // Sin contenedor ni ambiente no hay geometría real: host vacío (jamás relleno).
  if (!containerId && !ubicacionId) return '';

  await cargarContextoRutaCaja();

  if (containerId) {
    const entidad = entidadUbicableDeContenedor(containerId);
    // El ambiente explícito de la pantalla tiene prioridad; si no vino, se usa el
    // derivado de la cadena del contenedor.
    ubicacionId = ubicacionId ?? entidad.ubicacion;
    return rutaMinimapasHtml({ ubicacion: ubicacionId, parent_contenedor: entidad.contenedor });
  }

  return rutaMinimapasHtml({ ubicacion: ubicacionId, parent_contenedor: null });
}

/**
 * Rellena el host `hostId` con la sucesión horizontal del módulo y alterna la
 * visibilidad del bloque (`sectionId`). Devuelve true si hubo ruta real.
 *
 * Espeja el contrato de la vieja `renderRutaUbicacionObjeto` para que su
 * reemplazo en la vista de detalle sea directo, pero resolviendo la jerarquía a
 * partir del ID (no de la entidad ya desarmada por la pantalla).
 */
export async function renderModuloMinimapa(
  hostId: string,
  sectionId: string | null,
  datos: DatosModuloMinimapa = {},
): Promise<boolean> {
  const host = document.getElementById(hostId);
  const seccion = sectionId ? document.getElementById(sectionId) : null;
  if (!host) return false;

  host.innerHTML = '';
  seccion?.classList.add('hidden');

  try {
    const html = await resolverCadenaMinimapas(datos);
    if (!html) return false;
    host.innerHTML = html;
    seccion?.classList.remove('hidden');
    return true;
  } catch (error) {
    // Sin contexto espacial el bloque queda oculto: mejor sin mapa que con uno
    // descalzado o inventado.
    console.error('[MinimapaModuloUnificado] No se pudo resolver la ruta:', error);
    return false;
  }
}

// =============================================================================
// PLANO CANÓNICO EMITIDO POR EL MÓDULO (cara JS para pantallas dinámicas)
// -----------------------------------------------------------------------------
// Pantallas con render EN CALIENTE (el asistente «Mover» del listado, que no se
// puede declarar como componente Astro) montan el plano por acá: el MÓDULO es la
// ÚNICA cara pública y adentro delega en el MISMO motor global
// (minimapaSectoresSvg) y en la ÚNICA fábrica de host (minimapaRutaHost.ts →
// `.minimapa-ruta-plano`). Cero divs de plano propios en las pantallas.
// =============================================================================

/** Opciones del plano canónico emitido por el módulo. */
export interface OpcionesPlanoModulo {
  /** Relación alto/ancho REAL del lienzo (default ASPECTO_LIENZO). */
  aspecto?: number;
  /** Cada silueta viaja en `<g data-sector-id>` (navegación/suelta por clic). */
  clicable?: boolean;
  /** Emite la capa de etiquetas (icono + nombre) sobre cada silueta. */
  etiquetas?: boolean;
  /** Data-attributes extra por silueta (zonas de suelta, etc.). */
  atributosSector?: (sector: { id: string; nombre: string }) => string;
  /** Ganchos del host (ej: la zona de suelta `data-mover-plano`). */
  extraHost?: string;
}

/**
 * Plano a escala canónico (host `.minimapa-ruta-plano` + SVG elástico del motor).
 * Devuelve '' si no hay sectores (la pantalla conserva su estado vacío).
 */
export function planoModuloHtml(
  sectores: SectorMinimapa[],
  opts: OpcionesPlanoModulo = {},
): string {
  if (!sectores.length) return '';
  const aspecto = Math.max(0.35, Math.min(1.8, Number(opts.aspecto) || ASPECTO_LIENZO));
  const svg = minimapaSectoresSvg({
    sectores,
    aspecto,
    responsive: true,
    clicable: opts.clicable,
    etiquetas: opts.etiquetas,
    atributosSector: opts.atributosSector,
  });
  return hostPlanoMinimapaHtml(svg, aspecto, opts.extraHost ?? '');
}

// =============================================================================
// SECCIÓN INTERNA DEL CONTENEDOR (grilla F·C) - MISMO ESTÁNDAR VISUAL
// -----------------------------------------------------------------------------
// Antes de la unificación, la «sección» de un objeto dentro de su contenedor se
// dibujaba con `minimapaHtml` (grilla CSS rígida de celdas cuadradas idénticas,
// borde gris y relleno verde). Acá se readapta al ESTÁNDAR ÚNICO del motor: cada
// celda es un SECTOR PROPORCIONAL dentro del plano canónico (LÁMINA con FONDO
// CREMA suave y BORDE NEGRO externo de puntas redondeadas) y SÓLO la celda activa
// (la que aloja al objeto) va en NARANJA ESTRICTO (#f97316). Cero divs manuales.
// =============================================================================

/** Aspecto (alto/ancho) por defecto de la grilla de sección: cuadrada. */
export const ASPECTO_SECCION = 1;
/** Separación en % entre celdas de la grilla del contenedor (muro negro). */
const SEPARACION_SECCION = 2;

/** Datos de la «sección» interna de un contenedor (celda F·C activa). */
export interface DatosSeccionModulo {
  /** Filas de la grilla del contenedor (default 3). */
  filas?: number;
  /** Columnas de la grilla del contenedor (default 3). */
  columnas?: number;
  /** Fila activa (1-based) donde reside el objeto. */
  fila?: number | null;
  /** Columna activa (1-based) donde reside el objeto. */
  columna?: number | null;
  /** Aspecto (alto/ancho) del plano (default ASPECTO_SECCION). */
  aspecto?: number;
}

/**
 * GRID_CELDAS → SECTORES PROPORCIONALES: cada celda de la grilla simétrica del
 * contenedor se convierte en un sector con borde negro; la celda activa va en
 * naranja. Reutiliza el motor canónico `minimapaSectoresSvg`.
 */
export function sectoresSeccion(
  filas: number,
  columnas: number,
  fila: number | null | undefined,
  columna: number | null | undefined,
): SectorMinimapa[] {
  const f = Math.max(1, Math.floor(Number(filas) || 3));
  const c = Math.max(1, Math.floor(Number(columnas) || 3));
  const ancho = Math.max(1, (100 - SEPARACION_SECCION * (c + 1)) / c);
  const alto = Math.max(1, (100 - SEPARACION_SECCION * (f + 1)) / f);
  const sectores: SectorMinimapa[] = [];
  for (let r = 1; r <= f; r++) {
    for (let col = 1; col <= c; col++) {
      sectores.push({
        left: SEPARACION_SECCION * col + ancho * (col - 1),
        top: SEPARACION_SECCION * r + alto * (r - 1),
        width: ancho,
        height: alto,
        activo: fila === r && columna === col,
      });
    }
  }
  return sectores;
}

/**
 * HTML de la «sección» interna del contenedor con el estándar visual único.
 * Devuelve '' sin celda activa (la pantalla conserva el bloque oculto: nunca un
 * plano de relleno).
 */
export function seccionPlanoHtml(datos: DatosSeccionModulo): string {
  const fila = datos.fila ?? null;
  const columna = datos.columna ?? null;
  if (!fila || !columna) return '';
  const filas = Math.max(1, Math.floor(Number(datos.filas) || 3));
  const columnas = Math.max(1, Math.floor(Number(datos.columnas) || 3));
  const aspecto = Number(datos.aspecto) > 0 ? Number(datos.aspecto) : ASPECTO_SECCION;
  return minimapaSectoresSvg({
    sectores: sectoresSeccion(filas, columnas, fila, columna),
    aspecto,
    responsive: true,
  });
}

/**
 * Rellena el host `hostId` con la «sección» del contenedor y alterna la
 * visibilidad del bloque (`sectionId`). Devuelve true si hubo celda activa.
 */
export function renderSeccionModulo(
  hostId: string,
  sectionId: string | null,
  datos: DatosSeccionModulo,
): boolean {
  const host = document.getElementById(hostId);
  const seccion = sectionId ? document.getElementById(sectionId) : null;
  if (!host) return false;

  host.innerHTML = '';
  seccion?.classList.add('hidden');

  const html = seccionPlanoHtml(datos);
  if (!html) return false;
  host.innerHTML = html;
  seccion?.classList.remove('hidden');
  return true;
}
