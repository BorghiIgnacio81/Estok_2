// =============================================================================
// ICONOGRAFÍA FÍSICA PREdefinida (espacios y muebles) - única fuente de iconos
// -----------------------------------------------------------------------------
// Resuelve el icono visual de un elemento del almacenamiento según su SUBTIPO
// físico declarado por el operador (nombre) y su taxonomía (tipo/es_inmueble).
// Es el criterio ÚNICO que consumen el lienzo de edición de Almacenamiento, el
// Visor de Habitación, el Visor Contenedor Grande, los minimapas y la Mudanza.
//
// REGLAS (bosquejo estricto del cliente):
//   Habitaciones: 🏠 habitación común · 🚿 baño/ducha · 🍽️ cocina/comedor ·
//                 🚪 pasillo · 📦 depósito · 🏡 porche · 🌳 patio · 🧺 lavadero
//                 · 🚗 garaje · 🛋️ living · 🛌 suite.
//   Muebles movibles comunes (no contenedores): 🪑 mesa/silla.
//   Muebles contenedores movibles: 🧳 baúl · 🗃️ cajonera común.
//   Muebles inmuebles fijos (no contenedores): 🚽 inodoro.
//   Muebles contenedores inmuebles: 🗄️ ropero empotrado.
//   Cajas: 📦 (siempre movibles, contenedoras y contenidas).
//   Objetos sueltos: 🧸 (contenidos directamente en una habitación sin mueble).
//
// 100% puro: sin estado, sin DOM y sin dependencias (evita ciclos de importación).
// =============================================================================

import { TIPO_CAJA, TIPO_OBJETO, TIPO_CONJUNTO, esMuebleInmueble, tipoFisico } from './taxonomiaContenedor';
import type { PiezaTaxonomica } from './taxonomiaContenedor';

/** Icono base de un ambiente/espacio desconocido (habitación común). */
export const ICONO_ESPACIO = '🏠';

/** Normaliza un nombre: minúsculas, sin acentos, sin bordes. */
function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

interface ReglaIcono {
  icono: string;
  claves: readonly string[];
}

/** Reglas por palabra clave para HABITACIONES/espacios (el orden importa). */
const REGLAS_ESPACIO: readonly ReglaIcono[] = [
  { icono: '🚿', claves: ['bano', 'aseo', 'ducha', 'toilet', 'wc'] },
  { icono: '🍽️', claves: ['cocina', 'comedor', 'kitchen'] },
  { icono: '🧺', claves: ['lavadero', 'laundry'] },
  { icono: '🚗', claves: ['garaje', 'garage', 'cochera'] },
  { icono: '🛋️', claves: ['living', 'sala', 'estar'] },
  { icono: '🚌', claves: ['pasillo', 'corredor', 'pasaje', 'hall', 'recibidor', 'entrada', 'puerta'] },
  { icono: '🏡', claves: ['porche', 'terraza', 'balcon', 'veranda', 'galeria'] },
  { icono: '🌳', claves: ['patio', 'jardin', 'quinta'] },
  {
    icono: '📦',
    claves: ['deposito', 'almacen', 'bodega', 'trastero', 'despensa', 'guardarropa', 'baulera', 'sotano', 'atico', 'desvan'],
  },
  { icono: '🛌', claves: ['suite'] },
  { icono: '🛏️', claves: ['dormitorio'] },
  { icono: '🏠', claves: ['habitacion', 'cuarto', 'pieza'] },
];

/** Icono de una HABITACIÓN/espacio por su nombre (habitación común por defecto). */
export function iconoDeEspacio(nombre?: string | null): string {
  const base = normalizar(nombre);
  if (!base) return ICONO_ESPACIO;
  for (const regla of REGLAS_ESPACIO) {
    if (regla.claves.some((clave) => base.includes(clave))) return regla.icono;
  }
  return ICONO_ESPACIO;
}

/** Reglas por palabra clave para MUEBLES (contenedores o no). */
const REGLAS_MUEBLE: readonly ReglaIcono[] = [
  { icono: '🚽', claves: ['inodoro', 'vater', 'sanitario', 'retrete', 'wc'] },
  { icono: '🗄️', claves: ['ropero', 'placard', 'vestidor', 'closet', 'armario', 'empotrado', 'alacena'] },
  { icono: '🗃️', claves: ['cajonera', 'cajon', 'archivador', 'archivero', 'estanteria', 'estante'] },
  { icono: '🧳', claves: ['baul', 'maleta', 'maletero', 'valija'] },
  { icono: '🛏️', claves: ['cama', 'catre', 'litera', 'cucheta'] },
  { icono: '🛋️', claves: ['sofa', 'sillon', 'living', 'divan'] },
  { icono: '🪑', claves: ['mesa', 'silla', 'banco', 'taburete', 'silla', 'escritorio', 'computadora', 'pc', 'setup'] },
  { icono: '🗄️', claves: ['biblioteca', 'vitrina', 'modulo', 'organizador'] },
];

const ICONO_MUEBLE_CONTENEDOR = '🗄️';
const ICONO_MUEBLE_COMUN = '🪑';

/**
 * Icono de un MUEBLE SEGÚN SU NOMBRE/TAXONOMÍA, devolviendo '' cuando NO hay un
 * subtipo reconocido (para conservar el fallback por imagen del lienzo).
 * Los CAJA/OBJETO/CONJUNTO siempre tienen icono propio.
 */
export function iconoDeMuebleReconocido(
  nombre?: string | null,
  pieza?: PiezaTaxonomica | null,
): string {
  const t = tipoFisico(pieza);
  if (t === TIPO_CAJA) return '📦';
  if (t === TIPO_OBJETO) return '🧸';
  if (t === TIPO_CONJUNTO) return '🗃️';
  const base = normalizar(nombre);
  for (const regla of REGLAS_MUEBLE) {
    if (regla.claves.some((clave) => base.includes(clave))) return regla.icono;
  }
  return '';
}

/**
 * Icono de un MUEBLE según su nombre y su taxonomía:
 *   · CAJA   → 📦   · OBJETO → 🧸   · CONJUNTO → 🗃️ (estante/cajonera interna)
 *   · MUEBLE → regla por nombre; sin coincidencia, 🗄️ si es contenedor e
 *              inmueble o tiene sub-divisiones, y 🪑 si es un mueble común.
 */
export function iconoDeMueble(
  nombre?: string | null,
  pieza?: PiezaTaxonomica | null,
): string {
  const reconocido = iconoDeMuebleReconocido(nombre, pieza);
  if (reconocido) return reconocido;
  const contenedor = esMuebleInmueble(pieza) || Number(pieza?.subcontenedores_count) > 0;
  return contenedor ? ICONO_MUEBLE_CONTENEDOR : ICONO_MUEBLE_COMUN;
}
