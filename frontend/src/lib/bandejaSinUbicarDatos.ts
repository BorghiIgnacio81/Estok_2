// =============================================================================
// CAPA DE DATOS DE LA CANASTA «ELEMENTOS POR UBICAR»
// -----------------------------------------------------------------------------
// Consulta, normalización y purga estructural de los bultos de la canasta.
// Se extrajo de bandejaSinUbicar.ts (Lote 28) para sostener el límite de 400
// líneas por archivo (misma disciplina que moverContenedorMinimapasDatos.ts) y
// para aislar el I/O de la capa de render.
//
// El SERVIDOR es la autoridad de la regla (PostgreSQL: whitelist física +
// recuperabilidad + RESCATE de cajas mudadas al limbo). Acá solo se normaliza
// el payload y se re-verifica en profundidad con `esBultoMovibleDeBandeja`
// (defensa en profundidad sobre el ORM).
//
// Auth centralizada: getAuthHeaders()/API_BASE_URL desde src/services/auth.
// =============================================================================

import { getAuthHeaders, API_BASE_URL, normalizarUrlApi } from '../services/auth';
import { esBultoMovibleDeBandeja } from './taxonomiaContenedor';

export interface ContenedorBandeja {
  id: string;
  nombre: string;
  tipo: string;
  es_inmueble: boolean;
  /** DECLARACIÓN EXPLÍCITA del operador: `false` = arquitectura, fuera de la canasta. */
  declarado_movible: boolean;
  /** Sub-divisiones propias: una caja con hijos es estructura, no bulto. */
  subcontenedores_count: number;
  ubicacion: string | null;
  /** Nombre de la habitación real que la aloja (limbo de mudanza incluido). */
  ubicacion_nombre: string | null;
  /** Contenedor padre: `null` = raíz suelta, tal como la deja la mudanza. */
  parent_contenedor: string | null;
  /** Geometría del plano: si tiene coordenadas propias es arquitectura fija. */
  ui_left: string | null;
  ui_top: string | null;
  ui_height: string | null;
}

export interface ObjetoBandeja {
  id: string;
  nombre: string;
  contenedor: string | null;
  ubicacion: string | null;
  deleted_at: string | null;
}

/** Bultos ya normalizados y purgados de la canasta (salida de la capa de datos). */
export interface DatosBandeja {
  contenedores: ContenedorBandeja[];
  objetos: ObjetoBandeja[];
}

/** Pagina el endpoint hasta agotar `next` (la 1ª llamada pide page_size=1000). */
async function fetchTodos(url: string): Promise<Record<string, unknown>[]> {
  const todos: Record<string, unknown>[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return todos;
    }
    if (!res.ok) return todos;
    const data = await res.json();
    todos.push(...(data.results || data));
    nextUrl = normalizarUrlApi(data.next);
  }
  return todos;
}

function normalizarContenedor(c: Record<string, unknown>): ContenedorBandeja {
  return {
    id: String(c.id),
    nombre: String(c.nombre || 'Contenedor'),
    tipo: String(c.tipo || '').toUpperCase(),
    es_inmueble: Boolean(c.es_inmueble),
    // Lote 25 · default False: SOLO un True explícito cuenta como movible. Un
    // valor ausente/null/undefined se trata como False (arquitectura). La purga
    // por declaración explícita también se re-verifica en el cliente.
    declarado_movible: c.declarado_movible === true,
    subcontenedores_count: Number(c.subcontenedores_count) || 0,
    ubicacion: c.ubicacion != null ? String(c.ubicacion) : null,
    // Lote 28 · LIMBO: el nombre de la habitación viaja normalizado para poder
    // distinguir la zona «En Tránsito» de un cuarto físico del plano.
    ubicacion_nombre: c.ubicacion_nombre != null ? String(c.ubicacion_nombre) : null,
    // Raíz suelta (`null`) = así la deja la mudanza en el limbo (rescate).
    parent_contenedor: c.parent_contenedor != null ? String(c.parent_contenedor) : null,
    // Geometría del plano: la purga de arquitectura fija la necesita EN EL
    // CLIENTE (`esBultoMovibleDeBandeja`), así que viaja normalizada.
    ui_left: c.ui_left != null ? String(c.ui_left) : null,
    ui_top: c.ui_top != null ? String(c.ui_top) : null,
    ui_height: c.ui_height != null ? String(c.ui_height) : null,
  };
}

function normalizarObjeto(o: Record<string, unknown>): ObjetoBandeja {
  return {
    id: String(o.id),
    nombre: String(o.nombre || 'Objeto'),
    contenedor: o.contenedor != null ? String(o.contenedor) : null,
    ubicacion: o.ubicacion != null ? String(o.ubicacion) : null,
    deleted_at: o.deleted_at != null ? String(o.deleted_at) : null,
  };
}

/**
 * Trae los bultos RECUPERABLES del Estok activo y los purga en profundidad.
 *
 * El servidor devuelve los candidatos (`?bandeja=true`, ver
 * `api/viewsets/organizacion/filtros_bandeja.py`); acá se descarta todo lo que
 * en el cliente siga siendo estructura (caja con sub-divisiones o con geometría
 * de plano) salvo el RESCATE de las cajas raíz mudadas al limbo, que entra
 * siempre para que puedan editarse. Los objetos solo se limpian de borrados
 * lógicos (soft-delete): su regla ya viene resuelta por el servidor.
 */
export async function cargarDatosBandeja(): Promise<DatosBandeja> {
  const [contData, objData] = await Promise.all([
    fetchTodos(`${API_BASE_URL}/contenedores/?page_size=1000&bandeja=true`),
    fetchTodos(`${API_BASE_URL}/objetos/?page_size=1000&bandeja=true`),
  ]);
  const contenedores = (contData as Record<string, unknown>[])
    .map(normalizarContenedor)
    .filter(esBultoMovibleDeBandeja);
  const objetos = (objData as Record<string, unknown>[])
    .map(normalizarObjeto)
    .filter((o) => !o.deleted_at);
  return { contenedores, objetos };
}
