// =============================================================================
// SELECTOR DE UBICACIÓN POR MINIMAPAS INTERACTIVOS (página "Nuevo Objeto")
// -----------------------------------------------------------------------------
// Reemplaza por completo la vieja navegación en árbol estilo carpetas: el
// usuario elige DÓNDE va el objeto navegando visualmente las SILUETAS ELÁSTICAS
// de las plantas, las habitaciones y los muebles, resaltadas en NARANJA.
//
// Recorrido: 🏠 Estok (plantas) → 🚪 habitación → 🗄️ mueble → 📦 caja.
// Cada nivel escribe la selección en los inputs ocultos del formulario
// (`ubicacion` / `contenedor`), que viajan al backend sin cambios de API.
//
// Este módulo es la CAPA DE NAVEGACIÓN (fetch de espacios, clicks, escritura de
// los inputs y API pública). El dibujo de las siluetas vive en
// selectorMinimapaNuevoObjetoRender.ts, que a su vez reutiliza el motor global
// de minimapas (lib/minimapa.ts) — el mismo de Almacenamiento y Objetos.
//
// Auth multi-tenant: centralizada (lib/api.ts usa getAuthHeaders con el JWT y
// el header X-Estok-Id). Este módulo NUNCA define headers propios.
// =============================================================================

import { getEstokActivoId } from '../services/auth';
import { fetchAllPages } from './api';
import type { EstokConfig, UbicacionPlano } from './mapaJerarquico';
import { habitacionesDeFila } from './espaciosDePlanta';
// Estado, IDs del DOM y derivaciones: fuente ÚNICA compartida con el render.
import {
  estado,
  IDS,
  plantasDisponibles,
  filaActiva,
  espaciosEstok,
  filaDeUbicacionDe,
  habitacionActual,
} from './selectorMinimapaUbicacionEstado';
import { render } from './selectorMinimapaNuevoObjetoRender';
import type { ContenedorMinimapa } from './selectorMinimapaUbicacionEstado';

export type { ContenedorMinimapa, EstadoSelector } from './selectorMinimapaUbicacionEstado';

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

// =============================================================================
// CARGA DE DATOS (tenant activo → espacios reales con geometría ui_*)
// =============================================================================

/**
 * ÁRBOL COMPLETO DEL ESTOK ACTIVO (una sola pasada por recurso):
 *   · `/estoks/`       → plantas/grilla del inmueble,
 *   · `/ubicaciones/`  → divisiones (plantas) Y sus HABITACIONES HIJAS con sus
 *                        dimensiones elásticas reales (ui_left/ui_top/ui_width/
 *                        ui_height) persistidas en PostgreSQL,
 *   · `/contenedores/` → muebles y cajas con la misma geometría nativa.
 * `page_size=1000` + `fetchAllPages` garantizan el árbol íntegro (sin depender de
 * que el backend no pagine) y el aislamiento multi-tenant viaja en el header
 * X-Estok-Id de getAuthHeaders (services/auth).
 */
async function cargarDatos(): Promise<void> {
  estado.cargando = true;
  estado.error = null;

  try {
    const [estoks, ubicaciones, contenedores] = await Promise.all([
      fetchAllPages<EstokConfig>('/estoks/', { page_size: '1000' }),
      fetchAllPages<UbicacionPlano>('/ubicaciones/', { page_size: '1000' }),
      fetchAllPages<ContenedorMinimapa>('/contenedores/', { page_size: '1000' }),
    ]);

    const activoId = getEstokActivoId();
    estado.estok = estoks.find((e) => String(e.id) === String(activoId)) || estoks[0] || null;
    estado.ubicaciones = ubicaciones;
    estado.contenedores = contenedores;

    // PLANTA ACTIVA SIEMPRE CON PLANO: si la fila vigente quedó sin ambientes (el
    // inmueble tiene su estructura real en otra planta), el recorrido salta a la
    // primera planta CON ambientes reales. Nunca se queda mirando un lienzo vacío.
    const plantas = plantasDisponibles();
    const fila = filaActiva();
    const espacios = espaciosEstok();
    if (habitacionesDeFila(espacios, fila).length === 0) {
      const conAmbientes = plantas.find((p) => habitacionesDeFila(espacios, p.fila).length > 0);
      if (conAmbientes) estado.planta = String(conAmbientes.fila);
      else if (!plantas.some((p) => p.fila === fila)) estado.planta = String(plantas[0]?.fila ?? 1);
    }
  } catch (err) {
    estado.error =
      err instanceof Error ? err.message : 'No se pudieron cargar los espacios del Estok.';
  } finally {
    estado.cargando = false;
  }
}

// =============================================================================
// SELECCIÓN → INPUTS OCULTOS DEL FORMULARIO
// =============================================================================

/** Escribe la selección en los inputs `ubicacion` / `contenedor` del form. */
function escribirSeleccion(): void {
  const inputUbicacion = el(IDS.inputUbicacion) as HTMLInputElement | null;
  const inputContenedor = el(IDS.inputContenedor) as HTMLInputElement | null;

  if (inputUbicacion) inputUbicacion.value = estado.habitacionId || '';
  if (inputContenedor) inputContenedor.value = estado.cajaId || estado.muebleId || '';

  inputUbicacion?.dispatchEvent(new Event('change', { bubbles: true }));
  inputContenedor?.dispatchEvent(new Event('change', { bubbles: true }));
}

function limpiarDescendencia(desde: 0 | 1 | 2 | 3): void {
  if (desde <= 1) {
    estado.habitacionId = null;
    estado.muebleId = null;
    estado.cajaId = null;
  } else if (desde === 2) {
    estado.muebleId = null;
    estado.cajaId = null;
  } else {
    estado.cajaId = null;
  }
}

/** Niveles del plano: 1 = habitaciones, 2 = muebles, 3 = cajas (no hay nivel 0). */
function irANivel(nivel: 1 | 2 | 3): void {
  estado.nivel = nivel;
  escribirSeleccion();
  render();
}

// =============================================================================
// INTERACCIÓN
// =============================================================================

/**
 * Resuelve el clic sobre un SECTOR del plano a escala: el `data-sector-id` es el
 * ID real del espacio (Ubicación o Contenedor), así que el nivel se ubica por
 * IDENTIDAD y no por posición. Los espacios FUSIONADOS («Pasillo Escalera»)
 * viajan con el id de su primer miembro: el ambiente continuo se comporta como
 * una sola unidad, igual que en el lienzo grande.
 */
function manejarClickSector(id: string): void {
  if (!id) return;

  const habitacion = estado.ubicaciones.find((u) => String(u.id) === String(id));
  if (habitacion) {
    // La planta pasa a ser la FILA REAL de la habitación (la de su división padre
    // si está encastrada): la misma clave canónica que usa el plano central.
    estado.planta = String(filaDeUbicacionDe(habitacion));
    estado.habitacionId = String(habitacion.id);
    limpiarDescendencia(2);
    irANivel(2);
    return;
  }

  if (estado.contenedores.some((c) => String(c.id) === String(id))) {
    seleccionarEspacioMinimapa('contenedor', String(id));
  }
}

function manejarClick(evento: Event): void {
  const destino = (evento.target as HTMLElement | null) ?? null;

  // CLIC SOBRE EL PLANO A ESCALA: cada silueta del nivel viaja en un
  // `<g data-sector-id>` (componente global MinimapaRuta formato `plano`), así
  // que el clic sobre un ambiente real desciende un nivel.
  const sector = destino?.closest<HTMLElement>('[data-sector-id]');
  if (sector) {
    manejarClickSector(sector.dataset.sectorId || '');
    return;
  }

  const objetivo = destino?.closest<HTMLElement>('[data-accion], [data-nivel]');
  if (!objetivo) return;

  const accion = objetivo.dataset.accion;
  if (accion === 'volver') {
    const destino = Math.max(1, estado.nivel - 1) as 1 | 2 | 3;
    limpiarDescendencia(destino);
    irANivel(destino);
    return;
  }
  if (accion === 'limpiar') {
    // Quitar ubicación: el plano vuelve al nivel de habitaciones de la planta.
    limpiarDescendencia(0);
    irANivel(1);
  }
}

/**
 * Cambio de PLANTA en Modo Casa (varias plantas reales): el `<select>` nativo de
 * la cabecera dispara `change`, no `click`. El `value` es la FILA de la planta
 * (clave canónica del lienzo central): se limpia la descendencia y el mismo plano
 * elástico se repinta al instante con los ambientes de la planta elegida.
 */
function manejarCambio(evento: Event): void {
  const select = (evento.target as HTMLElement | null)?.closest<HTMLSelectElement>(
    'select[data-accion="planta"]',
  );
  if (!select) return;
  const fila = Math.floor(Number(select.value));
  estado.planta = String(Number.isFinite(fila) && fila > 0 ? fila : 1);
  limpiarDescendencia(1);
  irANivel(1);
}

// =============================================================================
// API PÚBLICA
// =============================================================================

/**
 * Arranca el selector sobre la RAÍZ del componente (idempotente).
 *
 * La delegación se registra en la raíz —no en el host del plano— porque el nivel
 * visible reparte su contenido en TRES hosts (cabecera, plano y pie) y los tres
 * cambian de `innerHTML` en cada transición. Se escuchan `click` (plano y
 * botones) y `change` (el `<select>` nativo de planta en Modo Casa).
 */
export function iniciarSelectorMinimapaUbicacion(): void {
  const raiz = el(IDS.raiz) || el(IDS.lienzo);
  if (!raiz || raiz.dataset.activo === 'true') return;
  raiz.dataset.activo = 'true';
  raiz.addEventListener('click', manejarClick);
  raiz.addEventListener('change', manejarCambio);
  // PRIMER PINTADO INMEDIATO: el lienzo muestra el spinner de carga (estado
  // `cargando`) hasta que llega el árbol real del Estok. Nunca un plano genérico.
  render();
  void cargarDatos().then(() => {
    restaurarSeleccionDesdeInputs();
    render();
  });
}

/**
 * Restaura la selección que la página ya tenía en los inputs ocultos (los
 * persiste en sessionStorage y los rellena al volver de un refresco).
 */
function restaurarSeleccionDesdeInputs(): void {
  const ubicacionId = (el(IDS.inputUbicacion) as HTMLInputElement | null)?.value || '';
  const contenedorId = (el(IDS.inputContenedor) as HTMLInputElement | null)?.value || '';
  if (ubicacionId) seleccionarEspacioMinimapa('ubicacion', ubicacionId);
  if (contenedorId) seleccionarEspacioMinimapa('contenedor', contenedorId);
}

/** Recarga los espacios del Estok (tras crear una ubicación o un contenedor). */
export async function refrescarSelectorMinimapaUbicacion(): Promise<void> {
  await cargarDatos();
  render();
}

/**
 * Selección vigente del mapa: los MISMOS valores que viajan en el formulario
 * (los inputs ocultos `ubicacion` / `contenedor` que escribe cada click), con
 * `null` explícito cuando el usuario quitó la ubicación. Así el payload puede
 * desasignar el objeto (los FK del modelo son null=True) en vez de omitir el
 * campo y dejar la ubicación vieja.
 */
export function obtenerSeleccionMinimapa(): { ubicacion: string | null; contenedor: string | null } {
  const valor = (id: string): string | null =>
    (el(id) as HTMLInputElement | null)?.value || null;
  return {
    ubicacion: valor(IDS.inputUbicacion),
    contenedor: valor(IDS.inputContenedor),
  };
}

/**
 * Selecciona programáticamente un espacio recién creado (lo llama la página
 * después de un alta in-place de Ubicación o Contenedor).
 */
export function seleccionarEspacioMinimapa(
  tipo: 'ubicacion' | 'contenedor',
  id: string,
): boolean {
  if (tipo === 'ubicacion') {
    const habitacion = estado.ubicaciones.find((u) => String(u.id) === String(id));
    if (!habitacion) return false;
    // Fila real de la planta a la que pertenece el espacio creado.
    estado.planta = String(filaDeUbicacionDe(habitacion));
    estado.habitacionId = String(habitacion.id);
    limpiarDescendencia(2);
    irANivel(2);
    return true;
  }

  const contenedor = estado.contenedores.find((c) => String(c.id) === String(id));
  if (!contenedor) return false;

  if (contenedor.parent_contenedor) {
    const mueble = estado.contenedores.find(
      (c) => String(c.id) === String(contenedor.parent_contenedor),
    );
    estado.muebleId = mueble ? String(mueble.id) : null;
    estado.cajaId = String(contenedor.id);
    estado.habitacionId = mueble ? String(mueble.ubicacion || '') || null : null;
  } else {
    estado.habitacionId = String(contenedor.ubicacion || '') || null;
    estado.muebleId = String(contenedor.id);
    estado.cajaId = null;
  }

  const habitacion = habitacionActual();
  if (habitacion) estado.planta = String(filaDeUbicacionDe(habitacion));
  irANivel(3);
  return true;
}

// =============================================================================
// SELECCIÓN INICIAL DESDE EL BACKEND (formulario de EDICIÓN de objeto)
// =============================================================================

/** Escribe un valor crudo en un input oculto del selector (red de seguridad). */
function escribirInput(id: string, valor: string): void {
  const input = el(id) as HTMLInputElement | null;
  if (input) input.value = valor;
}

/**
 * Fija el estado inicial activo del mapa con la ubicación YA persistida del
 * objeto (`ubicacion` + `contenedor`, cuyo `parent_contenedor` reconstruye la
 * cadena habitación → mueble → caja y deja el sector en NARANJA #f97316).
 *
 * La usa el formulario de edición: los datos del objeto llegan por fetch (no se
 * conocen en el render del servidor), así que la selección se aplica después de
 * cargar los espacios reales del Estok.
 */
export async function fijarSeleccionMinimapa(
  ubicacionId?: string | null,
  contenedorId?: string | null,
): Promise<void> {
  await cargarDatos();

  const ubicacionOk = ubicacionId
    ? seleccionarEspacioMinimapa('ubicacion', String(ubicacionId))
    : false;
  const contenedorOk = contenedorId
    ? seleccionarEspacioMinimapa('contenedor', String(contenedorId))
    : false;

  // Red de seguridad: si el espacio persistido ya no es navegable en el mapa,
  // los IDs que devolvió el backend igual viajan en el payload del formulario.
  if (ubicacionId && !ubicacionOk) escribirInput(IDS.inputUbicacion, String(ubicacionId));
  if (contenedorId && !contenedorOk) escribirInput(IDS.inputContenedor, String(contenedorId));

  render();
}

