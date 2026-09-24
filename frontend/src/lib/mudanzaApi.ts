// =============================================================================
// CAPA DE DATOS DE LA MUDANZA INTER-ESTOK (DTOs + fetch paginado + mutación)
// -----------------------------------------------------------------------------
// Fuente ÚNICA del borde HTTP del módulo de mudanzas:
//   GET  /api/contenedores/ · /api/objetos/ · /api/ubicaciones/ → listados
//   POST /api/inventario/mudanza/                               → transferencia
//
// PAGINACIÓN OBLIGATORIA: la API responde por páginas (PAGE_SIZE global en 25) y
// varios endpoints ignoran `?page_size`. `listarTodo()` recorre `next` hasta
// agotar el listado, de modo que el tablero NUNCA pierda elementos en el
// camino (era la causa real de que "faltaran" objetos sueltos en el Origen).
// Auth centralizado: getAuthHeaders()/getToken() desde services/auth.
// =============================================================================

import { getAuthHeaders, getToken, normalizarUrlApi, API_BASE_URL } from '../services/auth';

// =============================================================================
// DTOs (respuestas de /api/ubicaciones/, /api/contenedores/ y /api/objetos/)
// =============================================================================

export interface UbicacionDto {
  id: string;
  nombre: string;
  piso?: string;
  parent_ubicacion?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  objetos_count?: number;
  contenedores_count?: number;
  sububicaciones_count?: number;
}

export interface ContenedorDto {
  id: string;
  nombre: string;
  ubicacion?: string | null;
  procedencia_nombre?: string | null;
  parent_contenedor?: string | null;
  tipo?: string;
  es_inmueble?: boolean;
  objetos_count?: number;
  subcontenedores_count?: number;
  foto?: string | null;
}

export interface ObjetoDto {
  id: string;
  nombre: string;
  estok?: string | null;
  ubicacion?: string | null;
  ubicacion_nombre?: string | null;
  contenedor?: string | null;
  contenedor_nombre?: string | null;
  objeto_padre?: string | null;
  es_contenedor?: boolean;
  categoria_nombre?: string | null;
  foto_principal?: string | null;
  deleted_at?: string | null;
}

/** Elemento arrastrable: el `origen` indica la FK que espera el endpoint. */
export interface ItemMudanza {
  id: string;
  origen: 'contenedor' | 'objeto';
  nombre: string;
}

/** Destino elegido en la columna derecha. */
export interface DestinoMudanza {
  /** Zona «En Tránsito»: viaja al Estok destino SIN ubicación física. */
  enTransito: boolean;
  /** Habitación receptora (suelta a gran escala). */
  ubicacionId?: string | null;
  /** Mueble/estante/espacio del destino (suelta fina dentro de él). */
  contenedorId?: string | null;
}

export interface ResultadoMudanza {
  ok: boolean;
  mensaje: string;
}

/** Tope de seguridad para no entrar en bucle si la API devolviera un `next` fijo. */
const MAX_PAGINAS = 60;


/** Headers multi-tenant del Estok indicado (columna Origen o Destino). */
export function headersParaEstok(estokId: string): Record<string, string> {
  const token = getToken();
  return token
    ? { Authorization: `Bearer ${token}`, 'X-Estok-Id': estokId }
    : { 'X-Estok-Id': estokId };
}

/** Listado COMPLETO de un endpoint, siguiendo la paginación de DRF hasta el final. */
export async function listarTodo<T>(url: string, estokId: string): Promise<T[]> {
  const todos: T[] = [];
  let siguiente: string | null = url;
  let paginas = 0;

  while (siguiente && paginas < MAX_PAGINAS) {
    const response = await fetch(siguiente, { headers: headersParaEstok(estokId) });
    if (response.status === 401) {
      window.location.href = '/login';
      throw new Error('Sesión expirada.');
    }
    if (!response.ok) throw new Error(`Error al consultar el inventario (${response.status}).`);
    const data = await response.json();
    if (Array.isArray(data)) {
      todos.push(...(data as T[]));
      break;
    }
    todos.push(...((data.results || []) as T[]));
    siguiente = normalizarUrlApi(data.next);
    paginas += 1;
  }
  return todos;
}

/**
 * Inventario MÓVIL del Estok origen: cajas/muebles móviles + la TOTALIDAD de los
 * objetos individuales sueltos.
 *
 * `incluir_sin_estok=true`: suma los objetos físicamente presentes en el Estok
 * cuya FK `estok` quedó nula (huérfanos de carga/legacy) pero que cuelgan de una
 * habitación del inquilinato. Sin esa bandera, objetos reales quedaban fuera.
 */
export async function cargarInventarioOrigen(
  estokId: string,
): Promise<{ contenedores: ContenedorDto[]; objetos: ObjetoDto[] }> {
  const [contenedores, objetos] = await Promise.all([
    listarTodo<ContenedorDto>(`${API_BASE_URL}/contenedores/?page_size=1000`, estokId),
    listarTodo<ObjetoDto>(`${API_BASE_URL}/objetos/?page_size=1000&incluir_sin_estok=true`, estokId),
  ]);
  return { contenedores, objetos };
}

/** Plano receptor del Estok destino: habitaciones + sus muebles y estantes. */
export async function cargarPlanoDestino(
  estokId: string,
): Promise<{ ubicaciones: UbicacionDto[]; contenedores: ContenedorDto[] }> {
  const [ubicaciones, contenedores] = await Promise.all([
    listarTodo<UbicacionDto>(`${API_BASE_URL}/ubicaciones/?page_size=1000`, estokId),
    listarTodo<ContenedorDto>(`${API_BASE_URL}/contenedores/?page_size=1000`, estokId),
  ]);
  return { ubicaciones, contenedores };
}

/**
 * Ejecuta la transferencia transaccional (POST /api/inventario/mudanza/).
 * No lanza excepciones de negocio: devuelve `{ ok, mensaje }` para que el
 * tablero decida el aviso y el refresco.
 */
export async function enviarMudanza(
  item: ItemMudanza,
  estokDestinoId: string,
  destino: DestinoMudanza,
): Promise<ResultadoMudanza> {
  const body: Record<string, unknown> = { estok_destino_id: estokDestinoId };
  if (destino.enTransito) body.en_transito = true;
  else if (destino.contenedorId) body.contenedor_destino_id = destino.contenedorId;
  else body.ubicacion_destino_id = destino.ubicacionId;
  if (item.origen === 'contenedor') body.contenedor_id = item.id;
  else body.objeto_id = item.id;

  const response = await fetch(`${API_BASE_URL}/inventario/mudanza/`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Sesión expirada.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, mensaje: data?.error || `Error del servidor (${response.status}).` };
  }
  return { ok: true, mensaje: data?.mensaje || '✅ Mudanza completada.' };
}
