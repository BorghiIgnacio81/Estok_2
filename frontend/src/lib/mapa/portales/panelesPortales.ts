// =============================================================================
// FÍSICA DUAL DE PANELES: quién se dibuja a la IZQUIERDA y quién a la DERECHA
// -----------------------------------------------------------------------------
// REGLA CANÓNICA (cascada asimétrica recursiva):
//
//   · El nodo elegido en el Panel Derecho se traslada DE INMEDIATO al Panel
//     Izquierdo, donde se dibuja su sub-grilla elástica interna de divisiones.
//   · El Panel Derecho TRANSMUTA y abre el interior jerárquico de ese nodo
//     (sus sub-contenedores, estantes o cajas) SIN límite de profundidad.
//   · Si el nodo es «Espacio Único» / sin divisiones, se bloquea el modelador
//     geométrico de la izquierda y la derecha pasa a la GRILLA DIRECTA de
//     objetos reales (fin de cadena).
//
// Módulo 100% PURO: decide y describe, nunca toca el DOM.
// =============================================================================

import { esNodoMonolitico } from './estadoPortales';
import type { NodoPortal } from './estadoPortales';

/** Paneles posibles del lado IZQUIERDO (el nodo activo y su grilla). */
export type PanelIzquierdo =
  /** Nivel raíz: plano general de la planta activa. */
  | 'planoPlanta'
  /** Habitación abierta: Visor de Habitación (lienzo elástico del cuarto). */
  | 'visorHabitacion'
  /** Contenedor con divisiones: sub-grilla elástica interna + Drop Zones F·C. */
  | 'grillaNodo'
  /** Espacio Único: bloque monolítico, modelador geométrico BLOQUEADO. */
  | 'bloqueMonolitico';

/** Paneles posibles del lado DERECHO (el interior del nodo activo). */
export type PanelDerecho =
  /** Habitaciones de la planta, cada una con su mini-mapa de espacios internos. */
  | 'listaHabitaciones'
  /** Interior jerárquico: sub-contenedores/estantes/cajas del nodo activo. */
  | 'listaContenedores'
  /** Fin de cadena: grilla DIRECTA de los objetos reales del nodo activo. */
  | 'grillaObjetos';

export interface Paneles {
  izquierdo: PanelIzquierdo;
  derecho: PanelDerecho;
}

/**
 * ÚNICA autoridad de la física de pantallas de Almacenamiento.
 *
 *   ruta vacía        → Izq = plano de la Planta · Der = habitaciones (mini-mapas)
 *   habitación        → Izq = Visor de Habitación · Der = espacios/muebles del cuarto
 *   contenedor (+)    → Izq = sub-grilla del propio nodo · Der = interior jerárquico
 *   contenedor (∞)    → Izq = bloque monolítico       · Der = grilla de objetos reales
 */
export function panelesDe(nodo: NodoPortal | null): Paneles {
  if (!nodo) return { izquierdo: 'planoPlanta', derecho: 'listaHabitaciones' };
  // DISYUNTOR DE ESTRUCTURA (aplica a CUALQUIER nodo: cuarto o contenedor): un
  // «Espacio Único» bloquea el modelador geométrico y la derecha va directo a la
  // grilla de objetos reales.
  if (nodo.espacioUnico) {
    return { izquierdo: 'bloqueMonolitico', derecho: 'grillaObjetos' };
  }
  if (nodo.tipo === 'habitacion') {
    return { izquierdo: 'visorHabitacion', derecho: 'listaContenedores' };
  }
  // Contenedor (a cualquier profundidad): sin divisiones todavía, también es fin
  // de cadena (bloque monolítico + objetos directos).
  const sinDivisiones = esNodoMonolitico(nodo);
  return {
    izquierdo: sinDivisiones ? 'bloqueMonolitico' : 'grillaNodo',
    derecho: sinDivisiones ? 'grillaObjetos' : 'listaContenedores',
  };
}

/**
 * ¿El nivel activo admite el MODELADOR geométrico? Es decir: ¿su Panel Izquierdo
 * expone un lienzo elástico capaz de inyectar celdas nuevas (`data-lienzo-crear`)?
 *
 * Autoridad PURA que consulta la barra de comandos para habilitar el interruptor
 * «✏️ Editar» a CUALQUIER profundidad de la pila (`ruta: NodoPortal[]`). El único
 * nivel sin modelador es el bloque monolítico («Espacio Único»), que por
 * definición no se subdivide.
 */
export function tieneModeladorGeometrico(paneles: Paneles): boolean {
  return paneles.izquierdo !== 'bloqueMonolitico';
}

/** Leyendas de cabecera de cada par de paneles del flujo. */
export interface CabeceraPaneles {
  tituloIzq: string;
  tituloDer: string;
  descIzq: string;
  descDer: string;
}

/** Cabeceras (títulos + micro-ayudas) del nivel activo. */
export function cabecerasDe(nodo: NodoPortal | null, paneles: Paneles): CabeceraPaneles {
  if (!nodo) {
    return {
      tituloIzq: '🏠 Plano general de la Planta',
      tituloDer: '🚪 Habitaciones de la planta',
      descIzq: 'Plano general de la planta activa. Tocá una habitación para abrir su interior.',
      descDer:
        'Habitaciones de la planta con el mini-mapa de sus espacios internos. Elegí una para entrar a su interior.',
    };
  }
  if (paneles.derecho === 'grillaObjetos') {
    return {
      tituloIzq: '🧱 Espacio Único (bloque monolítico)',
      tituloDer: '🔎 Objetos guardados directamente acá',
      descIzq: `«${nodo.nombre}» es un bloque monolítico: no se subdivide, el modelador geométrico queda bloqueado y los objetos se guardan de forma directa.`,
      descDer:
        'Grilla directa de los objetos reales que aloja este bloque. Arrastrá uno desde la canasta para guardarlo acá sin celda fina.',
    };
  }
  if (nodo.tipo === 'habitacion') {
    return {
      tituloIzq: '🧭 Visor de Habitación',
      tituloDer: '📦 Espacios, Muebles y Cajas del cuarto',
      descIzq: 'Interior de la habitación activa: acomodá los espacios en el lienzo elástico.',
      descDer:
        'Interior jerárquico del cuarto. Elegí un espacio para que pase al panel izquierdo y abra sus divisiones.',
    };
  }
  return {
    tituloIzq: `🧰 Organización interna de «${nodo.nombre}»`,
    tituloDer: '🧺 Sub-contenedores, estantes y cajas',
    descIzq:
      'Sub-grilla elástica del contenedor activo. Tocá una pieza para descender a su interior de forma recursiva.',
    descDer:
      'Interior jerárquico del contenedor activo. Elegí una pieza para que se traslade a la izquierda y abra su propio nivel.',
  };
}

/**
 * Ids DOM de los HOSTS que la cascada mueve entre columnas. Los hosts nuevos
 * viven en almacenamiento.astro y los reutilizados pertenecen a los módulos
 * históricos (mapa Estok, Visor de Habitación, Visor Contenedor Grande).
 */
export const HOSTS = {
  /** Nivel raíz (izquierda): plano general de la planta. */
  planoPlanta: 'mapaEstokPanel',
  /** Habitación (izquierda): Visor de Habitación histórico. */
  visorHabitacion: 'visorHabitacion',
  /** Contenedor con divisiones (izquierda): sub-grilla histórica del visor. */
  grillaNodo: 'visorContenedorGrande',
  /** Espacio Único (izquierda): bloque monolítico nuevo. */
  bloqueMonolitico: 'bloqueMonoliticoPanel',
  /** Nivel raíz (derecha): habitaciones con mini-mapas internos. */
  listaHabitaciones: 'listaHabitacionesPanel',
  /** Interior jerárquico (derecha, recursivo). */
  listaContenedores: 'listaContenedoresPanel',
  /** Fin de cadena (derecha): objetos reales guardados directamente. */
  grillaObjetos: 'grillaObjetosPanel',
} as const;

export type ClaveHost = keyof typeof HOSTS;

/** Todos los hosts de la cascada (se ocultan antes de encender los del nivel). */
export const TODOS_LOS_HOSTS: string[] = Object.values(HOSTS);

/** Par [hostIzquierdo, hostDerecho] del nivel activo, ya resuelto a ids DOM. */
export function hostsDe(paneles: Paneles): [string, string] {
  return [HOSTS[paneles.izquierdo], HOSTS[paneles.derecho]];
}
