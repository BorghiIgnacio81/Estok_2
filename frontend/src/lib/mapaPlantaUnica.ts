// =============================================================================
// MODELADOR 2D ADAPTABLE - LIENZO ELÁSTICO (render puro, genérico por ítem)
// -----------------------------------------------------------------------------
// Motor de render del rectángulo elástico reutilizable en TODOS los niveles:
//   - Nivel 1 (Planta Única): departamento de perímetro continuo (renderPlantaUnica).
//   - Nivel 2 (habitación): muebles como rectángulos libres (renderLienzoElastico).
//   - Nivel 3/4 (interior del mueble): estantes/cajones libres (renderLienzoElastico).
//
// El tipo de entrada es `ItemElastico` (id/nombre/ui_* + fusion_grupo), por lo
// que sirve tanto para Ubicación como para Contenedor. Los ítems se agrupan por
// `fusion_grupo` para renderizar los espacios en "L" como UN rectángulo continuo
// (color homogéneo idéntico al de un ambiente común, sin etiquetas redundantes).
//
// Este módulo es 100% render (sin estado ni listeners). La interacción y la
// persistencia viven en ./plantaUnicaInteractivo.ts y ./plantaUnicaArrastre.ts.
// =============================================================================

import { escapeHtml } from './mapaJerarquico';
import type { ItemElastico } from './lienzoElastico';

// =============================================================================
// GEOMETRÍA ELÁSTICA (porcentajes sobre el lienzo del departamento)
// =============================================================================

/** Parsea un token CSS de posición en porcentaje (ej: '12%' → 12) acotado a 0..100. */
export function pctValor(valor: string | null | undefined, porDefecto: number): number {
  const s = (valor ?? '').trim();
  const m = /^(-?\d{1,3}(?:\.\d+)?)%$/.exec(s);
  if (!m) return porDefecto;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : porDefecto;
}

export interface GeoLibre {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Geometría elástica de un rectángulo libre. Un ítem "sin definir" (ui_height
 * por defecto 'auto') recibe una caja en cascada para que el usuario lo vea
 * dentro del plano la primera vez.
 */
export function geoDe(item: ItemElastico, indice = 0): GeoLibre {
  const sinDefinir = (item.ui_height ?? 'auto') === 'auto';
  return {
    left: pctValor(item.ui_left, 6 + (indice % 5) * 12),
    top: pctValor(item.ui_top, 8 + (indice % 4) * 16),
    width: sinDefinir ? 28 : pctValor(item.ui_width, 28),
    height: sinDefinir ? 24 : pctValor(item.ui_height, 24),
  };
}

// =============================================================================
// AGRUPACIÓN DE FUSIONES (espacios en "L")
// =============================================================================

export interface GrupoFusion {
  grupo: string;
  base: ItemElastico;
  miembros: ItemElastico[];
  caja: GeoLibre;
}

/** Separa los ítems en grupos fusionados (≥2) y rectángulos independientes. */
export function agruparFusiones(items: ItemElastico[]): {
  grupos: GrupoFusion[];
  sueltas: ItemElastico[];
} {
  const porGrupo = new Map<string, ItemElastico[]>();
  const sueltas: ItemElastico[] = [];
  items.forEach((item) => {
    const grupo = item.fusion_grupo;
    if (!grupo) {
      sueltas.push(item);
      return;
    }
    const arr = porGrupo.get(grupo) ?? [];
    arr.push(item);
    porGrupo.set(grupo, arr);
  });

  const grupos: GrupoFusion[] = [];
  porGrupo.forEach((miembros, grupo) => {
    // Un grupo con un solo miembro es una fusión huérfana: vuelve a "suelto".
    if (miembros.length < 2) {
      sueltas.push(miembros[0]);
      return;
    }
    const geos = miembros.map((m, i) => geoDe(m, i));
    const left = Math.min(...geos.map((g) => g.left));
    const top = Math.min(...geos.map((g) => g.top));
    const right = Math.max(...geos.map((g) => g.left + g.width));
    const bottom = Math.max(...geos.map((g) => g.top + g.height));
    grupos.push({
      grupo,
      base: miembros[0],
      miembros,
      caja: { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) },
    });
  });
  return { grupos, sueltas };
}

// =============================================================================
// RENDER
// =============================================================================

function tilesDeGrupo(g: GrupoFusion): string {
  return g.miembros
    .map((m) => {
      const geo = geoDe(m);
      const relLeft = ((geo.left - g.caja.left) / g.caja.width) * 100;
      const relTop = ((geo.top - g.caja.top) / g.caja.height) * 100;
      const relW = (geo.width / g.caja.width) * 100;
      const relH = (geo.height / g.caja.height) * 100;
      return `<span class="pu-tile" style="left:${relLeft}%;top:${relTop}%;width:calc(${relW}% + 1px);height:calc(${relH}% + 1px)"
        data-tile-id="${m.id}" data-tile-left="${geo.left}" data-tile-top="${geo.top}" data-tile-width="${geo.width}" data-tile-height="${geo.height}"></span>`;
    })
    .join('');
}

function gruposHtml(grupos: GrupoFusion[]): string {
  return grupos
    .map(
      (g) => `
    <div class="pu-grupo" data-fusion-grupo="${escapeHtml(g.grupo)}" data-inplace-card data-id="${g.base.id}"
         data-libre-drag style="left:${g.caja.left}%;top:${g.caja.top}%;width:${g.caja.width}%;height:${g.caja.height}%"
         title="Espacio en «L»: arrastrá para moverlo · clic en el nombre para renombrarlo · tildá la casilla para encadenar la fusión con otro espacio.">
      <div class="pu-grupo-malla">${tilesDeGrupo(g)}</div>
      <label class="pu-check" title="Seleccionar para fusionar con otro espacio">
        <input type="checkbox" data-fusion-check data-id="${g.base.id}" />
      </label>
      <button type="button" class="pu-grupo-separar" data-separar data-id="${g.base.id}" title="Separar en espacios independientes">✂️</button>
      ${g.base.icono ? `<span class="pu-icono" aria-hidden="true">${escapeHtml(g.base.icono)}</span>` : ''}
      <span class="pu-grupo-nombre" data-inplace-renombrar data-id="${g.base.id}" title="Clic para renombrar el espacio (se aplica a todas sus partes)">${escapeHtml(g.base.nombre)}</span>
      <span class="pu-grupo-resize" data-grupo-resize data-id="${g.base.id}" title="Estirar el espacio completo (se aplica a todas sus partes en un solo guardado)"></span>
    </div>`,
    )
    .join('');
}

function sueltasHtml(sueltas: ItemElastico[]): string {
  return sueltas
    .map((item, i) => {
      const geo = geoDe(item, i);
      const meta =
        item.meta ??
        [
          (item.objetos_count || 0) > 0 ? `${item.objetos_count} obj` : null,
          (item.contenedores_count || 0) > 0 ? `${item.contenedores_count} cont` : null,
        ]
          .filter(Boolean)
          .join(' · ');
      return `
    <div class="pu-celda" data-inplace-card data-id="${item.id}" data-libre-drag
         style="left:${geo.left}%;top:${geo.top}%;width:${geo.width}%;height:${geo.height}%"
         title="Arrastrá para acomodar · Clic en el nombre para renombrar · Tirá de la esquina para estirar">
      <label class="pu-check" title="Seleccionar para fusionar con otro espacio">
        <input type="checkbox" data-fusion-check data-id="${item.id}" />
      </label>
      ${item.icono ? `<span class="pu-icono" aria-hidden="true">${escapeHtml(item.icono)}</span>` : ''}
      <span class="pu-nombre" data-inplace-renombrar data-id="${item.id}">${escapeHtml(item.nombre)}</span>
      ${meta ? `<span class="pu-meta">${escapeHtml(meta)}</span>` : ''}
      <span class="pu-resize" data-libre-resize data-id="${item.id}" title="Estirar para cambiar el tamaño (se guarda solo)"></span>
    </div>`;
    })
    .join('');
}

/**
 * LIENZO ELÁSTICO GENÉRICO (Nivel 2 habitación / Nivel 3-4 interior del mueble).
 * Renderiza una lista de `ItemElastico` como rectángulos libres fusionables,
 * con el MISMO lenguaje visual que Planta Única (color homogéneo, sin etiquetas
 * redundantes y con el checkbox permanente de fusión en la esquina).
 *
 *  - etiquetaCrear: texto del botón de creación (data-lienzo-crear). Opcional.
 *  - textoVacio:   mensaje cuando el lienzo no tiene ítems.
 *  - tip:          ayuda contextual opcional bajo la cabecera.
 */
export function renderLienzoElastico(opts: {
  items: ItemElastico[];
  etiquetaCrear?: string;
  textoVacio?: string;
  tip?: string;
}): string {
  const { items, etiquetaCrear, textoVacio, tip } = opts;
  const { grupos, sueltas } = agruparFusiones(items);
  const botonCrear = etiquetaCrear
    ? `<button type="button" class="lienzo-elastico-nueva" data-lienzo-crear title="Crear un nuevo espacio libre en este lienzo">➕ ${escapeHtml(etiquetaCrear)}</button>`
    : '';
  const vacio =
    items.length === 0
      ? `<div class="pu-vacio">${escapeHtml(textoVacio || 'Sin espacios todavía. Usá el botón de creación para inyectar el primero.')}</div>`
      : '';
  return `
  <div class="lienzo-elastico-raiz" data-lienzo-elastico>
    <div class="planta-unica-cab">
      ${botonCrear}
      <button type="button" class="planta-unica-fusionar" data-fusionar disabled title="Seleccioná 2 o más espacios para fusionarlos en un único espacio en «L»">🔗 Fusionar Espacios</button>
      <span class="planta-unica-contador" data-fusion-contador>0 seleccionados</span>
    </div>
    ${tip ? `<p class="planta-unica-tip">${tip}</p>` : ''}
    <div class="planta-unica-lienzo" data-lienzo-pu>
      ${vacio}
      ${gruposHtml(grupos)}
      ${sueltasHtml(sueltas)}
    </div>
  </div>`;
}

/**
 * Lienzo completo del Modo Planta Única (Nivel 1):
 *  - Cabecera: botón gráfico "Nueva ubicación" + "🔗 Fusionar Espacios".
 *  - Contenedor del departamento (rectángulo perimetral continuo, sin techo).
 *  - Rectángulos libres y espacios fusionados en "L".
 */
export function renderPlantaUnica(opts: {
  apartamento: ItemElastico | null;
  rooms: ItemElastico[];
}): string {
  const { apartamento, rooms } = opts;
  const { grupos, sueltas } = agruparFusiones(rooms);

  const vacio =
    rooms.length === 0
      ? `<div class="pu-vacio">🏠 El departamento está vacío. Usá el botón <strong>«Nueva ubicación»</strong> para inyectar tu primer espacio libre.</div>`
      : '';

  return `
  <div class="planta-unica-raiz" data-planta-unica>
    <div class="planta-unica-cab">
      <button type="button" class="planta-unica-nueva" data-nueva-ubicacion title="Inyectar una habitación/espacio libre dentro del departamento">
        <img src="/nueva ubicacion.png" alt="Nueva ubicación" />
      </button>
      <button type="button" class="planta-unica-fusionar" data-fusionar disabled title="Seleccioná 2 o más espacios para fusionarlos en un único espacio en «L»">🔗 Fusionar Espacios</button>
      <span class="planta-unica-contador" data-fusion-contador>0 seleccionados</span>
    </div>
    <p class="planta-unica-tip">🏢 <strong>Modo Planta Única</strong> · un solo departamento de perímetro continuo (sin techo): inyectá espacios libres, arrastralos para acomodarlos, estirá de la esquina y <strong>seleccioná 2+ para fusionarlos</strong> en un espacio en «L».</p>
    <div class="planta-unica-lienzo" data-lienzo-pu>
      ${vacio}
      ${gruposHtml(grupos)}
      ${sueltasHtml(sueltas)}
      ${apartamento ? '' : '<div class="pu-sin-apartamento">⚠️ Sin división base: al inyectar el primer espacio se creará el contenedor «Departamento» automáticamente.</div>'}
    </div>
  </div>`;
}

