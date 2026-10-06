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
// —mismo fondo, mismo contorno ámbar y misma sombra, sin tramas— y SIN bordes
// internos entre sus celdas: la adyacencia de hermanas se resuelve en
// ./plantaFusionSilueta.ts). El bloque
// fusionado conserva TODAS las capacidades de un espacio ordinario: checkbox de
// fusión encadenada, tirador elástico de esquina, renombrado y ÚNICAMENTE su
// propio 🗑️ (que borra la macro-estructura completa, sin partes huérfanas).
//
// Este módulo es 100% render (sin estado ni listeners). La interacción y la
// persistencia viven en ./plantaUnicaInteractivo.ts y ./plantaUnicaArrastre.ts.
// =============================================================================

import { escapeHtml } from './mapaJerarquico';
import { estiloPerimetro, tiradoresPerimetro } from './perimetroElastico';
import { siluetaContinua, unirCeldasAdyacentes } from './plantaFusionSilueta';
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
 * REGLA GRÁFICA ESTRICTA: se emite UN ÚNICO contenedor con UN ÚNICO SVG cuya
 * superficie se dibuja con UN SOLO `<path>` (un subcamino rectangular por celda)
 * rellenado con la superficie NATIVA de un espacio común (blanco plano, sin
 * tramas ni tonos alternos).
 *
 * BORDES INTERNOS REMOVIDOS POR ADYACENCIA: antes de pintar, las celdas
 * hermanas del mismo `fusion_grupo` se evalúan por vecindad en
 * ./plantaFusionSilueta.ts — la hermana de la fila de abajo funde el borde
 * inferior (`border-b-0`), la de arriba el superior (`border-t-0`), la de la
 * derecha el derecho (`border-r-0`) y la de la izquierda el izquierdo
 * (`border-l-0`). Al compartir EXACTAMENTE la misma arista y pertenecer a una
 * única forma, esa arista deja de ser frontera: cero líneas divisorias internas,
 * cero costuras de antialias y cero doble alpha en los solapes. El bloque se lee
 * como UNA sola pieza, con su título y su 🗑️ únicos y centralizados.
 *
 * `shape-rendering="crispEdges"` es obligatorio: sin él, el antialias del
 * contorno de la silueta delata una costura translúcida de 1px.
 *
 * El contorno ámbar y la sombra que abrazan la silueta de la unión los aporta el
 * `drop-shadow` de `.pu-grupo-malla`, nunca un stroke interno.
 */
function superficieDeGrupo(g: GrupoFusion): string {
  // Geometría NATIVA de cada celda + su caja relativa (% del bbox del bloque).
  const partes = g.miembros.map((m) => {
    const geo = geoDe(m);
    return {
      miembro: m,
      geo,
      relativa: {
        left: ((geo.left - g.caja.left) / g.caja.width) * 100,
        top: ((geo.top - g.caja.top) / g.caja.height) * 100,
        width: (geo.width / g.caja.width) * 100,
        height: (geo.height / g.caja.height) * 100,
      },
    };
  });

  // 1) Bordes internos removidos por vecindad (aristas fundidas entre hermanas).
  const celdas = unirCeldasAdyacentes(partes.map((p) => p.relativa));

  // 2) PORTADORES táctiles: NO pintan nada (la superficie la aporta el <path>
  //    continuo, así no pueden generar costuras) pero conservan el área de
  //    agarre de cada celda y la geometría REAL persistida (data-tile-*) que
  //    consumen el arrastre del bloque y el guardado consolidado del grupo.
  const portadores = partes
    .map((p, i) => {
      const c = celdas[i];
      return `<rect x="${c.left.toFixed(2)}" y="${c.top.toFixed(2)}" width="${c.width.toFixed(2)}" height="${c.height.toFixed(2)}" fill="transparent"
        data-tile-id="${p.miembro.id}" data-tile-left="${p.geo.left}" data-tile-top="${p.geo.top}" data-tile-width="${p.geo.width}" data-tile-height="${p.geo.height}" />`;
    })
    .join('');

  return `<svg class="pu-grupo-svg" viewBox="0 0 100 100" preserveAspectRatio="none" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
      <path class="pu-grupo-silueta" d="${siluetaContinua(celdas)}" fill="${SUPERFICIE_NATIVA}" />
      ${portadores}
    </svg>`;
}

/**
 * Margen de RESGUARDO (en % del lienzo) que la etiqueta debe dejar libre hacia
 * el borde perimetral del bloque fusionado. Si el baricentro queda más cerca que
 * esto de una arista EXTERNA, la etiqueta se relocaliza.
 */
const MARGEN_CENTRO = 5;

/** True si (px,py) cae dentro de alguna celda de la silueta fusionada. */
function dentroDelBloque(px: number, py: number, geos: GeoLibre[]): boolean {
  return geos.some(
    (geo) =>
      px >= geo.left && px <= geo.left + geo.width && py >= geo.top && py <= geo.top + geo.height,
  );
}

/**
 * PUNTO MEDIO GEOMÉTRICO del bloque fusionado: baricentro (área ponderada) de
 * sus tiles, expresado en % relativo a la caja (bbox) de la tarjeta. Garantiza
 * que el nombre + su ícono queden CENTRADOS sobre la superficie real de la «L»
 * y no en la esquina vacía de su bounding box.
 *
 * RESGUARDO ANTICOLISIÓN: en una «L» de brazos finos el baricentro puede caer
 * pegado a la arista perimetral EXTERNA (justo donde se apoya un ambiente
 * vecino, p.ej. el «Baño»), que taparía el texto. Antes de pintar se sondea el
 * baricentro a MARGEN_CENTRO px hacia los 4 lados; si algún sondeo cae FUERA de
 * la silueta, el centro colisiona con el límite de un nodo vecino y la etiqueta
 * se desplaza al centro de la celda de MAYOR área (interior visible garantizado).
 */
function centroGeometrico(g: GrupoFusion): { x: number; y: number } {
  const geos = g.miembros.map((m) => geoDe(m));
  let area = 0;
  let sx = 0;
  let sy = 0;
  geos.forEach((geo) => {
    const a = Math.max(1e-6, geo.width * geo.height);
    area += a;
    sx += a * (geo.left + geo.width / 2);
    sy += a * (geo.top + geo.height / 2);
  });
  if (area <= 0) return { x: 50, y: 50 };
  let cx = sx / area;
  let cy = sy / area;
  const resguardado =
    dentroDelBloque(cx - MARGEN_CENTRO, cy, geos) &&
    dentroDelBloque(cx + MARGEN_CENTRO, cy, geos) &&
    dentroDelBloque(cx, cy - MARGEN_CENTRO, geos) &&
    dentroDelBloque(cx, cy + MARGEN_CENTRO, geos);
  if (!resguardado) {
    const mayor = geos.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    cx = mayor.left + mayor.width / 2;
    cy = mayor.top + mayor.height / 2;
  }
  const pct = (v: number, ini: number, tam: number): number => ((v - ini) / tam) * 100;
  // Acotado al 15..85 % para que la etiqueta nunca se salga de la superficie.
  const acotarPct = (n: number): number => Math.max(15, Math.min(85, n));
  return { x: acotarPct(pct(cx, g.caja.left, g.caja.width)), y: acotarPct(pct(cy, g.caja.top, g.caja.height)) };
}

function gruposHtml(grupos: GrupoFusion[]): string {
  return grupos
    .map((g) => {
      const centro = centroGeometrico(g);
      return `
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
      <div class="pu-grupo-centro" style="left:${centro.x}%;top:${centro.y}%">
        ${g.base.icono ? `<span class="pu-icono" aria-hidden="true">${escapeHtml(g.base.icono)}</span>` : ''}
        <span class="pu-grupo-nombre" data-inplace-renombrar data-id="${g.base.id}" title="Clic para renombrar el espacio (se aplica a todas sus partes)">${escapeHtml(g.base.nombre)}</span>
      </div>
      <span class="pu-grupo-resize" data-grupo-resize data-id="${g.base.id}" title="Estirar el espacio completo (se aplica a todas sus partes en un solo guardado)"></span>
    </div>`;
    })
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
      ${item.contenido ? `<span class="pu-contenido">${item.contenido}</span>` : ''}
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

