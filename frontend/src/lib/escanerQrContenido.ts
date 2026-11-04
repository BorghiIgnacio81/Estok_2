// =============================================================================
// CONTENIDO DE UN QR · CAPA DE DATOS (contenedor/objeto + ruta de ubicación)
// -----------------------------------------------------------------------------
// Fuente ÚNICA de las consultas que hace el escáner del Dashboard para mostrar,
// en pantalla y sin navegar, el CONTENIDO de una caja y su RUTA COMPLETA:
//
//   GET /api/contenedores/<id>/            → nombre, descripción, padre, ubicación
//   GET /api/contenedores/?padre=<id>      → sub-cajas contenidas
//   GET /api/objetos/?contenedor=<id>      → objetos contenidos (con su ficha)
//   GET /api/objetos/<id>/                 → ficha de un objeto escaneado
//
// La ruta se arma subiendo por `parent_contenedor` (máximo 5 niveles) porque el
// serializer sólo expone `procedencia_nombre` = padre inmediato. Cada ancestro
// se memoriza para no repetir consultas sobre la misma sesión de escaneo.
// Ninguna función lanza: devuelven `null` y el modal muestra el aviso.
// =============================================================================

import { API_BASE_URL } from '../services/auth';
import { fetchQrConTimeout } from './qrComun';

/** Tope de ancestros que se recorren para armar la ruta de ubicación. */
const PROFUNDIDAD_MAXIMA = 5;
/** Filas por página al traer el contenido del contenedor escaneado. */
const FILAS_POR_PAGINA = 50;

/** Contrato mínimo del contenedor que devuelve /api/contenedores/<id>/. */
export interface ContenedorApi {
  id: string;
  nombre: string;
  descripcion?: string | null;
  ubicacion_nombre?: string | null;
  parent_contenedor?: string | null;
  objetos_count?: number;
  subcontenedores_count?: number;
}

/** Contrato mínimo del objeto que devuelve /api/objetos/<id>/ o su listado. */
export interface ObjetoApi {
  id: string;
  nombre: string;
  categoria_nombre?: string | null;
  valor_estimado?: string | number | null;
  ubicacion_display?: string | null;
  foto_principal?: string | null;
  fotos?: Array<{ imagen?: string; es_principal?: boolean }>;
}

/** Contenido completo de una caja/contenedor. */
export interface ContenidoContenedor {
  subcontenedores: ContenedorApi[];
  objetos: ObjetoApi[];
}

/** Caja resuelta lista para pintar: datos + ruta completa + contenido. */
export interface ContenedorResuelto {
  contenedor: ContenedorApi;
  ruta: string;
  contenido: ContenidoContenedor;
}

/** Memoria de contenedores ya consultados (evita repetir la cadena de padres). */
const cacheContenedores = new Map<string, ContenedorApi>();

/** GET autenticado tolerante a fallos: `null` en error de red o HTTP != 2xx. */
async function pedirJson<T>(url: string, ms = 6000): Promise<T | null> {
  try {
    const res = await fetchQrConTimeout(url, ms);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Normaliza listados paginados ({ results }) o planos ([]). */
function filasDe<T>(data: { results?: T[] } | T[] | null): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.results ?? [];
}

/**
 * RUTA DE UBICACIÓN COMPLETA: «Habitación › Mueble › Caja».
 * El primer tramo es la ubicación física del contenedor y después la cadena de
 * ancestros, de la raíz al propio contenedor.
 */
async function rutaCompletaContenedor(contenedor: ContenedorApi): Promise<string> {
  const nombres: string[] = [];
  let actual: ContenedorApi | null = contenedor;

  for (let nivel = 0; actual && nivel <= PROFUNDIDAD_MAXIMA; nivel += 1) {
    if (actual.nombre) nombres.unshift(actual.nombre);
    const padreId: string | null = actual.parent_contenedor ?? null;
    if (!padreId) break;

    let padre: ContenedorApi | null = cacheContenedores.get(padreId) ?? null;
    if (!padre) {
      padre = await pedirJson<ContenedorApi>(`${API_BASE_URL}/contenedores/${padreId}/`, 4000);
      if (!padre) break;
      cacheContenedores.set(padreId, padre);
    }
    actual = padre;
  }

  const ubicacion = (contenedor.ubicacion_nombre || '').trim();
  if (ubicacion) nombres.unshift(ubicacion);
  return nombres.join(' › ');
}

/** Sub-cajas + objetos contenidos en la caja escaneada (una sola tanda). */
async function cargarContenidoContenedor(id: string): Promise<ContenidoContenedor> {
  const [subs, objetos] = await Promise.all([
    pedirJson<{ results?: ContenedorApi[] } | ContenedorApi[]>(
      `${API_BASE_URL}/contenedores/?padre=${id}&page_size=${FILAS_POR_PAGINA}`,
    ),
    pedirJson<{ results?: ObjetoApi[] } | ObjetoApi[]>(
      `${API_BASE_URL}/objetos/?contenedor=${id}&page_size=${FILAS_POR_PAGINA}`,
    ),
  ]);
  return { subcontenedores: filasDe(subs), objetos: filasDe(objetos) };
}

/**
 * Resuelve una CAJA escaneada: datos, ruta de ubicación completa y contenido.
 * Devuelve `null` si el id no corresponde a un contenedor accesible.
 */
export async function resolverContenedor(id: string): Promise<ContenedorResuelto | null> {
  const contenedor = await pedirJson<ContenedorApi>(`${API_BASE_URL}/contenedores/${id}/`);
  if (!contenedor?.id) return null;

  cacheContenedores.set(contenedor.id, contenedor);
  const [ruta, contenido] = await Promise.all([
    rutaCompletaContenedor(contenedor),
    cargarContenidoContenedor(contenedor.id),
  ]);
  return { contenedor, ruta, contenido };
}

/** Resuelve la ficha de un OBJETO escaneado (incluye su ruta `ubicacion_display`). */
export async function resolverObjeto(id: string): Promise<ObjetoApi | null> {
  const objeto = await pedirJson<ObjetoApi>(`${API_BASE_URL}/objetos/${id}/`);
  return objeto?.id ? objeto : null;
}

/** Primera foto disponible de un objeto (listado o detalle). */
export function fotoDeObjeto(objeto: ObjetoApi): string {
  if (objeto.foto_principal) return objeto.foto_principal;
  const fotos = objeto.fotos ?? [];
  const principal = fotos.find((f) => f.es_principal && f.imagen) ?? fotos.find((f) => f.imagen);
  return principal?.imagen ?? '';
}

/** «$1.234,56» o «—» cuando el objeto no tiene valor estimado. */
export function formatearValor(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '—';
  return `$${numero.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}
