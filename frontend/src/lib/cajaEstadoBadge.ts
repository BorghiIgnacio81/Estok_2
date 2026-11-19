// =============================================================================
// ESTADO DE UNA CAJA / CONTENEDOR · BADGE INTELIGENTE + SUMARIO DE CONTENIDO
// -----------------------------------------------------------------------------
// Fuente ÚNICA de la etiqueta de estado que muestran las tarjetas de caja de
// /objetos y /almacenamiento (y la ficha descriptiva del contenedor):
//
//   esta_llena = true
//     · con `cantidad_objetos_lote > 0`  → «Caja llena (~40 objetos)»
//     · con sub-objetos registrados       → «Llena (7 objetos regist.)»
//     · sin cantidad y sin sub-objetos    → «Caja llena (Lote foto)»
//   esta_llena = false
//     · con sub-objetos registrados       → «Con espacio (7 objetos)» (verde)
//     · sin sub-objetos                   → «Contenedor vacío»         (gris)
//
// También expone el filtro de la barra de /objetos («Con espacio disponible» /
// «Llenas / Lotes») y el sumario por categoría que reemplazó al texto fijo
// «Contenedor vacío» de la SECCIÓN 1.
//
// Capa 100% PURA (sin DOM ni red): la consumen el render del listado, el canvas
// de Almacenamiento y los modales. El escapado delega en lib/escapeHtml.
// =============================================================================

import { escapeHtml } from './escapeHtml';

/** Metadatos mínimos de una caja/contenedor para calcular su estado. */
export interface CajaEstadoFuente {
  /** Declaración manual de caja llena (contenido fotografiado como lote). */
  esta_llena?: boolean | null;
  /** Cantidad estimada de piezas del lote (opcional). */
  cantidad_objetos_lote?: number | string | null;
  /** Conteo de objetos directos que ya trae el backend. */
  objetos_count?: number | string | null;
  /** Contenido del nodo (fallback cuando no hay `objetos_count`). */
  contenido?: unknown[] | null;
}

/** Tono visual del estado (define el color del badge). */
export type TonoEstadoCaja = 'llena' | 'espacio' | 'vacio';

/** Resultado del cálculo de estado (texto + clase + métricas). */
export interface EstadoCaja {
  tono: TonoEstadoCaja;
  texto: string;
  clase: string;
  esLlena: boolean;
  objetos: number;
  cantidadLote: number | null;
}

/** Filtro de la barra de /objetos: todas · con espacio · llenas/lotes. */
export type FiltroEstadoCaja = '' | 'con_espacio' | 'llenas';

const CLASES_TONO: Record<TonoEstadoCaja, string> = {
  llena: 'bg-orange-100 text-orange-800 border-orange-200',
  espacio: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  vacio: 'bg-gray-100 text-gray-500 border-gray-200',
};

/** Entero positivo (o 0) sin inventar valores con NaN/strings raros. */
function entero(valor: unknown): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return 0;
  return Math.floor(numero);
}

/** Objetos directos registrados en la BD (conteo del backend o `contenido`). */
export function objetosRegistrados(fuente: CajaEstadoFuente): number {
  const declarado = entero(fuente.objetos_count);
  const items = Array.isArray(fuente.contenido) ? fuente.contenido : [];
  const enContenido = items.filter(
    (item) => item && (item as { tipo?: string }).tipo === 'objeto',
  ).length;
  return Math.max(declarado, enContenido);
}


/**
 * Estado de la caja según las reglas del lote fotografiado. `esLlena` manda
 * sobre el conteo: una caja con lote declarado nunca se rotula «vacía».
 */
export function estadoCaja(fuente: CajaEstadoFuente): EstadoCaja {
  const objetos = objetosRegistrados(fuente);
  const cantidadLote = entero(fuente.cantidad_objetos_lote) || null;
  const esLlena = fuente.esta_llena === true;

  let texto: string;
  if (esLlena) {
    if (cantidadLote) {
      texto = 'Caja llena (~' + cantidadLote + ' objetos)';
    } else if (objetos > 0) {
      texto = 'Llena (' + objetos + ' objetos regist.)';
    } else {
      texto = 'Caja llena (Lote foto)';
    }
  } else {
    texto = objetos > 0 ? 'Con espacio (' + objetos + ' objetos)' : 'Contenedor vacío';
  }

  const tono: TonoEstadoCaja = esLlena ? 'llena' : objetos > 0 ? 'espacio' : 'vacio';
  return { tono, texto, clase: CLASES_TONO[tono], esLlena, objetos, cantidadLote };
}

/** Badge HTML (pill) con el estado de la caja. */
export function badgeEstadoCajaHtml(fuente: CajaEstadoFuente): string {
  const estado = estadoCaja(fuente);
  const clases = 'inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold '
    + estado.clase;
  return '<span class="' + clases + '" title="' + escapeHtml(estado.texto) + '">'
    + escapeHtml(estado.texto) + '</span>';
}

/** Desglose «3 revistas, 2 libros» de los objetos directos (o cadena vacía). */
function desgloseCategoriasHtml(contenido: unknown): string {
  const items = Array.isArray(contenido) ? contenido : [];
  const conteo = new Map<string, number>();

  for (const item of items) {
    const obj = item as Record<string, unknown> | null;
    if (!obj || obj.tipo !== 'objeto') continue;
    const categoria = String(obj.categoria_nombre || '').trim() || 'sin categoría';
    conteo.set(categoria, (conteo.get(categoria) || 0) + 1);
  }
  if (conteo.size === 0) return '';

  const partes = Array.from(conteo.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'es'))
    .map(([nombre, cantidad]) => cantidad + ' ' + nombre.toLowerCase());

  return '<span class="text-[11px] text-gray-400 leading-snug">'
    + escapeHtml(partes.join(', ')) + '</span>';
}

/**
 * Línea de la tarjeta: badge de estado + desglose por categoría. Reemplaza al
 * texto fijo «Contenedor vacío» de la SECCIÓN 1 (el badge siempre se muestra).
 */
export function sumarioCajaHtml(caja: CajaEstadoFuente): string {
  const desglose = desgloseCategoriasHtml(caja.contenido);
  return '<span class="mt-1 flex flex-wrap items-center gap-1.5">'
    + badgeEstadoCajaHtml(caja) + desglose + '</span>';
}

/**
 * Mensaje de la tarjeta cuando la caja NO tiene contenido desglosado: un lote
 * fotografiado nunca se rotula con el guion de «sin contenido».
 */
export function mensajeCajaVaciaHtml(fuente: CajaEstadoFuente): string {
  return estadoCaja(fuente).esLlena
    ? '📸 Lote fotografiado: contenido no desglosado.'
    : '— Sin contenido —';
}

/** ¿La caja entra en el filtro elegido? (sin filtro entran todas). */
export function cumpleFiltroEstadoCaja(
  fuente: CajaEstadoFuente,
  filtro: FiltroEstadoCaja,
): boolean {
  if (!filtro) return true;
  return estadoCaja(fuente).esLlena === (filtro === 'llenas');
}

/** Texto de ficha descriptiva: «~40 objetos estimados» (o cadena vacía). */
export function textoLoteEstimado(fuente: CajaEstadoFuente): string {
  const cantidad = entero(fuente.cantidad_objetos_lote);
  return cantidad > 0 ? '~' + cantidad + ' objetos estimados' : '';
}
