// =============================================================================
// FILTRO POR UBICACIÓN DEL LISTADO DE OBJETOS (/objetos)
// -----------------------------------------------------------------------------
// Capa 100% PURA (sin estado ni acceso al DOM): resuelve la ubicación física de
// CADA entidad del payload de GET /api/contenedores/arbol/ y devuelve un payload
// recortado a la HABITACIÓN/ESPACIO o al CONTENEDOR PADRE elegido en la barra de
// filtros.
//
// El recorte se hace en memoria sobre el payload YA cargado: el filtro responde
// en el acto (sin una consulta extra al backend) y los contadores de las
// secciones colapsables se recalculan en tiempo real.
//
// CONTEXTO GEOGRÁFICO (lo aporta `rutaCajaMinimapas.ts`, ya cargado por el
// listado): todas las ubicaciones del Estok y TODOS los contenedores —también
// las cajas anidadas— con su ubicación física y su contenedor padre. Con eso se
// resuelve la cadena contenedor → padre → … → ubicación sin N+1.
//
// ESPACIOS FUSIONADOS EN «L»: los tiles que comparten `fusion_grupo` son el
// MISMO ambiente. El índice los colapsa a un representante, así filtrar por el
// espacio también devuelve lo que está apoyado en cualquiera de sus partes.
// =============================================================================

import type {
  GrupoEstructura,
  NodoContenedor,
  ObjetoArbol,
  PayloadArbol,
} from './listadoObjetosPiezas';
import type { NodoCaja } from './rutaCajaMinimapas';

/** Naturaleza de la opción elegida en el combo «Filtro por Ubicación». */
export type TipoSeleccionUbicacion = 'todas' | 'ubicacion' | 'contenedor';

/** Selección normalizada del combo: `todas`, una ubicación o un contenedor. */
export interface SeleccionUbicacion {
  tipo: TipoSeleccionUbicacion;
  /** ID de la ubicación o del contenedor padre ('' cuando `tipo='todas'`). */
  id: string;
}

/** Contenedor mínimo que necesita el índice (lo satisface `ContenedorRuta`). */
export interface ContenedorFiltro {
  id: string;
  ubicacion: string | null;
  parent_contenedor: string | null;
}

/** Ubicación mínima que necesita el índice (lo satisface `UbicacionPlano`). */
export interface UbicacionFiltro {
  id: string;
  fusion_grupo?: string | null;
}

/** Índice espacial en memoria (contenedores + espacios fusionados). */
export interface IndiceFiltroUbicacion {
  /** ID del contenedor → ID de su contenedor padre (null si es raíz). */
  padre: Map<string, string | null>;
  /** ID del contenedor → ID de la ubicación física que ocupa. */
  ubicacion: Map<string, string | null>;
  /** ID de ubicación → representante de su espacio fusionado en «L». */
  grupoUbicacion: Map<string, string>;
}

/** Selección neutra (sin filtro). */
export const SIN_FILTRO_UBICACION: SeleccionUbicacion = { tipo: 'todas', id: '' };

// ---------------------------------------------------------------------------
// Selección del combo
// ---------------------------------------------------------------------------

/**
 * Traduce el `value` del combo (`''`, `u:<uuid>` o `c:<uuid>`) a una selección
 * tipada. Cualquier valor desconocido se interpreta como «todas».
 */
export function leerSeleccionUbicacion(
  valor: string | null | undefined,
): SeleccionUbicacion {
  const texto = String(valor || '').trim();
  if (texto.startsWith('u:') && texto.length > 2) {
    return { tipo: 'ubicacion', id: texto.slice(2) };
  }
  if (texto.startsWith('c:') && texto.length > 2) {
    return { tipo: 'contenedor', id: texto.slice(2) };
  }
  return { ...SIN_FILTRO_UBICACION };
}

/** Índice vacío: el filtro cae a la ubicación PROPIA de cada objeto. */
export function indiceFiltroVacio(): IndiceFiltroUbicacion {
  return {
    padre: new Map<string, string | null>(),
    ubicacion: new Map<string, string | null>(),
    grupoUbicacion: new Map<string, string>(),
  };
}

/**
 * Construye el índice espacial con los contenedores y las ubicaciones del Estok
 * activo. Una sola pasada por cada colección (cero consultas).
 */
export function construirIndiceFiltro(
  contenedores: ContenedorFiltro[],
  ubicaciones: UbicacionFiltro[],
): IndiceFiltroUbicacion {
  const indice = indiceFiltroVacio();

  for (const contenedor of contenedores || []) {
    if (!contenedor || contenedor.id === undefined || contenedor.id === null) continue;
    const id = String(contenedor.id);
    indice.padre.set(
      id,
      contenedor.parent_contenedor ? String(contenedor.parent_contenedor) : null,
    );
    indice.ubicacion.set(
      id,
      contenedor.ubicacion ? String(contenedor.ubicacion) : null,
    );
  }

  // Espacios fusionados en «L»: cada `fusion_grupo` se colapsa a UNA ubicación
  // representativa (el menor ID, igual criterio que el backend).
  const grupos = new Map<string, string[]>();
  for (const ubicacion of ubicaciones || []) {
    if (!ubicacion || ubicacion.id === undefined || ubicacion.id === null) continue;
    const grupo = String(ubicacion.fusion_grupo || '').trim();
    if (!grupo) continue;
    const ids = grupos.get(grupo) || [];
    ids.push(String(ubicacion.id));
    grupos.set(grupo, ids);
  }
  for (const ids of grupos.values()) {
    ids.sort();
    const representante = ids[0];
    for (const id of ids) indice.grupoUbicacion.set(id, representante);
  }

  return indice;
}

// ---------------------------------------------------------------------------
// Resolución espacial (interna)
// ---------------------------------------------------------------------------

/** ID representativo del espacio fusionado (o el mismo ID si no lo está). */
function representanteUbicacion(
  idUbicacion: string,
  indice: IndiceFiltroUbicacion,
): string {
  return indice.grupoUbicacion.get(idUbicacion) || idUbicacion;
}

/** Cadena de contenedores: el propio ID + todos sus ancestros. */
function cadenaContenedor(
  idContenedor: string | null | undefined,
  indice: IndiceFiltroUbicacion,
): string[] {
  const cadena: string[] = [];
  const visitados = new Set<string>();
  let actual = idContenedor ? String(idContenedor) : '';
  while (actual && !visitados.has(actual)) {
    visitados.add(actual);
    cadena.push(actual);
    const padre = indice.padre.get(actual);
    actual = padre ? String(padre) : '';
  }
  return cadena;
}

/** Ubicación física de una cadena de contenedores (el primero que la declare). */
function ubicacionDeContenedor(
  idContenedor: string | null | undefined,
  indice: IndiceFiltroUbicacion,
): string | null {
  for (const id of cadenaContenedor(idContenedor, indice)) {
    const ubicacion = indice.ubicacion.get(id);
    if (ubicacion) return representanteUbicacion(String(ubicacion), indice);
  }
  return null;
}

/** Ubicación de un OBJETO: la de su contenedor físico o, si no hay, la propia. */
function ubicacionDeObjeto(
  obj: ObjetoArbol,
  indice: IndiceFiltroUbicacion,
): string | null {
  const contenedor = obj && obj.contenedor ? String(obj.contenedor) : '';
  if (contenedor) {
    const ubicacion = ubicacionDeContenedor(contenedor, indice);
    if (ubicacion) return ubicacion;
  }
  const propia = obj && obj.ubicacion ? String(obj.ubicacion) : '';
  return propia ? representanteUbicacion(propia, indice) : null;
}

/** Ubicación de un nodo (caja/mueble): la propia o la de sus ancestros. */
function ubicacionDeNodo(
  nodo: { id?: string; ubicacion?: string | null },
  indice: IndiceFiltroUbicacion,
): string | null {
  const propia = nodo && nodo.ubicacion ? String(nodo.ubicacion) : '';
  if (propia) return representanteUbicacion(propia, indice);
  const id = nodo && nodo.id ? String(nodo.id) : '';
  return id ? ubicacionDeContenedor(id, indice) : null;
}

function objetoCoincide(
  obj: ObjetoArbol,
  seleccion: SeleccionUbicacion,
  indice: IndiceFiltroUbicacion,
): boolean {
  if (!obj) return false;
  if (seleccion.tipo === 'contenedor') {
    return cadenaContenedor(obj.contenedor, indice).includes(seleccion.id);
  }
  return ubicacionDeObjeto(obj, indice) === seleccion.id;
}

function cajaCoincide(
  caja: NodoCaja,
  seleccion: SeleccionUbicacion,
  indice: IndiceFiltroUbicacion,
): boolean {
  if (!caja) return false;
  if (seleccion.tipo === 'contenedor') {
    return cadenaContenedor(caja.id, indice).includes(seleccion.id);
  }
  return ubicacionDeNodo(caja, indice) === seleccion.id;
}

function nodoCoincide(
  nodo: NodoContenedor,
  seleccion: SeleccionUbicacion,
  indice: IndiceFiltroUbicacion,
  ubicacionGrupo: string,
): boolean {
  if (!nodo) return false;
  if (seleccion.tipo === 'contenedor') {
    return cadenaContenedor(nodo.id, indice).includes(seleccion.id);
  }
  return (ubicacionDeNodo(nodo, indice) || ubicacionGrupo) === seleccion.id;
}

// ---------------------------------------------------------------------------
// Recorte del payload
// ---------------------------------------------------------------------------

/**
 * Devuelve una COPIA del payload con las cuatro secciones recortadas a la
 * ubicación / contenedor padre elegido. Sin filtro devuelve el payload intacto.
 *
 * `filtros_activos` queda en `true` cuando hay una ubicación seleccionada: la
 * vista usa esa bandera para mostrar el aviso de «sin resultados» en lugar del
 * estado vacío del inventario.
 */
export function filtrarPayloadPorUbicacion(
  payload: PayloadArbol,
  seleccion: SeleccionUbicacion,
  indice?: IndiceFiltroUbicacion | null,
): PayloadArbol {
  if (!payload || !seleccion || seleccion.tipo === 'todas') return payload;
  const idx = indice || indiceFiltroVacio();

  const estructuras: GrupoEstructura[] = (payload.estructuras || [])
    .map((grupo) => {
      const ubicacionGrupo = grupo.ubicacion_id
        ? representanteUbicacion(String(grupo.ubicacion_id), idx)
        : '';
      return {
        ...grupo,
        contenedores: (grupo.contenedores || []).filter((nodo) =>
          nodoCoincide(nodo, seleccion, idx, ubicacionGrupo)),
      };
    })
    .filter((grupo) => grupo.contenedores.length > 0);

  const cajas = (payload.cajas || []).filter((caja) =>
    cajaCoincide(caja, seleccion, idx));
  const sueltos = (payload.sueltos || []).filter((obj) =>
    objetoCoincide(obj, seleccion, idx));
  const objetosEnContenedor = (payload.objetos_en_contenedor || []).filter((obj) =>
    objetoCoincide(obj, seleccion, idx));
  const mueblesObjetos = (payload.muebles_objetos || []).filter((obj) =>
    objetoCoincide(obj, seleccion, idx));

  return {
    ...payload,
    estructuras,
    cajas,
    sueltos,
    objetos_en_contenedor: objetosEnContenedor,
    muebles_objetos: mueblesObjetos,
    filtros_activos: true,
  };
}
