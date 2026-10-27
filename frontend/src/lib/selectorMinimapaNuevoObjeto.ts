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
import { apiGet, fetchAllPages } from './api';
import type { EstokConfig, UbicacionPlano } from './mapaJerarquico';
import { habitacionesDeFila } from './espaciosDePlanta';
// Espacios virtuales/de sistema (limbo «En Tránsito»): NUNCA se dibujan dentro
// del plano; se representan con una tarjeta externa arriba del lienzo.
import {
  esEspacioVirtual,
  esHabitacionDibujable,
  ubicacionVirtual,
} from './ubicacionesVirtuales';
// Selección del espacio virtual «En Tránsito» (tarjeta externa al plano).
import { seleccionarTransito } from './selectorMinimapaTransito';
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
    const [estoks, ubicaciones, contenedores, limboApi] = await Promise.all([
      fetchAllPages<EstokConfig>('/estoks/', { page_size: '1000' }),
      fetchAllPages<UbicacionPlano>('/ubicaciones/', { page_size: '1000' }),
      fetchAllPages<ContenedorMinimapa>('/contenedores/', { page_size: '1000' }),
      // Endpoint idempotente del backend: devuelve (y asegura) la habitación
      // VIRTUAL «En Tránsito» del Estok activo. Si el backend viejo aún no lo
      // expone, cae al limbo que ya venga dentro del padrón de ubicaciones.
      apiGet<UbicacionPlano>('/ubicaciones/limbo/').catch(() => null),
    ]);

    const activoId = getEstokActivoId();
    estado.estok = estoks.find((e) => String(e.id) === String(activoId)) || estoks[0] || null;
    estado.limbo = limboApi ?? ubicacionVirtual(ubicaciones);
    // El limbo NUNCA entra al padrón dibujable: se renderiza como tarjeta
    // externa (arriba del plano) y no como un rectángulo dentro del lienzo.
    estado.ubicaciones = ubicaciones.filter((u) => !esEspacioVirtual(u));
    estado.contenedores = contenedores;
    const idInput = (el(IDS.inputUbicacion) as HTMLInputElement | null)?.value || '';
    estado.enTransito = Boolean(
      estado.limbo && idInput && String(estado.limbo.id) === String(idInput),
    );

    // PLANTA ACTIVA SIEMPRE CON PLANO: si la fila vigente quedó sin ambientes
    // DIBUJABLES (sin geometría física explícita), el recorrido salta a la
    // primera planta con ambientes válidos. Nunca se queda mirando un lienzo
    // vacío ni una caja inventada.
    const plantas = plantasDisponibles();
    const fila = filaActiva();
    const espacios = espaciosEstok();
    const dibujablesEn = (f: number): number =>
      habitacionesDeFila(espacios, f).filter(esHabitacionDibujable).length;
    if (dibujablesEn(fila) === 0) {
      const conAmbientes = plantas.find((p) => dibujablesEn(p.fila) > 0);
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

/**
 * Ubicación (habitación) que aloja a un contenedor, subiendo por
 * `parent_contenedor` cuando la pieza es una caja anidada dentro de un mueble.
 *
 * POR QUÉ EXISTE (fix «contenedor ausente»): el payload del objeto debe viajar
 * SIEMPRE con `ubicacion` y `contenedor`. Si el usuario entra directo al nivel
 * de muebles/cajas sin pasar por el cuarto —o la restauración desde los inputs
 * ocultos deja `habitacionId` en null— el objeto se guardaba con la ubicación
 * vacía y el árbol de /objetos lo mostraba como huérfano.
 */
function ubicacionDeContenedor(contenedorId: string): string {
  let cursor = estado.contenedores.find((c) => String(c.id) === String(contenedorId)) || null;
  const visitados = new Set<string>();
  while (cursor && !visitados.has(String(cursor.id))) {
    visitados.add(String(cursor.id));
    if (cursor.ubicacion) return String(cursor.ubicacion);
    const padreId = cursor.parent_contenedor;
    cursor = padreId
      ? estado.contenedores.find((c) => String(c.id) === String(padreId)) || null
      : null;
  }
  return '';
}

/** Escribe la selección en los inputs `ubicacion` / `contenedor` del form. */
function escribirSeleccion(): void {
  const inputUbicacion = el(IDS.inputUbicacion) as HTMLInputElement | null;
  const inputContenedor = el(IDS.inputContenedor) as HTMLInputElement | null;

  // La CAJA manda sobre el MUEBLE: es el contenedor más específico elegido.
  const contenedorId = estado.cajaId || estado.muebleId || '';

  // «En tránsito» es una Ubicación REAL (el limbo del inquilinato): el FK del
  // objeto viaja con su UUID, pero la pieza NO ocupa ningún cuarto del plano.
  // Fuera de ese caso, la ubicación SIEMPRE se completa: si falta el cuarto
  // activo se deriva del contenedor elegido (nunca se envía sólo el contenedor).
  const ubicacionSeleccionada =
    estado.enTransito && estado.limbo
      ? String(estado.limbo.id)
      : estado.habitacionId || ubicacionDeContenedor(contenedorId);

  if (inputUbicacion) inputUbicacion.value = ubicacionSeleccionada;
  if (inputContenedor) inputContenedor.value = contenedorId;

  inputUbicacion?.dispatchEvent(new Event('change', { bubbles: true }));
  inputContenedor?.dispatchEvent(new Event('change', { bubbles: true }));
}

function limpiarDescendencia(desde: 0 | 1 | 2 | 3): void {
  if (desde <= 1) {
    estado.habitacionId = null;
    estado.muebleId = null;
    estado.cajaId = null;
    // Salir de la habitación/mueble también abandona «En tránsito».
    estado.enTransito = false;
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
    // Elegir un ambiente físico SIEMPRE sale del estado «En tránsito».
    estado.enTransito = false;
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
  if (accion === 'transito') {
    // TARJETA EXTERNA «En tránsito»: el objeto viaja con la mudanza sin ocupar
    // un cuarto. Se selecciona el limbo del Estok y se sale del plano.
    void seleccionarTransito(escribirSeleccion, render);
    return;
  }
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
  // Cambiar de planta es sólo una acción de NAVEGACIÓN: no debe borrar la
  // declaración «En tránsito» (el objeto sigue sin ubicación física).
  const estabaEnTransito = estado.enTransito;
  limpiarDescendencia(1);
  estado.enTransito = estabaEnTransito;
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
    // «En Tránsito» se selecciona desde su tarjeta externa, no desde el plano.
    if (estado.limbo && String(estado.limbo.id) === String(id)) {
      return seleccionarTransito(escribirSeleccion, render);
    }
    estado.enTransito = false;
    const habitacion = estado.ubicaciones.find((u) => String(u.id) === String(id));
    if (!habitacion) return false;
    // Fila real de la planta a la que pertenece el espacio creado.
    estado.planta = String(filaDeUbicacionDe(habitacion));
    estado.habitacionId = String(habitacion.id);
    limpiarDescendencia(2);
    irANivel(2);
    return true;
  }

  estado.enTransito = false;
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

