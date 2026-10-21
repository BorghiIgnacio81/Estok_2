// =============================================================================
// DUPLICAR ESPACIO / SUB-DIVISIÓN (copia exacta contigua)
// -----------------------------------------------------------------------------
// Crea en PostgreSQL una copia REAL del contenedor seleccionado dentro del nodo
// activo de la cascada, sin clonar stock: mismas dimensiones elásticas, mismo
// `tipo` taxonómico y misma configuración (`es_inmueble`, `espacio_unico`,
// `declarado_movible`, grilla interna y medidas físicas). La copia se ubica
// CONTIGUA al original (a la derecha, o abajo si no entra) con un pequeño aire
// entre ambas, y recibe un nombre incremental: «Cajón 1» → «Cajón 2».
//
// REGLAS QUE NO SE ROMPEN:
//   · `fusion_grupo` NUNCA se copia: la copia nace suelta (si heredara el grupo
//     se fundiría con la silueta en «L» original y no habría dos piezas).
//   · `parent_grid_row/col` no se replican: el casillero del padre es único y la
//     grilla fina se reasigna cuando el operador lo necesite.
//   · `crear_espejo: false` (igual que «➕ Crear Espacio»): una sub-división es
//     estructura del mapa, no un ítem de stock.
//
// Persistencia con auth centralizada (JWT + X-Estok-Id) desde services/auth.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../../../services/auth';
import { toast } from '../../mapaJerarquico';
import { pctValor } from '../../mapaPlantaUnica';
import type { ItemElastico } from '../../lienzoElastico';
import { cargarContenedores } from './datosNodosPortales';
import type { ContenedorDto } from './datosNodosPortales';
import type { NodoPortal } from './estadoPortales';

/** Aire (en % del lienzo) entre el original y su copia contigua. */
const SEPARACION = 2;

/** Geometría elástica en % del lienzo (misma cascada de defaults que `geoDe`). */
export interface GeometriaDuplicada {
  left: number;
  top: number;
  width: number;
  height: number;
}

const redondear = (n: number): number => Math.round(n * 100) / 100;

/**
 * Ubica la copia CONTIGUA al original: primero a la derecha (misma fila), luego
 * debajo, y como último recurso con un desplazamiento diagonal leve. Nunca sale
 * del lienzo (0..100 %).
 */
export function ubicarContigua(geo: GeometriaDuplicada): GeometriaDuplicada {
  const maxLeft = Math.max(0, 100 - geo.width);
  const maxTop = Math.max(0, 100 - geo.height);
  const derecha = geo.left + geo.width + SEPARACION;
  if (derecha <= maxLeft) return { ...geo, left: redondear(derecha) };
  const abajo = geo.top + geo.height + SEPARACION;
  if (abajo <= maxTop) return { ...geo, top: redondear(abajo) };
  return {
    ...geo,
    left: redondear(Math.min(maxLeft, geo.left + SEPARACION * 2)),
    top: redondear(Math.min(maxTop, geo.top + SEPARACION * 2)),
  };
}

/**
 * Nombre incremental libre de colisiones contra los HERMANOS visibles:
 *   «Cajón 1» → «Cajón 2» · «Cajón 2» → «Cajón 3» · «Estante» → «Estante (copia)».
 */
export function nombreDuplicado(nombre: string, existentes: string[]): string {
  const usados = new Set(existentes.map((n) => n.trim().toLowerCase()));
  const baseOriginal = nombre.trim() || 'Espacio';
  const numerado = /^(.*?)(\d+)$/.exec(baseOriginal);
  if (numerado && numerado[1].trim()) {
    const base = numerado[1];
    let n = Number(numerado[2]) + 1;
    let candidato = `${base}${n}`;
    while (usados.has(candidato.trim().toLowerCase())) {
      n += 1;
      candidato = `${base}${n}`;
    }
    return candidato;
  }
  const base = baseOriginal.replace(/\s*\(copia(?:\s*\d+)?\)$/i, '').trim() || baseOriginal;
  let n = 1;
  let candidato = `${base} (copia)`;
  while (usados.has(candidato.trim().toLowerCase())) {
    n += 1;
    candidato = `${base} (copia ${n})`;
  }
  return candidato;
}


/** Geometría REAL persistida del original (con los defaults del motor 2D). */
function geometriaDe(original: ContenedorDto, indice: number): GeometriaDuplicada {
  const alturaModelada = (original.ui_height ?? 'auto').trim() !== 'auto';
  return {
    left: pctValor(original.ui_left, 6 + (indice % 5) * 12),
    top: pctValor(original.ui_top, 8 + (indice % 4) * 16),
    width: pctValor(original.ui_width, 28),
    height: alturaModelada ? pctValor(original.ui_height, 24) : 24,
  };
}

/** POST de la copia (mismo contrato multi-tenant que el alta de divisiones). */
async function crearCopia(cuerpo: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast('❌ ' + (err?.detail || err?.error || 'No se pudo duplicar el espacio.'));
      return false;
    }
    return true;
  } catch {
    toast('❌ Error de conexión al duplicar el espacio.');
    return false;
  }
}

/**
 * Copia exacta de un espacio/sub-división DENTRO del nodo activo de la cascada.
 * Devuelve true cuando el backend confirmó el alta (el orquestador re-renderiza
 * con `estok:espacios-cambiados`).
 */
export async function duplicarDivisionEnNodo(
  nodo: NodoPortal,
  item: ItemElastico,
): Promise<boolean> {
  if (!nodo.id || !item.id) return false;
  const contenedores = await cargarContenedores();
  const original = contenedores.find((c) => c.id === item.id);
  if (!original) {
    toast('❌ No se encontró el espacio original en el padrón.');
    return false;
  }
  // Padre REAL de la copia: el mismo del original (o el nodo activo si es raíz).
  const parentId =
    original.parent_contenedor ?? (nodo.tipo === 'contenedor' ? nodo.id : null);
  const hermanos = contenedores.filter(
    (c) =>
      c.id !== original.id &&
      (c.parent_contenedor ?? null) === (original.parent_contenedor ?? null) &&
      (c.ubicacion ?? null) === (original.ubicacion ?? null),
  );
  const geo = ubicarContigua(geometriaDe(original, hermanos.length));
  const nombre = nombreDuplicado(original.nombre, hermanos.map((c) => c.nombre));

  const cuerpo: Record<string, unknown> = {
    nombre,
    descripcion: original.descripcion ?? '',
    // OBLIGATORIO del serializer: Ubicación física del contenedor.
    ubicacion: original.ubicacion ?? null,
    // Misma configuración física y taxonómica del original.
    tipo: original.tipo || undefined,
    es_inmueble: original.es_inmueble,
    espacio_unico: original.espacio_unico,
    declarado_movible: original.declarado_movible,
    grid_filas: original.grid_filas,
    grid_columnas: original.grid_columnas,
    grid_filas_config: original.grid_filas_config ?? undefined,
    largo: original.largo ?? null,
    ancho: original.ancho ?? null,
    alto: original.alto ?? null,
    material: original.material ?? '',
    tipo_madera: original.tipo_madera ?? '',
    // Copia CONTIGUA desplazada (mismas dimensiones, nueva posición).
    ui_left: `${geo.left}%`,
    ui_top: `${geo.top}%`,
    ui_width: `${geo.width}%`,
    ui_height: `${geo.height}%`,
    // Subdivisión estructural: geometría del mapa sin stock espejo.
    crear_espejo: false,
  };
  if (parentId) cuerpo.parent_contenedor = parentId;
  if (!cuerpo.ubicacion) {
    toast('❌ No se pudo resolver la habitación del espacio a duplicar.');
    return false;
  }

  const ok = await crearCopia(cuerpo);
  if (!ok) return false;
  toast(`⧉ «${original.nombre}» duplicado como «${nombre}».`);
  return true;
}
