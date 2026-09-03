// =============================================================================
// BANDEJA DE CARGA FINA - VISTA (ESCENA 4 · panel derecho de almacenamiento.astro)
// -----------------------------------------------------------------------------
// Vista 100% PRESENTACIONAL del marcado que bandejaCargaFina.ts inyecta en
// #cargaFinaPanel al abrir «📦 Organizar Contenido». Jerarquía estricta:
//   1. GRUPO 1 · Cajas sin ubicación (Contenedores Pequeños huérfanos) arriba.
//   2. GRUPO 2 · Objetos individuales sin ubicación, inmediatamente debajo.
//   3. Acordeón «Cambiar Contenedor»: primero Cajas internas, luego Objetos.
// Todos los chips emiten los MIME estándar; la persistencia al soltar en el
// mueble (PUT /api/contenedores/{id}/ o /api/objetos/{id}/ con JWT + X-Estok-Id)
// la resuelve visorContenedorGrande.ts. CSS: almacenamiento-carga-fina.css.
// =============================================================================

import { escapeHtml } from './mapaJerarquico';

const IMG_CONTENEDOR_GRANDE = '/archivador-login.png';
const IMG_CONTENEDOR_PEQUENO = '/Nuevo Contenedor.png';
const IMG_OBJETO = '/fluffy_plush_ball.jpg';

// =============================================================================
// TIPOS COMPARTIDOS
// =============================================================================

export interface ContenedorCarga {
  id: string;
  nombre: string;
  es_inmueble: boolean;
  subcontenedores_count: number;
  parent_contenedor: string | null;
  parent_grid_row: number | null;
  parent_grid_col: number | null;
  ubicacion: string | null;
  ubicacion_nombre: string | null;
  objetos_count: number;
}

export interface ObjetoCarga {
  id: string;
  nombre: string;
  contenedor: string | null;
  ubicacion: string | null;
  parent_grid_row: number | null;
  parent_grid_col: number | null;
  deleted_at: string | null;
}

export interface ChipCarga {
  id: string;
  nombre: string;
  tipo: 'contenedor' | 'objeto';
}

/** Estado normalizado que bandejaCargaFina.ts entrega a esta vista. */
export interface EstadoBandejaCargaFina {
  contenedores: ContenedorCarga[];
  objetos: ObjetoCarga[];
  roomId: string | null;
  roomNombre: string | null;
  dataCargado: boolean;
  acordeonAbierto: boolean;
  contenedorSeleccionadoId: string | null;
}

// =============================================================================
// SELECCIÓN JERÁRQUICA (regla hermética compartida con bandejaSinUbicar)
// =============================================================================

function sinCasillero(x: { parent_grid_row?: number | null; parent_grid_col?: number | null }): boolean {
  return x.parent_grid_row == null && x.parent_grid_col == null;
}

/**
 * GRUPO 1 — Cajas sin ubicación: Contenedores Pequeños (sin sub-contenedores ni
 * es_inmueble) huérfanos o sin casillero asignado.
 */
function cajasSinUbicarDe(contenedores: ContenedorCarga[]): ChipCarga[] {
  return contenedores
    .filter((c) => c.subcontenedores_count === 0)
    .filter((c) => !c.es_inmueble)
    .filter((c) => sinCasillero(c))
    .map((c) => ({ id: c.id, nombre: c.nombre, tipo: 'contenedor' as const }));
}

/**
 * GRUPO 2 — Objetos sin ubicación: objetos individuales sin contenedor que
 * estén sueltos (sin ubicación o sin coordenadas).
 */
function objetosSinUbicarDe(objetos: ObjetoCarga[]): ChipCarga[] {
  return objetos
    .filter((o) => !o.deleted_at)
    .filter((o) => !o.contenedor)
    .filter((o) => o.ubicacion == null || sinCasillero(o))
    .map((o) => ({ id: o.id, nombre: o.nombre, tipo: 'objeto' as const }));
}

/** Objetos directos de un contenedor origen (viven «sueltos» dentro de él). */
function objetosInternosDe(objetos: ObjetoCarga[], contenedorId: string): ObjetoCarga[] {
  return objetos
    .filter((o) => !o.deleted_at && o.contenedor === contenedorId)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Cajas internas anidadas de forma directa en el contenedor origen. */
function subContenedoresInternosDe(contenedores: ContenedorCarga[], contenedorId: string): ContenedorCarga[] {
  return contenedores
    .filter((c) => c.parent_contenedor === contenedorId)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Contenedores «que ya tienen ubicación» de la habitación activa con elementos
 * internos propios (cajas internas y/u objetos sueltos): fuentes válidas del
 * inspector «Cambiar Contenedor».
 */
export function contenedoresFuenteDeContenidoDe(
  contenedores: ContenedorCarga[],
  objetos: ObjetoCarga[],
  roomId: string | null,
): ContenedorCarga[] {
  if (!roomId) return [];
  const conContenido = new Set<string>();
  for (const o of objetos) {
    if (!o.deleted_at && o.contenedor) conContenido.add(o.contenedor);
  }
  for (const c of contenedores) {
    if (c.parent_contenedor) conContenido.add(c.parent_contenedor);
  }
  return contenedores
    .filter((c) => c.ubicacion === roomId)
    .filter((c) => conContenido.has(c.id))
    .sort((a, b) => {
      const totalA = subContenedoresInternosDe(contenedores, a.id).length + objetosInternosDe(objetos, a.id).length;
      const totalB = subContenedoresInternosDe(contenedores, b.id).length + objetosInternosDe(objetos, b.id).length;
      return totalB - totalA || a.nombre.localeCompare(b.nombre, 'es');
    });
}

/** Imagen icónica de un contenedor: archivador si es mueble/estante, caja si no. */
function imagenDeContenedor(c: ContenedorCarga): string {
  return c.subcontenedores_count > 0 || c.es_inmueble ? IMG_CONTENEDOR_GRANDE : IMG_CONTENEDOR_PEQUENO;
}

// =============================================================================
// CONSTRUCTORES DE CHIPS (draggable=true · MIME types estándar)
// =============================================================================

function chipHtml(chip: ChipCarga): string {
  if (chip.tipo === 'contenedor') {
    return `<span class="bandeja-chip" draggable="true" data-cf-dnd="${chip.id}" data-cf-tipo="contenedor" title="Arrastrá «${escapeHtml(chip.nombre)}» a un casillero del mueble para fijar su coordenada">
      <img src="${IMG_CONTENEDOR_PEQUENO}" alt="" class="bandeja-chip-img" draggable="false" />
      <span class="bandeja-chip-nombre">${escapeHtml(chip.nombre)}</span>
    </span>`;
  }
  return `<span class="bandeja-chip" draggable="true" data-cf-dnd="${chip.id}" data-cf-tipo="objeto" title="Arrastrá «${escapeHtml(chip.nombre)}» a un casillero del mueble para fijar su coordenada">
    <img src="${IMG_OBJETO}" alt="" class="bandeja-chip-img bandeja-chip-img-objeto" draggable="false" />
    <span class="bandeja-chip-nombre">${escapeHtml(chip.nombre)}</span>
  </span>`;
}

function objetoInternoHtml(o: ObjetoCarga): string {
  return `<span class="bandeja-chip" draggable="true" data-cf-dnd="${o.id}" data-cf-tipo="objeto" title="Arrastrá «${escapeHtml(o.nombre)}» a un casillero del mueble para cambiarle el contenedor">
    <img src="${IMG_OBJETO}" alt="" class="bandeja-chip-img bandeja-chip-img-objeto" draggable="false" />
    <span class="bandeja-chip-nombre">${escapeHtml(o.nombre)}</span>
  </span>`;
}

function subcontenedorInternoHtml(c: ContenedorCarga): string {
  return `<span class="bandeja-chip" draggable="true" data-cf-dnd="${c.id}" data-cf-tipo="contenedor" title="Arrastrá «${escapeHtml(c.nombre)}» a un casillero del mueble para cambiarle el contenedor">
    <img src="${imagenDeContenedor(c)}" alt="" class="bandeja-chip-img" draggable="false" />
    <span class="bandeja-chip-nombre">${escapeHtml(c.nombre)}</span>
  </span>`;
}

// =============================================================================
// ACORDEÓN «Cambiar Contenedor» (contenido jerárquico del origen)
// =============================================================================

function cuerpoJerarquicoInternoHtml(subcajas: ContenedorCarga[], sueltos: ObjetoCarga[]): string {
  if (!subcajas.length && !sueltos.length) {
    return '<div class="cf-vacio">Este contenedor no tiene elementos internos todavía.</div>';
  }
  const cajasHtml = subcajas.length
    ? subcajas.map(subcontenedorInternoHtml).join('')
    : '<span class="cf-grupo-vacio">Sin cajas internas.</span>';
  const objetosHtml = sueltos.length
    ? sueltos.map(objetoInternoHtml).join('')
    : '<span class="cf-grupo-vacio">Sin objetos sueltos.</span>';
  return `<div class="cf-contenedor-cuerpo">
      <div class="cf-grupo-interno">
        <div class="cf-sub-cab">
          <span class="cf-sub-titulo">1 · Cajas internas</span>
          <span class="cf-bloque-badge">${subcajas.length}</span>
        </div>
        <div class="cf-objetos">${cajasHtml}</div>
      </div>
      <div class="cf-grupo-interno">
        <div class="cf-sub-cab">
          <span class="cf-sub-titulo">2 · Objetos sueltos</span>
          <span class="cf-bloque-badge">${sueltos.length}</span>
        </div>
        <div class="cf-objetos">${objetosHtml}</div>
      </div>
    </div>`;
}

function contenedorHtml(
  c: ContenedorCarga,
  abierto: boolean,
  subcajas: ContenedorCarga[],
  sueltos: ObjetoCarga[],
): string {
  const cuerpo = abierto ? cuerpoJerarquicoInternoHtml(subcajas, sueltos) : '';
  return `<article class="cf-contenedor${abierto ? ' cf-contenedor-abierto' : ''}">
    <button type="button" class="cf-contenedor-cab" data-cf-cont-toggle="${c.id}" aria-expanded="${abierto ? 'true' : 'false'}" title="Ver el contenido jerárquico de «${escapeHtml(c.nombre)}»">
      <img src="${imagenDeContenedor(c)}" alt="" class="cf-contenedor-img" draggable="false" />
      <span class="cf-contenedor-nombre">${escapeHtml(c.nombre)}</span>
      <span class="cf-contenedor-meta">${subcajas.length} caja${subcajas.length === 1 ? '' : 's'} · ${sueltos.length} obj</span>
      <span class="cf-chevron" aria-hidden="true">${abierto ? '▴' : '▾'}</span>
    </button>
    ${cuerpo}
  </article>`;
}

function listadoAcordeonHtml(estado: EstadoBandejaCargaFina): string {
  const fuentes = contenedoresFuenteDeContenidoDe(estado.contenedores, estado.objetos, estado.roomId);
  if (!estado.dataCargado) {
    return '<div class="cf-vacio">⏳ Cargando contenedores con contenido interno…</div>';
  }
  if (!fuentes.length) {
    return estado.roomId
      ? '<div class="cf-vacio">📭 No hay contenedores con cajas u objetos internos en «' +
          escapeHtml(estado.roomNombre || 'esta habitación') +
          '» todavía.</div>'
      : '<div class="cf-vacio">👈 Seleccioná una habitación para inspeccionar sus contenedores.</div>';
  }
  return fuentes
    .map((c) =>
      contenedorHtml(
        c,
        estado.contenedorSeleccionadoId === c.id,
        subContenedoresInternosDe(estado.contenedores, c.id),
        objetosInternosDe(estado.objetos, c.id),
      ),
    )
    .join('');
}

/** Caja visual de un grupo jerárquico del bloque superior (GRUPO 1 · Cajas / GRUPO 2 · Objetos). */
function grupoSinUbicarHtml(opts: { titulo: string; cantidad: number; chips: string; vacio: string }): string {
  return `<div class="cf-grupo">
      <div class="cf-grupo-cab">
        <span class="cf-grupo-titulo">${opts.titulo}</span>
        <span class="cf-grupo-num">${opts.cantidad}</span>
      </div>
      <div class="cf-grupo-chips">
        ${opts.cantidad ? opts.chips : `<span class="cf-grupo-vacio">${opts.vacio}</span>`}
      </div>
    </div>`;
}

// =============================================================================
// RENDER PRINCIPAL DEL PANEL DERECHO
// =============================================================================

export function renderBandejaCargaFinaHtml(estado: EstadoBandejaCargaFina): string {
  const cajas = cajasSinUbicarDe(estado.contenedores);
  const sueltos = objetosSinUbicarDe(estado.objetos);
  const totalPorUbicar = cajas.length + sueltos.length;
  const fuentes = contenedoresFuenteDeContenidoDe(estado.contenedores, estado.objetos, estado.roomId);

  const gruposPorUbicar = totalPorUbicar
    ? grupoSinUbicarHtml({
        titulo: '📦 GRUPO 1 · Cajas sin ubicación',
        cantidad: cajas.length,
        chips: cajas.map(chipHtml).join(''),
        vacio: 'No hay Contenedores Pequeños huérfanos por ubicar.',
      }) +
      grupoSinUbicarHtml({
        titulo: '🧸 GRUPO 2 · Objetos sin ubicación',
        cantidad: sueltos.length,
        chips: sueltos.map(chipHtml).join(''),
        vacio: 'No hay objetos individuales por ubicar.',
      })
    : '<div class="cf-vacio">✨ No hay elementos sin ubicar. Soltá uno desde un casillero del mueble para extraerlo y aparecerá acá.</div>';

  const cuerpoAcordeon = estado.acordeonAbierto ? listadoAcordeonHtml(estado) : '';

  return `<div class="cf-panel">
    <!-- BLOQUE SUPERIOR: cajas (GRUPO 1) y objetos (GRUPO 2) sin ubicación, jerarquía estricta -->
    <section class="cf-bloque">
      <div class="cf-bloque-cab">
        <span class="cf-bloque-titulo">🫳 A primera vista · por ubicar</span>
        <span class="cf-bloque-badge">${totalPorUbicar}</span>
      </div>
      <p class="cf-bloque-hint">Cajas 📦 (GRUPO 1) y objetos 🧸 (GRUPO 2) sin ubicación. Arrastralos hacia un estante del mueble (panel izquierdo).</p>
      ${gruposPorUbicar}
    </section>

    <!-- BLOQUE INFERIOR: inspector "Cambiar Contenedor" (acordeón async) -->
    <section class="cf-bloque cf-acordeon${estado.acordeonAbierto ? ' cf-acordeon-abierto' : ''}">
      <button type="button" class="cf-acordeon-toggle" data-cf-toggle-accordeon aria-expanded="${estado.acordeonAbierto ? 'true' : 'false'}">
        <span class="cf-bloque-titulo">🔄 Cambiar Contenedor</span>
        <span class="cf-bloque-badge">${estado.roomId ? fuentes.length : 0}</span>
        <span class="cf-chevron" aria-hidden="true">▾</span>
      </button>
      <p class="cf-bloque-hint">Contenedores con ubicación que ya contienen elementos internos. Al abrir uno verás primero sus cajas y después sus objetos sueltos para mudarlos al mueble activo.</p>
      <div class="cf-acordeon-cuerpo">${cuerpoAcordeon}</div>
    </section>
  </div>`;
}



