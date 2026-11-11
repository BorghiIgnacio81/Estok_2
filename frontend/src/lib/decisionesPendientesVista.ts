// =============================================================================
// VISTA DE LA SECCIÓN 4 · ⏳ OBJETOS PENDIENTES DE DECISIÓN
// -----------------------------------------------------------------------------
// Pintado de los DOS sub-acordeones del tablero /alertas-stock:
//
//   a) «🙋 Pendientes de MI decisión»         → objeto.dueno_id === usuario
//   b) «👥 Pendientes de la decisión de OTROS» → resto (incluye «Avisar al
//      propietario» y los objetos sin dueño, cuya decisión se vota)
//
// Mantiene los badges de los encabezados, los estados de carga/error/vacío y las
// dos grillas. Es una capa 100% de presentación: NO hace fetch ni decide nada
// por su cuenta (la regla de propiedad es lib/decisionesPropiedad.ts).
//
// Vive aparte de lib/decisionesPendientes.ts (orquestación + API) para mantener
// los módulos por debajo del límite de modularidad del proyecto.
// =============================================================================

import { refOpcional } from './dom';
import type { ObjetoDecision } from './decisionesTarjeta';
import { modoDecisionObjeto } from './decisionesPropiedad';

/** Estado mínimo que necesita la vista. */
export interface EstadoVistaPendientes {
  objetos: ObjetoDecision[];
  cargando: boolean;
  error: string | null;
}

/** Reparto de los pendientes según la REGLA DE PROPIEDAD del objeto. */
export interface GruposPendientes {
  propios: ObjetoDecision[];
  ajenos: ObjetoDecision[];
}

/**
 * Reparte los pendientes en los DOS sub-acordeones.
 *
 *   · propios → el objeto es del usuario autenticado (`dueno_id === usuario`):
 *               le corresponde a él decidir (Vender / Conservar / Tirar).
 *   · ajenos  → objetos de OTROS miembros y objetos SIN propietario (la
 *               decisión es del grupo y se propone con votación). Cada tarjeta
 *               conserva su botón correcto (`lib/decisionesBotonera.ts`).
 */
export function dividirPorPropiedad(objetos: ObjetoDecision[]): GruposPendientes {
  const propios: ObjetoDecision[] = [];
  const ajenos: ObjetoDecision[] = [];
  for (const obj of objetos) {
    (modoDecisionObjeto(obj) === 'propietario' ? propios : ajenos).push(obj);
  }
  return { propios, ajenos };
}

/** Actualiza un badge numérico (se oculta cuando vale 0). */
export function fijarContador(id: string, valor: number): void {
  const contador = refOpcional(id);
  if (!contador) return;
  contador.textContent = String(valor);
  contador.classList.toggle('hidden', valor === 0);
}

/** Refresca los TRES badges (total + mis pendientes + pendientes de otros). */
export function actualizarContadores(objetos: ObjetoDecision[]): void {
  const { propios, ajenos } = dividirPorPropiedad(objetos);
  fijarContador('pendientesCount', objetos.length);
  fijarContador('pendientesPropiosCount', propios.length);
  fijarContador('pendientesAjenosCount', ajenos.length);
}

/** Pinta una sub-grilla y su mensaje de vacío. */
export function pintarGrupo(
  gridId: string,
  vacioId: string,
  objetos: ObjetoDecision[],
  ocupado: boolean,
  tarjeta: (objeto: ObjetoDecision) => string,
): void {
  refOpcional(vacioId)?.classList.toggle('hidden', ocupado || objetos.length > 0);
  const grid = refOpcional(gridId);
  if (!grid) return;
  grid.classList.toggle('hidden', ocupado || objetos.length === 0);
  grid.innerHTML = ocupado ? '' : objetos.map(tarjeta).join('');
}

/** Render completo de la sección (badges + estados + dos grillas). */
export function renderPendientes(
  estado: EstadoVistaPendientes,
  tarjeta: (objeto: ObjetoDecision) => string,
): void {
  const host = refOpcional('seccionPendientes');
  if (!host) return;

  const ocupado = estado.cargando || Boolean(estado.error);

  refOpcional('loadingState')?.classList.toggle('hidden', !estado.cargando);
  refOpcional('errorState')?.classList.toggle('hidden', !estado.error);
  refOpcional('emptyState')?.classList.toggle(
    'hidden',
    ocupado || estado.objetos.length > 0,
  );

  const mensajeError = refOpcional('errorMessage');
  if (mensajeError && estado.error) mensajeError.textContent = estado.error;

  const { propios, ajenos } = dividirPorPropiedad(estado.objetos);
  actualizarContadores(estado.objetos);
  pintarGrupo('pendientesPropiosGrid', 'pendientesPropiosVacio', propios, ocupado, tarjeta);
  pintarGrupo('pendientesAjenosGrid', 'pendientesAjenosVacio', ajenos, ocupado, tarjeta);
}
