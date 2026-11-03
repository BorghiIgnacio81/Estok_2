// =============================================================================
// LAS CUATRO PESTAÑAS DE LA CANASTA «🧺 ELEMENTOS POR UBICAR»
// -----------------------------------------------------------------------------
// Módulo PURO (sin DOM ni fetch): recibe los bultos ya normalizados por
// `bandejaSinUbicarDatos.ts` y devuelve las CUATRO pestañas con sus chips.
// Se extrajo de `bandejaSinUbicar.ts` para sostener el límite de 400 líneas por
// archivo y para dejar la REGLA en un único lugar legible.
//
// FILTROS ESTRICTOS (espejo del ORM de `?bandeja=true`):
//   1 · Objetos sueltos    → `contenedor_id IS NULL` Y (en tránsito o sin
//                            ubicación). Excluye de raíz todo objeto alojado en
//                            una caja: el bulto recuperable es el chip de ESA
//                            caja, nunca sus ítems internos.
//   2 · Cajas sueltas      → cajas/contenedores (incluidos los Objetos-caja) en
//                            tránsito o SIN espacio físico asignado
//                            (`espacio_id IS NULL`: ubicación nula o el limbo
//                            VIRTUAL de mudanza).
//   3 · Objetos a reubicar → `contenedor_id IS NULL` Y `ubicacion_id IS NULL`
//                            (estricto: ni caja ni espacio, ni siquiera limbo).
//   4 · Cajas a reubicar   → TODAS las cajas/contenedores que SÍ tienen un
//                            espacio físico asignado, listas para seleccionar y
//                            mover.
// Las pestañas 2 ⇄ 4 son complementarias por construcción (toda caja cae en una
// y sólo una), de modo que la 4 lista el universo de cajas ya ubicadas.
// =============================================================================

import type { ChipBandeja, GrupoChips } from './bandejaChipHtml';
import type { ContenedorBandeja, ObjetoBandeja } from './bandejaSinUbicarDatos';
import {
  esCajaEnLimbo,
  esCajaMovil,
  esHabitacionLimbo,
  esObjetoAlojadoEnContenedor,
  esObjetoContenedor,
  esObjetoSueltoSinHogar,
} from './taxonomiaContenedor';
// Iconografía de interfaz: rutas canónicas (WebP optimizados) en UN solo módulo.
import { ASSET_CAJA, ASSET_MUEBLE } from './assetsUi';

const IMG_CONTENEDOR_PEQUENO = ASSET_CAJA;
const IMG_OBJETO = ASSET_MUEBLE;

/** Caja móvil (tipo=CAJA, no inmueble): reutiliza la whitelist compartida. */
function esCaja(c: ContenedorBandeja): boolean {
  return esCajaMovil(c);
}

/**
 * OBJETO registrado en la HABITACIÓN VIRTUAL del limbo de mudanza («En Tránsito»
 * / «Zona de Mudanza»): NO tiene espacio físico fijo (misma lectura espacial que
 * `esCajaEnLimbo` para los contenedores).
 */
function estaEnHabitacionLimbo(o: ObjetoBandeja): boolean {
  return o.ubicacion != null && esHabitacionLimbo(o.ubicacion_nombre);
}

/**
 * OBJETO EN TRÁNSITO INDIVIDUAL: sin espacio físico fijo Y SIN CONTENEDOR.
 *
 * Un objeto alojado en una caja (`contenedor_id IS NOT NULL`) NUNCA se marca en
 * tránsito por su cuenta: su ubicación física depende exclusivamente de la caja
 * que lo aloja, y el bulto recuperable es el chip de esa caja.
 */
function esObjetoEnLimbo(o: ObjetoBandeja): boolean {
  return !esObjetoAlojadoEnContenedor(o) && estaEnHabitacionLimbo(o);
}

/**
 * Chip de CAJA / CONTENEDOR. `enTransito` rotula las que están en la pestaña
 * «Cajas sueltas» (limbo de mudanza o sin espacio físico asignado).
 */
function chipContenedor(c: ContenedorBandeja): ChipBandeja {
  return {
    id: c.id,
    nombre: c.nombre,
    tipo: 'contenedor',
    img: IMG_CONTENEDOR_PEQUENO,
    // Limbo de mudanza o tránsito interno sin estante fino.
    enTransito: cajaSinEspacio(c),
  };
}

/** Chip de un OBJETO fino suelto (iconografía de objeto). */
function chipObjeto(o: ObjetoBandeja): ChipBandeja {
  return {
    id: o.id,
    nombre: o.nombre,
    tipo: 'objeto',
    img: IMG_OBJETO,
    // Sin espacio físico fijo y SIN caja: se rotula «En tránsito».
    enTransito: esObjetoEnLimbo(o),
  };
}

/**
 * Chip de un OBJETO CONTENEDOR (caja declarada por `es_contenedor=true`, por la
 * categoría «Cajas y Contenedores» o por su rótulo numerado). Conserva
 * `tipo='objeto'` a propósito: el registro físico es un Objeto y el arrastre
 * debe seguir persistiendo por PUT /objetos/{id}. Sólo cambia la iconografía y
 * la pestaña donde se lista.
 */
function chipObjetoContenedor(o: ObjetoBandeja): ChipBandeja {
  return {
    id: o.id,
    nombre: o.nombre,
    tipo: 'objeto',
    img: IMG_CONTENEDOR_PEQUENO,
    enTransito: objetoSinEspacio(o),
  };
}

/**
 * CAJA / CONTENEDOR **SIN** espacio físico definitivo (`espacio_id IS NULL`).
 *
 * Cubre las dos formas de «estar en tránsito»:
 *   · el LIMBO de mudanza («En Tránsito» / «Zona de Mudanza»), que es una
 *     habitación VIRTUAL del tablero y no un cuarto del plano —una caja que vive
 *     ahí sigue «suelta» y ésa es la única forma de volver a arrastrarla—;
 *   · `en_transito_interno=True`: guardada dentro de un mueble anfitrión SIN
 *     estante fino, pendiente de ubicación definitiva.
 */
function cajaSinEspacio(c: ContenedorBandeja): boolean {
  return esCajaEnLimbo(c) || c.en_transito_interno;
}

/** OBJETO-CAJA sin espacio físico asignado (misma lectura que `cajaSinEspacio`). */
function objetoSinEspacio(o: ObjetoBandeja): boolean {
  return o.ubicacion == null || estaEnHabitacionLimbo(o);
}

/** Construye las CUATRO pestañas con sus filtros estrictos y sus chips. */
export function construirPestanas(
  contenedores: ContenedorBandeja[],
  objetos: ObjetoBandeja[],
): GrupoChips[] {
  const cajas = contenedores.filter(esCaja);
  // SEPARACIÓN DE BULTOS CONTENEDOR: los Objetos declarados caja/contenedor
  // viajan con las CAJAS (pestañas 2 y 4) y JAMÁS se listan como objetos sueltos.
  const objetosContenedor = objetos.filter(esObjetoContenedor);
  const objetosSimples = objetos.filter((o) => !esObjetoContenedor(o));
  return [
    {
      clave: 'objetos-sueltos',
      titulo: '1 · Objetos sueltos',
      descripcion:
        'Objetos sin caja (contenedor_id IS NULL) que están en tránsito o sin ubicación. Excluye a todo objeto que viva dentro de una caja.',
      chips: objetosSimples.filter(esObjetoSueltoSinHogar).map(chipObjeto),
    },
    {
      clave: 'cajas-sueltas',
      titulo: '2 · Cajas sueltas',
      descripcion:
        'Cajas y contenedores en tránsito (limbo de mudanza o tránsito interno) o sin espacio físico asignado (espacio_id IS NULL).',
      chips: cajas
        .filter(cajaSinEspacio)
        .map(chipContenedor)
        .concat(objetosContenedor.filter(objetoSinEspacio).map(chipObjetoContenedor)),
    },
    {
      clave: 'objetos-reubicar',
      titulo: '3 · Objetos a reubicar',
      descripcion:
        'Objetos sin caja y sin espacio (contenedor_id IS NULL AND espacio_id IS NULL): no tienen ningún hogar asignado.',
      chips: objetosSimples
        .filter((o) => !esObjetoAlojadoEnContenedor(o) && o.ubicacion == null)
        .map(chipObjeto),
    },
    {
      clave: 'cajas-reubicar',
      titulo: '4 · Cajas a reubicar',
      descripcion:
        'Todas las cajas y contenedores que SÍ tienen un espacio físico asignado: arrastralas para moverlas a otro espacio, caja o casillero.',
      chips: cajas
        .filter((c) => !cajaSinEspacio(c))
        .map(chipContenedor)
        .concat(objetosContenedor.filter((o) => !objetoSinEspacio(o)).map(chipObjetoContenedor)),
    },
  ];
}
