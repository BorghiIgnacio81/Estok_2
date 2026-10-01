// =============================================================================
// ETIQUETAS DE LECTURA DEL MINIMAPA (icono + nombre de cada ambiente)
// -----------------------------------------------------------------------------
// Capa de LECTURA del plano: cada sector dibujado por el motor (lib/minimapa.ts)
// recibe UNA etiqueta centrada con su icono de referencia y su nombre REAL
// (`espacio.nombre`), para que el ambiente se identifique de un vistazo sin
// adivinar la silueta.
//
// REGLA DE FUSIONES: un espacio fusionado («Pasillo Escalera») es UN único
// sector en el motor (caja de la unión + contorno continuo sin divisorias), así
// que hereda UNA sola etiqueta centrada en su cuerpo unificado: nunca se
// duplica por cada celda fusionada.
//
// 100% puro (devuelve string HTML, sin DOM) y compartido por el componente
// global components/MinimapaRuta.astro y por los módulos que montan el mismo
// plano en caliente (selector de Objetos, Mudanza y el asistente «Mover»). El
// marco del lienzo (ancho/alto/pad) lo aporta SIEMPRE el motor, que es quien
// dibujó las siluetas: así el texto queda clavado sobre su sector y no se
// recalcula ninguna geometría por fuera de lib/minimapa.ts.
//
// REGLAS DE ESPACIO Y SEGURIDAD:
//   · el posicionador recorta con `overflow: hidden` → la etiqueta JAMÁS
//     desborda la silueta (ni siquiera en el plano reducido del formulario),
//   · la capa completa es `pointer-events: none` (styles/minimapa-ruta.css) →
//     no bloquea el clic de navegación por el plano ni las zonas de suelta de
//     la Mudanza,
//   · el nombre se escapa (viene de la base) y se trunca antes que romper la
//     silueta; el icono es un carácter/emoji minimalista, sin assets extra.
// =============================================================================

import type { SectorAcotado } from './sectoresProporcionales';

/** Marco del lienzo del plano: los MISMOS valores con los que el motor dibujó. */
export interface MarcoEtiquetas {
  /** Ancho del `viewBox` en unidades del motor. */
  ancho: number;
  /** Alto del `viewBox` en unidades del motor. */
  alto: number;
  /** Margen interno del lienzo (pared de la lámina) en unidades del motor. */
  pad: number;
}

interface ReglaIcono {
  icono: string;
  claves: readonly string[];
}

/** Icono base cuando el nombre no coincide con ningún ambiente conocido. */
export const ICONO_AMBIENTE = '🏠';

/**
 * Iconografía de referencia por palabra clave del nombre del ambiente (nombres
 * normalizados: minúsculas y sin acentos). El ORDEN importa — gana la primera
 * regla que coincide, así «Baño de la habitación» sale 🚿 y no 🛏️.
 */
const REGLAS_ICONO: readonly ReglaIcono[] = [
  { icono: '🚿', claves: ['bano', 'aseo', 'ducha', 'toilet', 'wc'] },
  { icono: '🍳', claves: ['cocina', 'kitchen'] },
  { icono: '🍽️', claves: ['comedor'] },
  { icono: '🛌', claves: ['suite'] },
  { icono: '🛏️', claves: ['dormitorio', 'habitacion', 'cuarto', 'pieza', 'cama'] },
  { icono: '🗄️', claves: ['ropero', 'placard', 'vestidor', 'closet', 'armario'] },
  { icono: '🛋️', claves: ['living', 'sala', 'estar'] },
  {
    icono: '🚪',
    claves: ['pasillo', 'corredor', 'pasaje', 'hall', 'recibidor', 'entrada', 'puerta'],
  },
  { icono: '🪜', claves: ['escalera', 'stairs'] },
  { icono: '🧺', claves: ['lavadero', 'laundry'] },
  {
    icono: '📦',
    claves: ['deposito', 'almacen', 'bodega', 'trastero', 'despensa', 'guardarropa', 'baulera', 'sotano', 'atico', 'desvan'],
  },
  { icono: '🚗', claves: ['garaje', 'garage', 'cochera', 'estacionamiento'] },
  { icono: '🌳', claves: ['terraza', 'balcon', 'patio', 'jardin'] },
  { icono: '💻', claves: ['oficina', 'escritorio', 'estudio'] },
];

/** Contenedor centrado del icono + nombre (utilidades Tailwind del proyecto). */
const CLASES_CAJA =
  'flex flex-col items-center justify-center p-1 text-center h-full w-full select-none';
/** Nombre compacto y legible: crece un punto en pantallas medianas o mayores. */
const CLASES_NOMBRE =
  'minimapa-etiqueta-nombre text-[10px] md:text-xs font-semibold text-slate-800 tracking-wide leading-tight truncate max-w-full';
/** Icono de referencia (una sola línea, chico, arriba del nombre). */
const CLASES_ICONO = 'minimapa-etiqueta-ico text-[11px] md:text-sm leading-none';

/** Normaliza un nombre para matchear reglas: minúsculas, sin acentos ni bordes. */
function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Escapa texto que viaja a `innerHTML` (los nombres vienen de la base). Se
 * mantiene local, igual que en el resto de los módulos de render de lib/, para
 * que este módulo sea puro y sin dependencias (nada de ciclos de importación).
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Icono de referencia de un ambiente: primero el `icono` explícito que traiga el
 * espacio, después las REGLAS_ICONO por nombre y, si nada coincide, la casita.
 */
export function iconoDeAmbiente(
  nombre?: string | null,
  iconoExplicito?: string | null,
): string {
  const explicito = String(iconoExplicito ?? '').trim();
  if (explicito) return explicito;
  const base = normalizar(nombre);
  if (!base) return ICONO_AMBIENTE;
  for (const regla of REGLAS_ICONO) {
    if (regla.claves.some((clave) => base.includes(clave))) return regla.icono;
  }
  return ICONO_AMBIENTE;
}

/** Coordenada del `viewBox` expresada en % del lienzo (3 decimales). */
function porcentaje(valor: number, total: number): string {
  return `${((valor / total) * 100).toFixed(3)}%`;
}

/**
 * Capa HTML de etiquetas del plano: UN div posicionado por sector (incluidos los
 * espacios fusionados, que llegan acá como un único sector unido), cada uno con
 * su icono y su nombre centrados. Se inyecta DESPUÉS del SVG del motor, dentro
 * del host del componente global (`position: relative` en styles/minimapa-ruta.css).
 *
 * Los bounds de cada etiqueta se derivan con las MISMAS fórmulas y clamps que
 * usa el motor para dibujar la silueta (pad + % del área interna, lado mínimo
 * 1.5), de modo que el texto cae exactamente sobre su sector.
 */
export function etiquetasSectoresHtml(
  sectores: readonly SectorAcotado[],
  marco: MarcoEtiquetas,
): string {
  const { ancho, alto, pad } = marco;
  if (!sectores.length || !(ancho > 0) || !(alto > 0)) return '';

  const escalaX = (ancho - pad * 2) / 100;
  const escalaY = (alto - pad * 2) / 100;

  const piezas = sectores.map((sector) => {
    const nombre = String(sector.nombre ?? '').trim();
    const icono = iconoDeAmbiente(nombre, sector.icono);
    const x = pad + sector.left * escalaX;
    const y = pad + sector.top * escalaY;
    const w = Math.max(1.5, sector.width * escalaX);
    const h = Math.max(1.5, sector.height * escalaY);
    const estilo =
      `left:${porcentaje(x, ancho)};top:${porcentaje(y, alto)};`
      + `width:${porcentaje(w, ancho)};height:${porcentaje(h, alto)}`;
    const activa = sector.activo ? ' minimapa-etiqueta-activa' : '';
    const titulo = nombre ? escapeHtml(nombre) : '';
    const texto = nombre
      ? `<span class="${CLASES_NOMBRE}" title="${titulo}">${titulo}</span>`
      : '';
    return (
      `<div class="minimapa-etiqueta${activa}" style="${estilo}"`
      + ` data-etiqueta-id="${escapeHtml(sector.id)}">`
      + `<span class="${CLASES_CAJA}">`
      + `<span class="${CLASES_ICONO}" aria-hidden="true">${icono}</span>`
      + texto
      + '</span></div>'
    );
  });

  return `<div class="minimapa-etiquetas">${piezas.join('')}</div>`;
}
