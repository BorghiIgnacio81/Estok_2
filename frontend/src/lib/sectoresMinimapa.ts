// =============================================================================
// SECTORES DE MINIMAPA A PARTIR DE GEOMETRÍA REAL (ui_*) + REGLA DE FUSIONES
// -----------------------------------------------------------------------------
// Traduce una lista de espacios (habitaciones de una planta, muebles de una
// habitación, estantes de un mueble) a los sectores proporcionales que consume
// minimapaSectoresSvg: cada sector conserva su ANCHO/ALTO real expresado en % del
// lienzo (ui_width/ui_height), de modo que el minimapa no dibuje celdas idénticas.
//
// Los valores por defecto replican EXACTAMENTE la cascada de `geoDe`
// (mapaPlantaUnica.ts) para que un espacio todavía sin geometría persistida se
// ubique igual en el lienzo y en el minimapa. 100% puro (sin estado ni DOM).
//
// REGLA DE FUSIONES (heredada del lienzo grande → lib/plantaFusionSilueta.ts):
// los espacios que comparten `fusion_grupo` (ej. «Pasillo Escalera») NO salen
// como sectores hermanos con una arista divisoria entre ellos. Salen como UN
// ÚNICO sector con:
//   - la caja de la UNIÓN de sus miembros (nuevo bounding box),
//   - sus `partes` con las aristas compartidas YA FUNDIDAS por adyacencia.
// Con eso el render dibuja el CONTORNO de la unión (un solo trazo, sin ninguna
// línea interna), idéntico a la superficie continua del lienzo: la miniatura
// hereda la misma regla gráfica que la pantalla grande.
// =============================================================================

import { pctValor } from './mapaPlantaUnica';
import { unirCeldasAdyacentes } from './plantaFusionSilueta';
import type { CajaBloque } from './plantaFusionSilueta';
import type { SectorMinimapa } from './minimapa';

/** Geometría mínima que necesita un ítem para posicionarse en un minimapa. */
export interface ItemGeometria {
  id?: string | null;
  /** Nombre legible del ítem (tooltip / icono contextual). */
  nombre?: string | null;
  ui_left?: string | null;
  ui_top?: string | null;
  ui_width?: string | null;
  ui_height?: string | null;
  /** ID relacional del grupo de fusión (espacios en "L" / pasillos fusionados). */
  fusion_grupo?: string | null;
}

const ANCHO_DEFECTO = 28;
const ALTO_DEFECTO = 24;
/** Lado mínimo de la caja de la unión (nunca colapsa un bloque fusionado). */
const LADO_MINIMO = 0.01;

/** Acota la caja al perímetro del lienzo: ningún sector desborda las paredes. */
function acotarAlLienzo(caja: CajaBloque): CajaBloque {
  const left = Math.max(0, Math.min(100, caja.left));
  const top = Math.max(0, Math.min(100, caja.top));
  return {
    left,
    top,
    width: Math.max(0, Math.min(caja.width, 100 - left)),
    height: Math.max(0, Math.min(caja.height, 100 - top)),
  };
}

/** Geometría base de un ítem (cascada de defaults idéntica a la del lienzo). */
function geoDeItem(item: ItemGeometria, indice: number): CajaBloque {
  const ancho = pctValor(item.ui_width, ANCHO_DEFECTO);
  const alto = pctValor(item.ui_height, ALTO_DEFECTO);
  return acotarAlLienzo({
    left: pctValor(item.ui_left, 6 + (indice % 5) * 12),
    top: pctValor(item.ui_top, 8 + (indice % 4) * 16),
    width: ancho > 0 ? ancho : ANCHO_DEFECTO,
    height: alto > 0 ? alto : ALTO_DEFECTO,
  });
}

/** ¿El ítem es el nodo activo (resalte naranja) por identidad? */
function esActivo(item: ItemGeometria, activoId?: string | null): boolean {
  return Boolean(activoId) && item.id != null && String(item.id) === String(activoId);
}

/**
 * UN sector continuo por grupo de fusión: caja de la unión + partes relativas
 * con las aristas compartidas fundidas (sin bordes internos).
 */
function sectorDeGrupo(
  miembros: ItemGeometria[],
  cajas: CajaBloque[],
  activoId?: string | null,
  iconoDe?: (item: ItemGeometria) => string | null,
): SectorMinimapa {
  // Bordes internos removidos por adyacencia: MISMA regla que el lienzo grande.
  const unidas = unirCeldasAdyacentes(cajas);
  const left = Math.min(...unidas.map((c) => c.left));
  const top = Math.min(...unidas.map((c) => c.top));
  const ancho = Math.max(LADO_MINIMO, Math.max(...unidas.map((c) => c.left + c.width)) - left);
  const alto = Math.max(LADO_MINIMO, Math.max(...unidas.map((c) => c.top + c.height)) - top);
  const base = miembros[0];
  return {
    id: base.id != null ? String(base.id) : '',
    left,
    top,
    width: ancho,
    height: alto,
    activo: miembros.some((m) => esActivo(m, activoId)),
    nombre: base.nombre ?? '',
    icono: iconoDe ? iconoDe(base) : '',
    partes: unidas.map((c) => ({
      left: ((c.left - left) / ancho) * 100,
      top: ((c.top - top) / alto) * 100,
      width: (c.width / ancho) * 100,
      height: (c.height / alto) * 100,
    })),
  };
}


/**
 * Sectores proporcionales de una lista de ítems.
 * `activoId` marca el sector que se pintará en naranja (#f97316).
 * `iconoDe` (opcional) resuelve el icono contextual de cada ítem (🚽 🛏️ 🗄️ 🏠):
 * se centraliza aquí para que TODOS los minimapas usen el mismo criterio.
 * Los espacios fusionados (`fusion_grupo` con 2+ miembros) se devuelven como UN
 * solo sector continuo; una fusión huérfana (un miembro) vuelve a ser suelto.
 */
export function sectoresDeItems(
  items: ItemGeometria[] | null | undefined,
  activoId?: string | null,
  iconoDe?: (item: ItemGeometria) => string | null,
): SectorMinimapa[] {
  const lista = items ?? [];
  const cajas = lista.map((item, i) => geoDeItem(item, i));

  // Índices por grupo de fusión (los grupos de un solo miembro no agrupan).
  const porGrupo = new Map<string, number[]>();
  lista.forEach((item, i) => {
    const grupo = item.fusion_grupo;
    if (!grupo) return;
    const indices = porGrupo.get(grupo) ?? [];
    indices.push(i);
    porGrupo.set(grupo, indices);
  });
  const indicesDeGrupo = new Map<number, number[]>();
  porGrupo.forEach((indices) => {
    if (indices.length < 2) return;
    indices.forEach((i) => indicesDeGrupo.set(i, indices));
  });

  const sectores: SectorMinimapa[] = [];
  const resueltos = new Set<number>();
  lista.forEach((item, i) => {
    if (resueltos.has(i)) return;
    const indices = indicesDeGrupo.get(i);
    if (indices) {
      indices.forEach((j) => resueltos.add(j));
      sectores.push(
        sectorDeGrupo(
          indices.map((j) => lista[j]),
          indices.map((j) => cajas[j]),
          activoId,
          iconoDe,
        ),
      );
      return;
    }
    const caja = cajas[i];
    sectores.push({
      // El ID real viaja con el sector: el motor de minimapas puede resaltar el
      // activo por identidad (override global `activoId`), no solo por posición.
      id: item.id != null ? String(item.id) : '',
      left: caja.left,
      top: caja.top,
      width: caja.width,
      height: caja.height,
      activo: esActivo(item, activoId),
      nombre: item.nombre ?? '',
      icono: iconoDe ? iconoDe(item) : '',
    });
  });
  return sectores;
}
