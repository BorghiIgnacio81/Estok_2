// =============================================================================
// FÍSICA DUAL ASIMÉTRICA DE PANELES (PADRE ancla ⇄ HIJO explorador)
// -----------------------------------------------------------------------------
// LEY 1 (ASIMETRÍA RÍGIDA · el fuelle de Ignacio):
//   · El Panel IZQUIERDO CONSERVA SIEMPRE el mapa del NIVEL SUPERIOR (`superior`)
//     y pinta al HIJO activo en NARANJA (#f97316). Es un ANCLA QUIETA: nunca
//     dibuja el interior del nodo activo.
//   · El Panel DERECHO AVANZA SIEMPRE al interior del nodo ACTIVO (`activo`), N+1.
//   Como cada columna mira a un nodo DISTINTO, es imposible que compartan mapa.
//   Además, cada panel tiene un HOST DOM EXCLUSIVO por lado (ver HOSTS): un
//   mismo contenedor jamás salta de columna, por lo que el clon en espejo queda
//   estructuralmente bloqueado.
//
// LEY 4 (Espacio Único, REVERSIBLE): el ÚNICO fin de cadena es `espacio_unico`.
//   Si el ACTIVO es monolítico, la derecha salta a la grilla de objetos; destildarlo
//   devuelve el modelador en caliente (`tieneModeladorGeometrico`).
//
// Módulo 100% PURO: decide y describe, nunca toca el DOM.
// =============================================================================

import { esNodoMonolitico } from './estadoPortales';
import type { NodoPortal } from './estadoPortales';

/** Paneles posibles del lado IZQUIERDO (ANCLA: el mapa del NIVEL SUPERIOR). */
export type PanelIzquierdo =
  /** Nivel raíz: silueta general del Estok con sus N plantas. */
  | 'planoPlanta'
  /** Superior = PLANTA: mapa de habitaciones con el cuarto elegido en naranja. */
  | 'plantaConHabitaciones'
  /** Superior = CUARTO: lienzo interior del cuarto con el hijo elegido en naranja. */
  | 'visorHabitacion'
  /** Superior = CONTENEDOR: sub-grilla interna con el hijo elegido en naranja. */
  | 'grillaNodo';

/** Paneles posibles del lado DERECHO (EXPLORADOR: el interior del nodo ACTIVO). */
export type PanelDerecho =
  /** Espera raíz (sin planta): un mini-mapa independiente por planta del Estok. */
  | 'plantasEnEspera'
  /** Espera planta: habitaciones de la planta elegida, a la espera de un cuarto. */
  | 'habitacionesEnEspera'
  /** Explorador: interior jerárquico del nodo activo (editor elástico recursivo). */
  | 'listaContenedores'
  /** Fin de cadena (Ley 4): grilla DIRECTA de objetos del nodo activo monolítico. */
  | 'grillaObjetos';

/**
 * CONTEXTO RELACIONAL DEL NIVEL: aísla los DOS contextos que jamás deben
 * mezclarse. Es la ÚNICA entrada de `panelesDe` → matemáticamente imposible el
 * espejo entre cuadrantes.
 */
export interface ContextoNivel {
  /** Tope de la pila (HIJO): lo dibuja el Panel Derecho. `null` = raíz. */
  activo: NodoPortal | null;
  /** Nivel N-1 (PADRE): lo mantiene el Panel Izquierdo. `null` = es la PLANTA. */
  superior: NodoPortal | null;
  /** ¿Hay una planta del Estok elegida (contexto del nivel raíz)? */
  plantaFijada: boolean;
}

export interface Paneles {
  izquierdo: PanelIzquierdo;
  derecho: PanelDerecho;
}

/**
 * ÚNICA autoridad de la física de pantallas de Almacenamiento (Leyes de Ignacio).
 *
 *   activo = null, sin planta → Izq = plano del Estok · Der = espera (plantas)
 *   activo = null, con planta → Izq = plano del Estok · Der = espera (cuartos)
 *   activo = habitación      → Izq = PLANTA (cuarto naranja) · Der = interior
 *   activo = contenedor (+)  → Izq = mapa del PADRE      · Der = interior
 *   activo = contenedor (∞)  → Izq = mapa del PADRE      · Der = grilla de objetos
 */
export function panelesDe(ctx: ContextoNivel): Paneles {
  return { izquierdo: anclaDe(ctx), derecho: exploradorDe(ctx) };
}

/**
 * LEY 1 · ¿Qué monta el Panel DERECHO? El interior del ACTIVO. TODO nodo NO
 * monolítico —planta, habitación, mueble, estante, caja o pieza VACÍA recién
 * creada— expone su EDITOR ELÁSTICO de divisiones (aunque todavía no tenga
 * sub-zonas). El ÚNICO fin de cadena (grilla directa de objetos) es el «Espacio
 * Único» declarado (`espacio_unico = true`); es reversible (Ley 4).
 */
function exploradorDe({ activo, plantaFijada }: ContextoNivel): PanelDerecho {
  if (!activo) return plantaFijada ? 'habitacionesEnEspera' : 'plantasEnEspera';
  return esNodoMonolitico(activo) ? 'grillaObjetos' : 'listaContenedores';
}

/**
 * LEY 1 · ¿Qué monta el Panel IZQUIERDO (ancla)? SÓLO consulta al SUPERIOR:
 *   activo = raíz          → silueta general del Estok con sus N plantas.
 *   superior = PLANTA      → mapa de habitaciones (cuarto elegido en naranja).
 *   superior = CUARTO      → lienzo interior del cuarto (hijo elegido en naranja).
 *   superior = CONTENEDOR  → sub-grilla interna (hijo elegido en naranja).
 * Jamás consulta al ACTIVO: por eso no puede reflejar el mismo mapa que la
 * derecha (el clon en espejo queda estructuralmente bloqueado).
 */
function anclaDe({ activo, superior }: ContextoNivel): PanelIzquierdo {
  if (!activo) return 'planoPlanta';
  if (!superior) return 'plantaConHabitaciones';
  return superior.tipo === 'habitacion' ? 'visorHabitacion' : 'grillaNodo';
}

/**
 * ¿El nivel activo admite el MODELADOR geométrico? Es decir: ¿expone un lienzo
 * elástico capaz de inyectar celdas nuevas (`data-lienzo-crear`)?
 *
 * Autoridad PURA que consulta la barra de comandos para habilitar el interruptor
 * «✏️ Editar» a CUALQUIER profundidad de la pila (`ruta: NodoPortal[]`). El ÚNICO
 * nivel sin modelador es el «Espacio Único» declarado (`espacio_unico = true`):
 * cualquier otra pieza —aunque esté vacía— lo expone SIEMPRE (regla reversible).
 */
export function tieneModeladorGeometrico(nodo: NodoPortal | null): boolean {
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
export function cabecerasDe(ctx: ContextoNivel, paneles: Paneles): CabeceraPaneles {
  const nodo = ctx.activo;
  if (!nodo) {
    return {
      tituloIzq: '🏠 Silueta general del Estok (sus plantas)',
      tituloDer: ctx.plantaFijada
        ? '🗺️ Habitaciones de la planta elegida'
        : '🗺️ Mini-mapas independientes de cada planta',
      descIzq:
        'Plano del Estok con sus N plantas, en estado de espera. Tocá una planta para fijarla a la izquierda y desplegar sus habitaciones a la derecha.',
      descDer: ctx.plantaFijada
        ? 'Habitaciones de la planta elegida, a la espera de que elijas un cuarto.'
        : 'Un mini-mapa por planta, a la espera de selección. Tocá una planta para desplegar sus habitaciones.',
    };
  }
  if (paneles.derecho === 'grillaObjetos') {
    return {
      tituloIzq: '🧱 Ancla del contenedor (nivel superior)',
      tituloDer: `🔎 Objetos guardados en «${nodo.nombre}»`,
      descIzq: `Ancla quieta: el mapa del nivel superior con «${nodo.nombre}» resaltado en naranja. Es un bloque monolítico (Espacio Único): no se subdivide.`,
      descDer:
        'Lista de objetos guardados directamente acá. Arrastrá uno desde la canasta para guardarlo sin celda fina.',
    };
  }
  if (paneles.izquierdo === 'plantaConHabitaciones') {
    return {
      tituloIzq: '🧭 Plano de la planta (ancla)',
      tituloDer: '📦 Espacios, Muebles y Cajas del cuarto',
      descIzq:
        'Ancla quieta: el cuarto seleccionado queda resaltado en naranja entre sus hermanos de la planta.',
      descDer:
        'Interior jerárquico del cuarto. Tocá un espacio para bajar a su interior fino.',
    };
  }
  return {
    tituloIzq: '🧭 Plano del contenedor (ancla)',
    tituloDer: `🧺 Interior de «${nodo.nombre}»`,
    descIzq:
      'Ancla quieta: el mapa del nivel superior con la pieza seleccionada resaltada en naranja.',
    descDer:
      'Interior jerárquico de la pieza activa. Tocá un elemento para abrir su interior de forma recursiva.',
  };
}

/**
 * Ids DOM de los HOSTS que la cascada mueve entre columnas. Cada panel tiene un
 * host EXCLUSIVO por lado: la izquierda (ancla) y la derecha (explorador) nunca
 * comparten contenedor → no hay clon en espejo entre cuadrantes.
 */
export const HOSTS = {
  // ── IZQUIERDA (ANCLA: mapa del NIVEL SUPERIOR con el hijo en naranja) ──
  /** Raíz: plano general del Estok (casa a dos aguas con sus plantas). */
  planoPlanta: 'mapaEstokPanel',
  /** Superior = PLANTA: mapa de habitaciones (host DEDICADO de la izquierda). */
  plantaConHabitaciones: 'anclaHabitacionesPanel',
  /** Superior = CUARTO: Visor de Habitación histórico (lienzo interior del cuarto). */
  visorHabitacion: 'visorHabitacion',
  /** Superior = CONTENEDOR: Visor Contenedor Grande histórico (sub-grilla interna). */
  grillaNodo: 'visorContenedorGrande',
  // ── DERECHA (EXPLORADOR: interior del nodo ACTIVO) ──
  /** Espera raíz (sin planta): un mini-mapa por planta (host DEDICADO). */
  plantasEnEspera: 'listaPlantasPanel',
  /** Espera planta: habitaciones de la planta elegida. */
  habitacionesEnEspera: 'listaHabitacionesPanel',
  /** Explorador: interior jerárquico recursivo del nodo activo. */
  listaContenedores: 'listaContenedoresPanel',
  /** Fin de cadena: grilla directa de objetos reales. */
  grillaObjetos: 'grillaObjetosPanel',
} as const;

export type ClaveHost = keyof typeof HOSTS;

/** Todos los hosts de la cascada (se ocultan antes de encender los del nivel). */
export const TODOS_LOS_HOSTS: string[] = Object.values(HOSTS);

/** Par [hostIzquierdo, hostDerecho] del nivel activo, ya resuelto a ids DOM. */
export function hostsDe(paneles: Paneles): [string, string] {
  return [HOSTS[paneles.izquierdo], HOSTS[paneles.derecho]];
}
