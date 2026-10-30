// =============================================================================
// FICHA DEL CONTENEDOR ACTIVO EN EL PANEL IZQUIERDO (nivel interno de la caja)
// -----------------------------------------------------------------------------
// Al tocar una caja/espacio dentro del lienzo, el Panel Izquierdo deja de ser un
// mapa mudo: arriba del ancla del nivel superior se muestra el NIVEL INTERNO del
// contenedor elegido, con
//   · su FICHA (nombre, tipo físico, ruta «Living › Ropero › Caja 01», medidas,
//     material, descripción y contadores reales de PostgreSQL),
//   · la LISTA DE OBJETOS almacenados dentro (con su casillero F·C y el aviso
//     «🔴 pendiente de estante» cuando están en tránsito interno),
//   · la barra de acciones del contenedor («🔎 Abrir ficha completa»),
//     reutilizada del módulo de acciones.
//
// El mapa del nivel superior (LEY 1) sigue debajo: la ficha se inserta ARRIBA del
// ancla, así el operador gana el interior de la caja sin perder la navegación.
// Los contadores se re-leen en cada refresco del nivel (latido
// `estok:espacios-cambiados`), de modo que soltar un objeto sobre la caja se ve
// en el acto en esta ficha.
// =============================================================================

import { escapeHtml } from '../../mapaJerarquico';
import { indicadorTransitoHtml } from '../../indicadorTransito';
import { barraAccionesCajaHtml, conectarAccionesCaja } from './accionesCajaPortales';
import { cargarContenedores, cargarUbicaciones } from './datosNodosPortales';
import type { ContenedorDto, InteriorNodo, ObjetoDto } from './datosNodosPortales';
import type { NodoPortal } from './estadoPortales';

/** ETIQUETA del tipo físico (taxonomía de 5 tipos del backend). */
const ETIQUETA_TIPO: Record<string, string> = {
  CAJA: '📦 Caja móvil',
  MUEBLE_MOVIL: '🗄️ Mueble móvil',
  MUEBLE_INMUEBLE: '📌 Mueble inmueble fijo',
  CONJUNTO: '🧱 Estructura interna',
  OBJETO: '🧸 Objeto suelto',
};

/** ETIQUETA legible del material persistido. */
const ETIQUETA_MATERIAL: Record<string, string> = {
  madera: 'Madera',
  metal: 'Metal',
  plastico: 'Plástico',
  vidrio: 'Vidrio',
  tela: 'Tela',
  otro: 'Otro',
};

/** Pieza del padrón del Estok activo (`undefined` si ya no existe). */
type PiezaPadron = ContenedorDto | undefined;

/** Ruta legible: «Habitación › Mueble › Caja» subiendo por `parent_contenedor`. */
async function rutaDeLaPieza(pieza: PiezaPadron, nodo: NodoPortal): Promise<string> {
  const nombres: string[] = [];
  if (!pieza) return nodo.nombre;
  const [contenedores, ubicaciones] = await Promise.all([cargarContenedores(), cargarUbicaciones()]);
  const visitados = new Set<string>();
  let cursor: PiezaPadron = pieza;
  while (cursor && !visitados.has(String(cursor.id))) {
    visitados.add(String(cursor.id));
    nombres.unshift(cursor.nombre || 'Pieza');
    const padreId: string | null = cursor.parent_contenedor ?? null;
    cursor = padreId ? contenedores.find((c) => String(c.id) === String(padreId)) : undefined;
  }
  const ubicacionId = pieza.ubicacion;
  const room = ubicacionId
    ? ubicaciones.find((u) => String(u.id) === String(ubicacionId))
    : null;
  if (room) nombres.unshift(room.nombre || 'Espacio');
  return nombres.filter(Boolean).join(' › ');
}

/** Medidas físicas persistidas (cm) o null si no hay ninguna. */
function medidasDe(pieza: PiezaPadron): string | null {
  if (!pieza) return null;
  const partes = [pieza.largo, pieza.ancho, pieza.alto]
    .map((v) => (v == null || v === '' ? null : String(Number(v).toFixed(2)).replace(/\.00$/, '')))
    .filter((v): v is string => Boolean(v));
  if (!partes.length) return null;
  return `${partes.join(' × ')} cm`;
}

/** Casillero fino legible del objeto («F1·C2» o «sin casillero»). */
function casilleroDe(objeto: ObjetoDto): string {
  return objeto.parent_grid_row != null && objeto.parent_grid_col != null
    ? `F${objeto.parent_grid_row}·C${objeto.parent_grid_col}`
    : 'sin casillero';
}

/** Fila de la lista de objetos almacenados (enlace a la ficha del objeto). */
function objetoFilaHtml(objeto: ObjetoDto): string {
  const transito = objeto.en_transito_interno
    ? ` ${indicadorTransitoHtml('interno', '🔴 pendiente de estante')}`
    : '';
  return `<li class="ficha-caja-objeto">
      <a href="/objetos/${escapeHtml(objeto.id)}"
        title="Abrir la ficha de «${escapeHtml(objeto.nombre)}»">
        <span class="ficha-caja-objeto-nombre">🧸 ${escapeHtml(objeto.nombre)}</span>
        <span class="ficha-caja-objeto-meta">${escapeHtml(casilleroDe(objeto))}${transito}</span>
      </a>
    </li>`;
}


/** Termina la ficha visible y vacía el host. */
export function ocultarFichaContenedor(host?: HTMLElement | null): void {
  const contenedor = host ?? document.getElementById('fichaContenedorPanel');
  if (!contenedor) return;
  contenedor.classList.add('hidden');
  contenedor.innerHTML = '';
}

/** Token de la última pintura: descarta respuestas viejas al navegar rápido. */
let tokenFicha = 0;

/**
 * Pinta (o apaga) la ficha del contenedor activo en el Panel Izquierdo.
 *
 * @param host     Host estático `#fichaContenedorPanel` del Panel Izquierdo.
 * @param nodo     Nodo activo de la cascada (`null` = raíz → se apaga).
 * @param interior Interior ya resuelto del nodo (objetos + piezas).
 */
export async function pintarFichaContenedor(
  host: HTMLElement | null,
  nodo: NodoPortal | null,
  interior: InteriorNodo | null,
): Promise<void> {
  if (!host) return;
  if (!nodo || nodo.tipo !== 'contenedor') {
    ocultarFichaContenedor(host);
    return;
  }
  const token = ++tokenFicha;
  const pieza = (await cargarContenedores()).find((c) => String(c.id) === String(nodo.id));
  if (token !== tokenFicha) return;
  const ruta = await rutaDeLaPieza(pieza, nodo);
  if (token !== tokenFicha) return;

  const objetos = interior?.objetos ?? [];
  const totalObjetos = objetos.length;
  const totalSub = interior?.piezas.length ?? nodo.subcontenedoresCount ?? 0;
  const tipo = ETIQUETA_TIPO[String(pieza?.tipo ?? '').toUpperCase()] ?? '📦 Contenedor';
  const medidas = medidasDe(pieza);
  const material = pieza?.material ? ETIQUETA_MATERIAL[pieza.material] ?? pieza.material : null;

  const badges = [
    `<span class="ficha-caja-badge">${tipo}</span>`,
    nodo.espacioUnico ? '<span class="ficha-caja-badge">🧱 Espacio Único</span>' : '',
    nodo.esInmueble ? '<span class="ficha-caja-badge">📌 Inmueble fijo</span>' : '',
    nodo.declaradoMovible ? '<span class="ficha-caja-badge">🎒 Mueble móvil</span>' : '',
  ]
    .filter(Boolean)
    .join('');

  const datos = [
    medidas ? `<div><dt>Medidas</dt><dd>📐 ${escapeHtml(medidas)}</dd></div>` : '',
    material ? `<div><dt>Material</dt><dd>🪵 ${escapeHtml(material)}</dd></div>` : '',
    pieza?.descripcion
      ? `<div><dt>Descripción</dt><dd>${escapeHtml(pieza.descripcion)}</dd></div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const lista = totalObjetos
    ? `<ul class="ficha-caja-objetos-lista">${objetos.map(objetoFilaHtml).join('')}</ul>`
    : '<p class="ficha-caja-vacio">Todavía no hay objetos guardados acá. Arrastrá uno desde la bandeja y soltalo sobre la caja del plano.</p>';

  host.innerHTML = `<section class="ficha-caja" aria-label="Ficha de ${escapeHtml(nodo.nombre)}">
    <div class="ficha-caja-cab">
      <span class="ficha-caja-ico" aria-hidden="true">📦</span>
      <div class="ficha-caja-id">
        <h3 class="ficha-caja-nombre">${escapeHtml(nodo.nombre)}</h3>
        <p class="ficha-caja-ruta" title="Ruta completa de la pieza">${escapeHtml(ruta)}</p>
        <div class="ficha-caja-badges">${badges}</div>
      </div>
    </div>
    <div class="ficha-caja-contadores">
      <span class="ficha-caja-contador" title="Objetos guardados dentro de esta pieza">
        📦 <b data-ficha-conteo>${totalObjetos}</b> objeto(s)
      </span>
      <span class="ficha-caja-contador" title="Sub-espacios / cajas internas">
        🗂️ <b>${totalSub}</b> sub-espacio(s)
      </span>
    </div>
    ${datos ? `<dl class="ficha-caja-datos">${datos}</dl>` : ''}
    ${barraAccionesCajaHtml(nodo)}
    <div class="ficha-caja-objetos">
      <p class="ficha-caja-objetos-tit">📋 Objetos almacenados</p>
      ${lista}
    </div>
  </section>`;

  host.classList.remove('hidden');
  conectarAccionesCaja(host, nodo);
}
