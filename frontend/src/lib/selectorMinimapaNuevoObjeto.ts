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
import {
  estado,
  IDS,
  render,
  plantasDisponibles,
  habitacionActual,
} from './selectorMinimapaNuevoObjetoRender';
import type { ContenedorMinimapa } from './selectorMinimapaNuevoObjetoRender';

export type { ContenedorMinimapa, EstadoSelector } from './selectorMinimapaNuevoObjetoRender';

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

// =============================================================================
// CARGA DE DATOS (tenant activo → espacios reales con geometría ui_*)
// =============================================================================

async function cargarDatos(): Promise<void> {
  estado.cargando = true;
  estado.error = null;

  try {
    const [estoks, ubicaciones, contenedores] = await Promise.all([
      fetchAllPages<EstokConfig>('/estoks/'),
      fetchAllPages<UbicacionPlano>('/ubicaciones/'),
      fetchAllPages<ContenedorMinimapa>('/contenedores/'),
    ]);

    const activoId = getEstokActivoId();
    estado.estok = estoks.find((e) => String(e.id) === String(activoId)) || estoks[0] || null;
    estado.ubicaciones = ubicaciones;
    estado.contenedores = contenedores;

    // La planta activa arranca en la primera planta REAL del inmueble.
    const plantas = plantasDisponibles();
    if (!plantas.some((p) => p.valor === estado.planta)) {
      estado.planta = plantas[0]?.valor || 'PRIMER_PISO';
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

function irANivel(nivel: 0 | 1 | 2 | 3): void {
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
    estado.planta = String(habitacion.piso || estado.planta);
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
    const destino = Math.max(0, estado.nivel - 1) as 0 | 1 | 2 | 3;
    limpiarDescendencia(destino);
    irANivel(destino);
    return;
  }
  if (accion === 'limpiar') {
    limpiarDescendencia(0);
    irANivel(0);
    return;
  }

  const nivel = objetivo.dataset.nivel;
  const id = objetivo.dataset.id || '';

  if (nivel === 'planta') {
    estado.planta = id;
    limpiarDescendencia(1);
    irANivel(1);
    return;
  }
  if (nivel === 'habitacion') {
    estado.habitacionId = id;
    limpiarDescendencia(2);
    irANivel(2);
    return;
  }
  if (nivel === 'mueble') {
    estado.muebleId = id;
    limpiarDescendencia(3);
    irANivel(3);
    return;
  }
  if (nivel === 'caja') {
    estado.cajaId = id;
    escribirSeleccion();
    render();
  }
}

// =============================================================================
// API PÚBLICA
// =============================================================================

/** Arranca el selector sobre el host del componente (idempotente). */
export function iniciarSelectorMinimapaUbicacion(): void {
  const host = el(IDS.lienzo);
  if (!host || host.dataset.activo === 'true') return;
  host.dataset.activo = 'true';
  host.addEventListener('click', manejarClick);
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
    estado.planta = String(habitacion.piso || 'PRIMER_PISO');
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
  if (habitacion) estado.planta = String(habitacion.piso || 'PRIMER_PISO');
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

