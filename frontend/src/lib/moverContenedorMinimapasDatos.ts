// =============================================================================
// DATOS DEL ASISTENTE DE MOVIMIENTO POR MINIMAPAS (estructura espacial real)
// -----------------------------------------------------------------------------
// Capa de DATOS del modal «Mover»: carga una sola vez el plano real del Estok
// activo (config del inmueble, ambientes con geometría ui_* y TODOS los
// contenedores, incluidas las cajas anidadas dentro de muebles) y resuelve las
// derivaciones puras que necesita la navegación en cascada:
//
//   · ambientes REALES de la planta activa (mismo mapeo canónico de la app),
//   · muebles/cajas raíz de un ambiente,
//   · cajas internas de un mueble,
//   · guarda anti-ciclos: un contenedor jamás se ofrece como destino de su
//     propio subárbol (mismo blindaje que el Drag & Drop de Almacenamiento).
//
// Multi-tenant: fetchAllPages consume la auth centralizada (JWT + X-Estok-Id).
// No dibuja ni toca el DOM: 100% datos + derivaciones.
// =============================================================================

import { fetchAllPages } from './api';
import { getEstokActivoId } from '../services/auth';
import { dividirEspacios, filaDeUbicacion, habitacionesDeFila } from './espaciosDePlanta';
import type { EstokConfig, UbicacionPlano } from './mapaJerarquico';

/** Contenedor que el asistente va a reubicar (caja o mueble del listado). */
export interface ContenedorMover {
  id: string;
  nombre: string;
  /** Ambiente (habitación) donde vive hoy: punto de partida del recorrido. */
  ubicacion?: string | null;
}

/** Contenedor destino candidato, con su geometría real de PostgreSQL. */
export interface ContenedorDestino {
  id: string;
  nombre: string;
  tipo: string;
  ubicacion: string | null;
  parent_contenedor: string | null;
  ui_left?: string | null;
  ui_top?: string | null;
  ui_width?: string | null;
  ui_height?: string | null;
}

/** Estructura espacial real del Estok activo, lista para navegar. */
export interface EstructuraMover {
  estok: EstokConfig | null;
  ubicaciones: UbicacionPlano[];
  contenedores: ContenedorDestino[];
  /** FILA (1-based) de la planta activa de arranque. */
  planta: number;
}

/** Normaliza el contenedor crudo de la API a IDs string y taxonomía en mayúsculas. */
function normalizarContenedor(crudo: ContenedorDestino): ContenedorDestino {
  return {
    ...crudo,
    id: String(crudo.id),
    tipo: String(crudo.tipo || 'CAJA').toUpperCase(),
    ubicacion: crudo.ubicacion != null ? String(crudo.ubicacion) : null,
    parent_contenedor: crudo.parent_contenedor != null ? String(crudo.parent_contenedor) : null,
  };
}

/**
 * Ambiente real del contenedor que se mueve: su propia ubicación o, si es una
 * pieza anidada sin ubicación denormalizada, la del primer ancestro con una.
 */
function ambienteDe(estructura: EstructuraMover, contenedor: ContenedorMover): UbicacionPlano | undefined {
  const porId = new Map(estructura.contenedores.map((c) => [c.id, c]));
  const propio = porId.get(contenedor.id);
  let id: string | null = contenedor.ubicacion || propio?.ubicacion || null;
  let actual = propio;
  const visitados = new Set<string>();
  while (!id && actual && !visitados.has(actual.id)) {
    visitados.add(actual.id);
    actual = actual.parent_contenedor ? porId.get(actual.parent_contenedor) : undefined;
    id = actual?.ubicacion || null;
  }
  return id ? estructura.ubicaciones.find((u) => String(u.id) === String(id)) : undefined;
}

/** Carga el árbol espacial íntegro del Estok activo (una pasada por recurso). */
export async function cargarEstructuraMover(contenedor: ContenedorMover): Promise<EstructuraMover> {
  const [estoks, ubicaciones, contenedores] = await Promise.all([
    fetchAllPages<EstokConfig>('/estoks/', { page_size: '1000' }),
    fetchAllPages<UbicacionPlano>('/ubicaciones/', { page_size: '1000' }),
    fetchAllPages<ContenedorDestino>('/contenedores/', { page_size: '1000' }),
  ]);

  const activoId = getEstokActivoId();
  const estructura: EstructuraMover = {
    estok: estoks.find((e) => String(e.id) === String(activoId)) || estoks[0] || null,
    ubicaciones,
    contenedores: contenedores.map(normalizarContenedor),
    planta: 1,
  };
  estructura.planta = filaDeUbicacion(
    dividirEspacios(estructura.ubicaciones).divisiones,
    ambienteDe(estructura, contenedor),
  );
  return estructura;
}

/** Ambientes REALES de una planta (habitaciones encastradas + sueltas legacy). */
export function ambientesDePlanta(estructura: EstructuraMover, planta: number): UbicacionPlano[] {
  return habitacionesDeFila(dividirEspacios(estructura.ubicaciones), planta);
}

/**
 * ¿`candidatoId` es el contenedor móvil o un descendiente suyo? Bloquea mover
 * una pieza dentro de sí misma o de su propio subárbol.
 */
export function esDescendiente(
  estructura: EstructuraMover,
  contenedorId: string,
  candidatoId: string,
): boolean {
  const padres = new Map(estructura.contenedores.map((c) => [c.id, c.parent_contenedor]));
  let cursor: string | null | undefined = candidatoId;
  const visitados = new Set<string>();
  while (cursor && !visitados.has(cursor)) {
    if (cursor === contenedorId) return true;
    visitados.add(cursor);
    cursor = padres.get(cursor);
  }
  return false;
}

/** Muebles y cajas RAÍZ de un ambiente (sin el contenedor móvil ni su subárbol). */
export function contenedoresDelAmbiente(
  estructura: EstructuraMover,
  ubicacionId: string | null,
  contenedorId: string,
): ContenedorDestino[] {
  if (!ubicacionId) return [];
  return estructura.contenedores.filter(
    (c) =>
      c.ubicacion === ubicacionId &&
      !c.parent_contenedor &&
      !esDescendiente(estructura, contenedorId, c.id),
  );
}

/** Cajas internas de un mueble (sin el contenedor móvil ni su subárbol). */
export function cajasDelMueble(
  estructura: EstructuraMover,
  muebleId: string | null,
  contenedorId: string,
): ContenedorDestino[] {
  if (!muebleId) return [];
  return estructura.contenedores.filter(
    (c) => c.parent_contenedor === muebleId && !esDescendiente(estructura, contenedorId, c.id),
  );
}
