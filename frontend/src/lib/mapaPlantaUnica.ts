// =============================================================================
// MODELADOR 2D ADAPTABLE - MODO PLANTA ÚNICA (render puro)
// -----------------------------------------------------------------------------
// Rama del "Mapa de Estok" que se activa cuando el inmueble tiene 1 sola planta
// (Estok.cantidad_pisos == 1). Reemplaza la casa con techo puntiagudo por UN gran
// rectángulo contenedor perimetral continuo (el departamento entero), mimetizado
// con la textura de la app, y SIN techo.
//
// Dentro del contenedor se inyectan RECTÁNGULOS LIBRES (habitaciones/espacios)
// posicionados de forma elástica (ui_left / ui_top / ui_width / ui_height) y se
// agrupan por `fusion_grupo` para renderizar los espacios en "L" como un ÚNICO
// espacio receptor Drag & Drop de geometría irregular (sin fronteras internas).
//
// Este módulo es 100% render (sin estado ni listeners). La interacción y la
// persistencia viven en ./plantaUnicaInteractivo.ts.
// =============================================================================

import { escapeHtml } from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';

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
 * Geometría elástica de un espacio libre. Un espacio "sin definir" (ui_height
 * por defecto 'auto') recibe una caja y una posición en cascada para que el
 * usuario lo vea dentro del plano la primera vez.
 */
export function geoDe(room: UbicacionPlano, indice = 0): GeoLibre {
  const sinDefinir = (room.ui_height ?? 'auto') === 'auto';
  return {
    left: pctValor(room.ui_left, 6 + (indice % 5) * 12),
    top: pctValor(room.ui_top, 8 + (indice % 4) * 16),
    width: sinDefinir ? 28 : pctValor(room.ui_width, 28),
    height: sinDefinir ? 24 : pctValor(room.ui_height, 24),
  };
}

// =============================================================================
// AGRUPACIÓN DE FUSIONES (espacios en "L")
// =============================================================================

export interface GrupoFusion {
  grupo: string;
  base: UbicacionPlano;
  miembros: UbicacionPlano[];
  caja: GeoLibre;
}

/** Separa los espacios en grupos fusionados (≥2) y rectángulos independientes. */
export function agruparFusiones(rooms: UbicacionPlano[]): {
  grupos: GrupoFusion[];
  sueltas: UbicacionPlano[];
} {
  const porGrupo = new Map<string, UbicacionPlano[]>();
  const sueltas: UbicacionPlano[] = [];
  rooms.forEach((room) => {
    const grupo = room.fusion_grupo;
    if (!grupo) {
      sueltas.push(room);
      return;
    }
    const arr = porGrupo.get(grupo) ?? [];
    arr.push(room);
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
      return `<span class="pu-tile" style="left:${relLeft}%;top:${relTop}%;width:${relW}%;height:${relH}%"
        data-tile-id="${m.id}" data-tile-left="${geo.left}" data-tile-top="${geo.top}"></span>`;
    })
    .join('');
}

function gruposHtml(grupos: GrupoFusion[]): string {
  return grupos
    .map(
      (g) => `
    <div class="pu-grupo" data-fusion-grupo="${escapeHtml(g.grupo)}" data-inplace-card data-id="${g.base.id}"
         data-libre-drag style="left:${g.caja.left}%;top:${g.caja.top}%;width:${g.caja.width}%;height:${g.caja.height}%"
         title="Espacio fusionado en «L» (${g.miembros.length} módulos). Arrastrá para moverlo o clic en el nombre para renombrarlo.">
      ${tilesDeGrupo(g)}
      <button type="button" class="pu-grupo-separar" data-separar data-id="${g.base.id}" title="Separar en espacios independientes">✂️</button>
      <span class="pu-grupo-nombre" data-inplace-renombrar data-id="${g.base.id}" title="Clic para renombrar el espacio fusionado">${escapeHtml(g.base.nombre)}</span>
      <span class="pu-grupo-badge">🔗 ${g.miembros.length} fusionados</span>
    </div>`,
    )
    .join('');
}

function sueltasHtml(sueltas: UbicacionPlano[]): string {
  return sueltas
    .map((room, i) => {
      const geo = geoDe(room, i);
      const meta = [
        (room.objetos_count || 0) > 0 ? `${room.objetos_count} obj` : null,
        (room.contenedores_count || 0) > 0 ? `${room.contenedores_count} cont` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return `
    <div class="pu-celda" data-inplace-card data-id="${room.id}" data-libre-drag
         style="left:${geo.left}%;top:${geo.top}%;width:${geo.width}%;height:${geo.height}%"
         title="Arrastrá para acomodar · Clic en el nombre para renombrar · Tirá de la esquina para estirar">
      <label class="pu-check" title="Seleccionar para fusionar con otro espacio">
        <input type="checkbox" data-fusion-check data-id="${room.id}" />
      </label>
      <span class="pu-nombre" data-inplace-renombrar data-id="${room.id}">${escapeHtml(room.nombre)}</span>
      ${meta ? `<span class="pu-meta">${escapeHtml(meta)}</span>` : ''}
      <span class="pu-resize" data-libre-resize data-id="${room.id}" title="Estirar para cambiar el tamaño (se guarda solo)"></span>
    </div>`;
    })
    .join('');
}

/**
 * Lienzo completo del Modo Planta Única:
 *  - Cabecera: botón gráfico "Nueva ubicación" + "🔗 Fusionar Espacios".
 *  - Contenedor del departamento (rectángulo perimetral continuo, sin techo).
 *  - Rectángulos libres y espacios fusionados en "L".
 */
export function renderPlantaUnica(opts: {
  apartamento: UbicacionPlano | null;
  rooms: UbicacionPlano[];
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

