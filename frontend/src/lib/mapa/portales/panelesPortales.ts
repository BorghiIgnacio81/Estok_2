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
  /** Ancla: mapa de habitaciones de la planta (padre = planta). */
  | 'listaHabitaciones'
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
 * ÚNICA autoridad de la física de pantallas de Almacenamiento (Leyes de Ignacio).
 *
 *   ruta vacía        → Izq = plano de la Planta · Der = habitaciones (mini-mapas)
 *   habitación        → Izq = mapa de la PLANTA (ancla) · Der = interior del cuarto
 *   contenedor (+)    → Izq = mapa del CONTENEDOR padre  · Der = interior jerárquico
 *   contenedor (∞)    → Izq = mapa del CONTENEDOR padre  · Der = grilla de objetos
 *
 * LEY 1 (Asimetría Rígida): la IZQUIERDA es SIEMPRE el plano del CONTENEDOR (el
 * padre) y la DERECHA el interior del SELECCIONADO. Jamás comparten nodo.
 * LEY 4 (Espacio Único): la derecha salta a la grilla directa de objetos reales.
 */
export function panelesDe(nodo: NodoPortal | null, padre: NodoPortal | null = null): Paneles {
  if (!nodo) return { izquierdo: 'planoPlanta', derecho: 'listaHabitaciones' };
  const izquierdo: PanelIzquierdo = anclaDe(padre);
  const derecho: PanelDerecho = esNodoMonolitico(nodo) ? 'grillaObjetos' : 'listaContenedores';
  return { izquierdo, derecho };
}

/**
 * Ancla izquieda del flujo: el mapa del CONTENEDOR (padre) del seleccionado.
 *
 *   padre = planta (sin nodo) → mapa de habitaciones de la planta
 *   padre = cuarto            → lienzo interior del cuarto (muebles)
 *   padre = contenedor        → sub-grilla interior del contenedor
 */
function anclaDe(padre: NodoPortal | null): PanelIzquierdo {
  if (!padre) return 'listaHabitaciones';
  return padre.tipo === 'habitacion' ? 'visorHabitacion' : 'grillaNodo';
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
export function tieneModeladorGeometrico(nodo: NodoPortal | null): boolean {
  // El modelador geométrico sólo se bloquea cuando el nodo SELECCIONADO es un
  // «Espacio Único» / fin de cadena (no admite subdivisiones internas).
  return !esNodoMonolitico(nodo);
}

/** Leyendas de cabecera de cada par de paneles del flujo. */
export interface CabeceraPaneles {
  tituloIzq: string;
  tituloDer: string;
  descIzq: string;
  descDer: string;
}

/** Cabeceras (títulos + micro-ayudas) del nivel activo (física asimétrica). */
export function cabecerasDe(nodo: NodoPortal | null, paneles: Paneles): CabeceraPaneles {
  if (!nodo) {
    return {
      tituloIzq: '🏠 Plano general de la Planta',
      tituloDer: '🗺️ Mini-mapa ampliado de la planta',
      descIzq: 'Plano general de la planta activa. Tocá una habitación para abrir su interior.',
      descDer:
        'Mini-mapa ampliado de la planta: cada polígono es una habitación real, rotulada con su nombre y su icono. Tocá una silueta para entrar a su interior jerárquico.',
    };
  }
  if (paneles.derecho === 'grillaObjetos') {
    return {
      tituloIzq: '🧱 Espacio Único (ancla del contenedor)',
      tituloDer: '🔎 Objetos guardados directamente acá',
      descIzq: `Mapa del contenedor con «${nodo.nombre}» resaltado en naranja. Es un bloque monolítico: no se subdivide y el modelador geométrico queda bloqueado.`,
      descDer:
        'Grilla directa de los objetos reales que aloja este bloque. Arrastrá uno desde la canasta para guardarlo acá sin celda fina.',
    };
  }
  if (nodo.tipo === 'habitacion') {
    return {
      tituloIzq: '🧭 Plano de la planta (ancla)',
      tituloDer: '📦 Espacios, Muebles y Cajas del cuarto',
      descIzq:
        'Plano del contenedor: el cuarto seleccionado queda resaltado en naranja entre sus hermanos de la planta.',
      descDer:
        'Interior jerárquico del cuarto. Tocá un espacio para abrir su interior fino en la derecha.',
    };
  }
  return {
    tituloIzq: '🧭 Plano del contenedor (ancla)',
    tituloDer: `🧺 Interior de «${nodo.nombre}»`,
    descIzq:
      'Plano del contenedor padre: la pieza seleccionada queda resaltada en naranja entre sus hermanas.',
    descDer:
      'Interior jerárquico de la pieza activa. Tocá un elemento para abrir su interior de forma recursiva.',
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
