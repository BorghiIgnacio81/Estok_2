// =============================================================================
// REUBICACIÓN DE UNA CAJA YA CREADA (fuente ÚNICA de las dos mutaciones)
// -----------------------------------------------------------------------------
// Permite desvincular o mover una CAJA existente —incluidas las que quedaron
// guardadas por error como una división física de un cuarto— sin depender del
// arrastre:
//
//   · «🚚 Cajas en Tránsito» → POST /api/contenedores/{id}/en_transito/
//     (endpoint canónico: libera `parent_contenedor` y el casillero, y deja la
//     caja como raíz suelta en la habitación VIRTUAL «En Tránsito»).
//   · Un ESPACIO / HABITACIÓN   → PUT /api/contenedores/{id}/ { ubicacion }
//   · Un MUEBLE / ESTANTE / CAJA → PUT /api/contenedores/{id}/ { parent_contenedor }
//     (el backend re-ancla la ubicación desde el padre y rechaza ciclos).
//
// La consumen:
//   · lib/bandejaSinUbicar.ts                  (soltar una caja sobre la canasta)
//   · lib/mapa/portales/accionesCajaPortales.ts (selector «📍 Mover caja a…»)
//
// Auth 100% centralizada (getAuthHeaders/API_BASE_URL de services/auth): acá NO
// se define ninguna versión propia. La lectura de destinos es de sólo lectura y
// se cachea unos segundos para no repetir dos GET por cada repintado del panel.
// =============================================================================

import {
  API_BASE_URL,
  getAuthHeaders,
  getEstokActivoId,
} from '../services/auth';
import { esHabitacionLimbo } from './taxonomiaContenedor';

/** Valor del selector que representa el limbo de mudanza (sin espacio fijo). */
export const DESTINO_TRANSITO = '__transito__';

/** Resultado uniforme de las mutaciones (el toast lo decide el consumidor). */
export interface ResultadoReubicacion {
  ok: boolean;
  mensaje: string;
}

/** Grupo de un destino: pinta las <optgroup> del selector. */
export type GrupoDestino = 'transito' | 'espacio' | 'mueble';

/** Opción del selector «📍 Mover caja a…». */
export interface DestinoCaja {
  /** `__transito__`, `u:<uuid>` (ubicación) o `c:<uuid>` (contenedor). */
  valor: string;
  etiqueta: string;
  grupo: GrupoDestino;
}

/** Forma mínima de una Ubicación del listado (`/ubicaciones/`). */
interface UbicacionDto {
  id: string;
  nombre: string;
  es_espacio_virtual?: boolean;
}

/** Forma mínima de un Contenedor del listado (`/contenedores/`). */
interface ContenedorDto {
  id: string;
  nombre: string;
  tipo?: string;
  parent_contenedor?: string | null;
  ubicacion_nombre?: string | null;
}

/** Una sola consulta de destinos por Estok cada 30 s (el panel repinta mucho). */
let cacheDestinos: { estok: string | null; at: number; lista: DestinoCaja[] } | null = null;
const CACHE_MS = 30_000;

/** Latido global: tablero, visores, canasta y /objetos se repintan sin F5. */
function avisarCambios(id: string): void {
  window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
  window.dispatchEvent(new CustomEvent('estok:objetos-cambiados', { detail: { id } }));
}

/** Mensaje legible de un error DRF (detail / error / campos / texto plano). */
function mensajeDeError(datos: unknown, porDefecto: string): string {
  if (!datos) return porDefecto;
  if (typeof datos === 'string') return datos;
  const cuerpo = datos as Record<string, unknown>;
  const directo = cuerpo.detail || cuerpo.error || cuerpo.non_field_errors;
  if (directo) return String(Array.isArray(directo) ? directo[0] : directo);
  const claves = Object.keys(cuerpo);
  if (!claves.length) return porDefecto;
  return claves
    .map((clave) => {
      const valor = cuerpo[clave];
      return `${clave}: ${String(Array.isArray(valor) ? valor[0] : valor)}`;
    })
    .join(', ');
}


/**
 * Envía la caja al limbo de mudanza («Cajas en Tránsito»).
 * Idempotente en el backend: si ya estaba allí devuelve su propio mensaje.
 */
export async function enviarCajaATransito(id: string): Promise<ResultadoReubicacion> {
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/${id}/en_transito/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return { ok: false, mensaje: 'Sesión vencida.' };
    }
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        mensaje: mensajeDeError(datos, 'No se pudo enviar la caja a «Cajas en Tránsito».'),
      };
    }
    avisarCambios(id);
    return {
      ok: true,
      mensaje: String(
        datos?.mensaje ||
          '🚚 Caja enviada a «Cajas en Tránsito»: reubicala cuando quieras.',
      ),
    };
  } catch {
    return { ok: false, mensaje: 'Error de conexión al enviar la caja a «En Tránsito».' };
  }
}

/**
 * Mueve la caja a un destino del selector.
 *
 * `destino` usa el contrato de `DestinoCaja.valor`. Un espacio físico viaja como
 * `ubicacion` (la caja queda raíz del cuarto) y un mueble/estante/caja viaja como
 * `parent_contenedor` (la caja queda DENTRO, sin tocar la arquitectura).
 */
export async function moverCajaADestino(
  id: string,
  destino: string,
): Promise<ResultadoReubicacion> {
  if (!destino) return { ok: false, mensaje: 'Elegí un destino para la caja.' };
  if (destino === DESTINO_TRANSITO) return enviarCajaATransito(id);

  const separador = destino.indexOf(':');
  const clase = separador > 0 ? destino.slice(0, separador) : '';
  const uuid = separador > 0 ? destino.slice(separador + 1) : '';
  if (!uuid || (clase !== 'u' && clase !== 'c')) {
    return { ok: false, mensaje: 'El destino elegido no es válido.' };
  }

  // Un espacio físico se asigna como ubicación (mismo contrato del Drop:
  // `parent_contenedor` y casillero nulos); un mueble/estante/caja viaja como
  // contenedor padre SIN casillero fino (el backend hereda la habitación del
  // padre, deriva «En Tránsito Interno» si corresponde y rechaza ciclos).
  const cuerpo =
    clase === 'u'
      ? {
          ubicacion: uuid,
          parent_contenedor: null,
          parent_grid_row: null,
          parent_grid_col: null,
        }
      : { parent_contenedor: uuid, parent_grid_row: null, parent_grid_col: null };
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/${id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return { ok: false, mensaje: 'Sesión vencida.' };
    }
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, mensaje: mensajeDeError(datos, 'No se pudo reubicar la caja.') };
    }
    avisarCambios(id);
    return { ok: true, mensaje: '📍 Caja reubicada correctamente.' };
  } catch {
    return { ok: false, mensaje: 'Error de conexión al reubicar la caja.' };
  }
}

/** Listado completo (tope 1000 de `EstokPaginacion`) con auth centralizada. */
async function leerListado<T>(ruta: string): Promise<T[]> {
  const res = await fetch(`${API_BASE_URL}${ruta}`, { headers: getAuthHeaders() });
  if (res.status === 401) {
    window.location.href = '/login';
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json();
  return ((data.results || data || []) as T[]).filter(Boolean);
}

/**
 * Destinos posibles para reubicar la caja indicada.
 *
 * Se excluyen: el limbo como espacio físico, la propia caja y TODA su
 * descendencia (el backend rechaza ciclos jerárquicos), y los muebles que ya
 * viven en el limbo (no tienen ubicación física real).
 */
export async function listarDestinosCaja(cajaId: string): Promise<DestinoCaja[]> {
  const estok = getEstokActivoId();
  if (cacheDestinos && cacheDestinos.estok === estok && Date.now() - cacheDestinos.at < CACHE_MS) {
    return cacheDestinos.lista;
  }

  const [ubicaciones, contenedores] = await Promise.all([
    leerListado<UbicacionDto>('/ubicaciones/?page_size=1000'),
    leerListado<ContenedorDto>('/contenedores/?page_size=1000'),
  ]);

  // SUBÁRBOL PROHIBIDO: ni la caja ni sus descendientes pueden ser su destino.
  const hijosPorPadre = new Map<string, string[]>();
  for (const c of contenedores) {
    if (!c.parent_contenedor) continue;
    const lista = hijosPorPadre.get(c.parent_contenedor) ?? [];
    lista.push(String(c.id));
    hijosPorPadre.set(c.parent_contenedor, lista);
  }
  const prohibidos = new Set<string>([String(cajaId)]);
  const cola = [String(cajaId)];
  while (cola.length) {
    const padre = cola.pop() as string;
    for (const hijo of hijosPorPadre.get(padre) ?? []) {
      if (prohibidos.has(hijo)) continue;
      prohibidos.add(hijo);
      cola.push(hijo);
    }
  }

  const espacios: DestinoCaja[] = ubicaciones
    .filter((u) => u && !u.es_espacio_virtual)
    .map((u) => ({
      valor: `u:${String(u.id)}`,
      etiqueta: String(u.nombre),
      grupo: 'espacio' as const,
    }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));

  const muebles: DestinoCaja[] = contenedores
    .filter((c) => {
      if (!c || prohibidos.has(String(c.id))) return false;
      // Una pieza del limbo no es un destino físico: ya está sin ubicación.
      return !esHabitacionLimbo(c.ubicacion_nombre);
    })
    .map((c) => {
      const icono = String(c.tipo || '').toUpperCase() === 'CAJA' ? '📦' : '🗄️';
      const donde = c.ubicacion_nombre ? ` · ${String(c.ubicacion_nombre)}` : '';
      return {
        valor: `c:${String(c.id)}`,
        etiqueta: `${icono} ${String(c.nombre)}${donde}`,
        grupo: 'mueble' as const,
      };
    })
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));

  const lista: DestinoCaja[] = [
    {
      valor: DESTINO_TRANSITO,
      etiqueta: '🚚 Cajas en Tránsito (sin ubicación fija)',
      grupo: 'transito',
    },
    ...espacios,
    ...muebles,
  ];
  cacheDestinos = { estok, at: Date.now(), lista };
  return lista;
}

/** Invalida la caché de destinos (alta/baja/renombre de espacios o muebles). */
export function olvidarDestinosCaja(): void {
  cacheDestinos = null;
}

