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
// (un único contenedor div con la MISMA superficie nativa de un espacio común
// —mismo fondo, mismo contorno ámbar y misma sombra, sin tramas—). El bloque
// fusionado conserva TODAS las capacidades de un espacio ordinario: checkbox de
// fusión encadenada, tirador elástico de esquina, renombrado y ÚNICAMENTE su
// propio 🗑️ (que borra la macro-estructura completa, sin partes huérfanas).
//
// Este módulo es 100% render (sin estado ni listeners). La interacción y la
// persistencia viven en ./plantaUnicaInteractivo.ts y ./plantaUnicaArrastre.ts.
// =============================================================================

import { escapeHtml } from './mapaJerarquico';
import { estiloPerimetro, tiradoresPerimetro } from './perimetroElastico';
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

/**
 * Superficie NATIVA de un espacio común del plano: EXACTAMENTE el mismo fondo
 * que `.pu-celda` (`background: rgba(255, 255, 255, 0.96)` en planta-unica.css).
 * Si se cambia una, hay que cambiar la otra: el espacio fusionado debe verse
 * igual que cualquier espacio sin fusionar.
 */
const SUPERFICIE_NATIVA = 'rgba(255, 255, 255, 0.96)';

/**
 * SUPERFICIE CONTINUA del espacio fusionado (macro-estructura en "L").
 *
 * REGLA GRÁFICA ESTRICTA: se emite UN ÚNICO contenedor con UN ÚNICO SVG cuyas
 * partes comparten el mismo espacio de usuario y se rellenan con la superficie
 * NATIVA de un espacio común (blanco plano, sin tramas ni tonos alternos), por
 * lo que el bloque se lee como UNA sola pieza: cero líneas divisorias internas
 * y la identidad cromática de un espacio sin fusionar al 100%.
 *
 * `shape-rendering="crispEdges"` es obligatorio: sin él, el antialias de las
 * fronteras entre partes contiguas delata una costura translúcida de 1px (cada
 * parte rasteriza su borde al 50% de cobertura).
 *
 * El contorno ámbar y la sombra que abrazan la silueta de la unión los aporta el
 * `drop-shadow` de `.pu-grupo-malla`, nunca un stroke interno.
 */
function superficieDeGrupo(g: GrupoFusion): string {
  const partes = g.miembros
    .map((m) => {
      const geo = geoDe(m);
      const relLeft = ((geo.left - g.caja.left) / g.caja.width) * 100;
      const relTop = ((geo.top - g.caja.top) / g.caja.height) * 100;
      const relW = (geo.width / g.caja.width) * 100;
      const relH = (geo.height / g.caja.height) * 100;
      // Sin stroke y con el MISMO relleno nativo: la unión es un rectángulo continuo.
      return `<rect x="${relLeft.toFixed(2)}" y="${relTop.toFixed(2)}" width="${relW.toFixed(2)}" height="${relH.toFixed(2)}" fill="${SUPERFICIE_NATIVA}"
        data-tile-id="${m.id}" data-tile-left="${geo.left}" data-tile-top="${geo.top}" data-tile-width="${geo.width}" data-tile-height="${geo.height}" />`;
    })
    .join('');
  return `<svg class="pu-grupo-svg" viewBox="0 0 100 100" preserveAspectRatio="none" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${partes}</svg>`;
}

function gruposHtml(grupos: GrupoFusion[]): string {
  return grupos
    .map(
      (g) => `
    <div class="pu-grupo" data-fusion-grupo="${escapeHtml(g.grupo)}" data-inplace-card data-id="${g.base.id}"
         data-libre-drag style="left:${g.caja.left}%;top:${g.caja.top}%;width:${g.caja.width}%;height:${g.caja.height}%"
         title="Espacio fusionado CONTINUO: arrastrá para moverlo · clic en el nombre para renombrarlo · tirá de la esquina para estirar el bloque completo.">
      <div class="pu-grupo-malla">${superficieDeGrupo(g)}</div>
      <label class="pu-check" title="Seleccionar este bloque fusionado para ENCADENAR una fusión con otro espacio">
        <input type="checkbox" data-fusion-check data-id="${g.base.id}" />
      </label>
      <button type="button" data-eliminar-grupo data-id="${g.base.id}" data-nombre="${escapeHtml(g.base.nombre)}"
        class="pu-grupo-eliminar"
        title="Eliminar el macro-espacio fusionado COMPLETO: todas sus partes se borran juntas en PostgreSQL y su contenido viaja a la bandeja de «por ubicar».">🗑️</button>
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
      ${item.protegido ? '' : `<button type="button" data-eliminar-item data-id="${item.id}" data-nombre="${escapeHtml(item.nombre)}"
        class="pu-celda-eliminar"
        title="Eliminar «${escapeHtml(item.nombre)}» de forma definitiva: su contenido se desancla hacia la bandeja inferior de «por ubicar».">🗑️</button>`}
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
 *  - Cabecera: botón gráfico "Nueva ubicación" (o texto libre con `etiquetaCrear`)
 *    + "🔗 Fusionar Espacios".
 *  - Contenedor del departamento: rectángulo perimetral continuo (sin techo) con
 *    la medida general persistida (`ui_width`/`ui_height` en px del contenedor
 *    padre) y sus TIRADORES de perímetro, visibles solo en Modo Edición.
 *  - Rectángulos libres y espacios fusionados en "L".
 *
 *  - etiquetaCrear: reemplaza el botón gráfico por un botón de texto «➕ X».
 *  - tip:           ayuda contextual bajo la cabecera (tiene default).
 */
export function renderPlantaUnica(opts: {
  apartamento: ItemElastico | null;
  rooms: ItemElastico[];
  etiquetaCrear?: string;
  tip?: string;
}): string {
  const { apartamento, rooms, etiquetaCrear, tip } = opts;
  const { grupos, sueltas } = agruparFusiones(rooms);
  const textoCrear = etiquetaCrear ?? 'Nueva ubicación';

  const botonCrear = etiquetaCrear
    ? `<button type="button" class="lienzo-elastico-nueva" data-lienzo-crear title="Inyectar ${escapeHtml(etiquetaCrear.toLowerCase())} en el plano">➕ ${escapeHtml(etiquetaCrear)}</button>`
    : `<button type="button" class="planta-unica-nueva" data-nueva-ubicacion title="Inyectar una habitación/espacio libre dentro del departamento">
        <img src="/nueva ubicacion.png" alt="Nueva ubicación" />
      </button>`;

  const vacio =
    rooms.length === 0
      ? `<div class="pu-vacio">🏠 El departamento está vacío. Usá el botón <strong>«${escapeHtml(textoCrear)}»</strong> para inyectar tu primer espacio libre.</div>`
      : '';

  const ayuda =
    tip ??
    '🏢 <strong>Modo Planta Única</strong> · un solo departamento de perímetro continuo (sin techo): inyectá espacios libres, arrastralos para acomodarlos, estirá de la esquina y <strong>seleccioná 2+ para fusionarlos</strong> en un espacio en «L».';

  return `
  <div class="planta-unica-raiz" data-planta-unica>
    <div class="planta-unica-cab">
      ${botonCrear}
      <button type="button" class="planta-unica-fusionar" data-fusionar disabled title="Seleccioná 2 o más espacios para fusionarlos en un único espacio en «L»">🔗 Fusionar Espacios</button>
      <span class="planta-unica-contador" data-fusion-contador>0 seleccionados</span>
    </div>
    <p class="planta-unica-tip">${ayuda}</p>
    <div class="planta-unica-lienzo" data-lienzo-pu data-perimetro-elastico${estiloPerimetro(apartamento)}>
      ${vacio}
      ${gruposHtml(grupos)}
      ${sueltasHtml(sueltas)}
      ${apartamento ? '' : '<div class="pu-sin-apartamento">⚠️ Sin división base: al inyectar el primer espacio se creará el contenedor «Departamento» automáticamente.</div>'}
      ${tiradoresPerimetro()}
    </div>
  </div>`;
}

