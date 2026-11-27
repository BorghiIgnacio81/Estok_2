// =============================================================================
// GENERADOR VISUAL ESPACIAL · ADAPTADOR DE LA CASCADA DE PORTALES (Niveles 2-4)
// -----------------------------------------------------------------------------
// Traduce el nodo activo de la cascada al motor reutilizable:
//   · HABITACIÓN  → Nivel 2 (4 disposiciones de muebles).
//   · MUEBLE      → Nivel 3 (cajones, estantes, barrales, maleteros).
//   · ESTANTE     → Nivel 4 (4 maquetas de acomodo y apilado de cajas).
//
// Vive fuera de editorDivisionesPortales.ts para sostener el límite de
// mantenibilidad (< 400 líneas) del editor elástico.
// =============================================================================

import { abrirGeneradorVisualEspacial } from '../../../components/GeneradorVisualEspacial';
import {
  itemNuevoDesdeElemento,
  type NivelEspacial,
} from '../../generadorVisualEspacial/presetsEspaciales';
import type { ItemNuevoEspacial } from '../../lienzoElastico';
import type { NodoPortal } from './estadoPortales';
import type { InteriorNodo } from './datosNodosPortales';

/**
 * NIVEL DEL GENERADOR VISUAL para el nodo activo:
 * la TAXONOMÍA FÍSICA manda (tipo del Contenedor); el nombre y la presencia de
 * cajas hijas son el respaldo cuando el tipo todavía no se resolvió.
 */
export function nivelEspacialDeNodo(nodo: NodoPortal, interior: InteriorNodo): NivelEspacial {
  if (nodo.tipo === 'habitacion') return 2;
  const tipo = String(nodo.tipoFisico ?? '').toUpperCase();
  if (tipo === 'CONJUNTO' || tipo === 'CAJA') return 4;
  if (tipo === 'MUEBLE_INMUEBLE' || tipo === 'MUEBLE_MOVIL') return 3;
  if (/estante|repisa|biblioteca|vitrina|maletero/i.test(nodo.nombre)) return 4;
  const tieneCajas = interior.piezas.some(
    (pieza) => String(pieza.tipoFisico ?? '').toUpperCase() === 'CAJA',
  );
  return tieneCajas ? 4 : 3;
}

/** Abre el modal de 3 pasos con el contexto y el alta real del nodo activo. */
export function abrirGeneradorDivisiones(params: {
  nodo: NodoPortal;
  interior: InteriorNodo;
  /** Cantidad de subdivisiones arquitectónicas ya dibujadas en el lienzo. */
  cantidadItems: number;
  crear: (nuevo?: ItemNuevoEspacial) => Promise<boolean>;
}): void {
  const { nodo, interior, cantidadItems, crear } = params;
  const nivel = nivelEspacialDeNodo(nodo, interior);
  const cajasHijas = interior.piezas.filter(
    (pieza) => String(pieza.tipoFisico ?? '').toUpperCase() === 'CAJA',
  ).length;

  abrirGeneradorVisualEspacial({
    nivel,
    contexto: {
      titulo:
        nivel === 2
          ? `Muebles de «${nodo.nombre}»`
          : nivel === 4
            ? `Cajas dentro de «${nodo.nombre}»`
            : `Estructura de «${nodo.nombre}»`,
      descripcion:
        nivel === 2
          ? 'Elegí cuántos muebles hay y probá 4 disposiciones 2D para el cuarto.'
          : nivel === 4
            ? 'Elegí cuántas cajas acomodar y probá 4 maquetas de apilado dentro del estante.'
            : 'Probá 4 combinaciones de cajones, estantes, barrales y maleteros para este mueble.',
    },
    configuracionInicial:
      nivel === 2
        ? { muebles: Math.max(3, cantidadItems) }
        : nivel === 4
          ? { cajas: Math.max(2, cajasHijas || 6) }
          : undefined,
    crearElemento: (elemento) => crear(itemNuevoDesdeElemento(elemento)),
    crearEnBlanco: () => crear(),
    alInsertar: () => window.dispatchEvent(new CustomEvent('estok:espacios-cambiados')),
  });
}
