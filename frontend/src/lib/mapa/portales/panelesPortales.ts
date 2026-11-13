// =============================================================================
// FÍSICA DUAL ASIMÉTRICA DE PANELES (PADRE ancla ⇄ HIJO explorador)
// -----------------------------------------------------------------------------
// LEY 1 (ASIMETRÍA RÍGIDA · el fuelle de Ignacio):
//   · El Panel IZQUIERDO CONSERVA SIEMPRE el mapa del NIVEL SUPERIOR (`superior`)
//     y pinta al HIJO activo en NARANJA (#f97316). Es el MINIMAPA PADRE: nunca
//     dibuja el interior del nodo activo y jamás lleva carteles de texto.
//   · El Panel DERECHO AVANZA SIEMPRE al interior del nodo ACTIVO (`activo`), N+1.
//   Como cada columna mira a un nodo DISTINTO, es imposible que compartan mapa.
//   Además, cada panel tiene un HOST DOM EXCLUSIVO por lado (ver HOSTS): un
//   mismo contenedor jamás salta de columna, por lo que el clon en espejo queda
//   estructuralmente bloqueado.
//
// LEY 4 (Espacio Final, REVERSIBLE): el ÚNICO fin de cadena es el ESPACIO FINAL.
//   Si el ACTIVO es terminal, el lienzo 2D del PROPIO nodo no existe (no hay
//   sub-espacios arquitectónicos que dibujar) y la DERECHA monta el Panel de
//   Contenido (tarjetas + zona receptora de Drop). La IZQUIERDA NO SE OCULTA:
//   conserva el plano del nivel superior con el nodo terminal en NARANJA y la
//   tira acumulada de minimapas, porque la pantalla mantiene SIEMPRE la
//   estructura de dos cuadrantes en toda la jerarquía.
//   Destildarlo / «Modelar divisiones» devuelve el modelador en caliente
//   (`tieneModeladorGeometrico`).
//
// Módulo 100% PURO: decide y describe, nunca toca el DOM.
// =============================================================================

import { esEspacioFinal } from './estadoPortales';
import type { NodoPortal } from './estadoPortales';
// TÍTULO EXACTO del nivel terminal: fuente ÚNICA compartida con el selector de
// piezas (lib/mapa/portales/textosPortales.ts). Nunca se escribe dos veces.
import { TITULO_CAJAS_NIVEL } from './textosPortales';

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
  /**
   * ESPACIO FINAL: Panel de Contenido limpio —tarjetas de las cajas/sub-espacios
   * y objetos que aloja + zona receptora de Drag & Drop de área completa—, sin
   * lienzo/mapa 2D.
   */
  | 'contenidoFinal';

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
 *   activo = ESPACIO FINAL   → Izq = mapa del PADRE      · Der = contenido
 * La IZQUIERDA nunca se apaga: los dos cuadrantes se mantienen en toda la
 * jerarquía, incluso en el nivel terminal (Estante, Cajón, Caja).
 */
export function panelesDe(ctx: ContextoNivel): Paneles {
  return { izquierdo: anclaDe(ctx), derecho: exploradorDe(ctx) };
}

/**
 * LEY 1 · ¿El Panel Izquierdo es el MINIMAPA PADRE?
 *
 * El cuadrante izquierdo NUNCA dibuja el nivel actual: dibuja el minimapa del
 * nivel INMEDIATAMENTE SUPERIOR (Casa → Planta → Habitación → Mueble → Caja) con
 * el nodo donde está parado el operador resaltado en NARANJA (#f97316).
 *
 * En esos niveles el minimapa es PURAMENTE GRÁFICO: sin título, sin leyenda, sin
 * ayudas y sin rótulos de texto (recordatorio visual de ubicación y nada más).
 *
 * La vista raíz de la Casa (Nivel 1, sin planta fijada) NO tiene padre: el
 * cuadrante izquierdo es el plano general del Estok y conserva su cabecera.
 * Un ESPACIO FINAL (Estante, Cajón, Caja) TAMPOCO apaga la izquierda: el plano
 * del nivel superior con el nodo terminal resaltado en NARANJA sigue visible, de
 * modo que la estructura de dos cuadrantes se mantiene en toda la jerarquía.
 */
export function esMinimapaPadre(ctx: ContextoNivel): boolean {
  return Boolean(ctx.activo) || ctx.plantaFijada;
}

/**
 * LEY 1 · ¿Qué monta el Panel DERECHO? El interior del ACTIVO.
 *
 *   · ESPACIO FINAL (nivel terminal sin sub-espacios arquitectónicos) → Panel de
 *     Contenido: tarjetas de lo que aloja + zona receptora de Drag & Drop, sin
 *     lienzo/mapa 2D.
 *   · Cualquier otro nodo —planta, habitación, mueble, estante con divisiones—
 *     expone su EDITOR ELÁSTICO de divisiones.
 */
function exploradorDe({ activo, plantaFijada }: ContextoNivel): PanelDerecho {
  if (!activo) return plantaFijada ? 'habitacionesEnEspera' : 'plantasEnEspera';
  return esEspacioFinal(activo) ? 'contenidoFinal' : 'listaContenedores';
}

/**
 * LEY 1 · ¿Qué monta el Panel IZQUIERDO (ancla)? SÓLO consulta al SUPERIOR:
 *   activo = raíz          → silueta general del Estok con sus N plantas.
 *   superior = PLANTA      → mapa de habitaciones (cuarto elegido en naranja).
 *   superior = CUARTO      → lienzo interior del cuarto (hijo elegido en naranja).
 *   superior = CONTENEDOR  → sub-grilla interna (hijo elegido en naranja).
 * Jamás consulta al ACTIVO para dibujar su interior: por eso no puede reflejar
 * el mismo mapa que la derecha (el clon en espejo queda estructuralmente
 * bloqueado). Un ESPACIO FINAL no es una excepción: la izquierda sigue siendo el
 * plano del padre con el estante/caja activo en naranja.
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
 * nivel sin modelador es el ESPACIO FINAL (declarado o detectado); cualquier
 * otra pieza lo expone SIEMPRE (regla reversible).
 */
export function tieneModeladorGeometrico(nodo: NodoPortal | null): boolean {
  return !esEspacioFinal(nodo);
}

/** Leyendas de cabecera de cada par de paneles del flujo. */
export interface CabeceraPaneles {
  tituloIzq: string;
  tituloDer: string;
  descIzq: string;
  descDer: string;
}

/**
 * Cabeceras (títulos + micro-ayudas) del nivel activo (física asimétrica).
 *
 * REGLA DE LIMPIEZA VISUAL: cuando el Panel Izquierdo es el MINIMAPA PADRE (todo
 * nivel por debajo de la vista raíz de la Casa), NO lleva título ni leyenda: es
 * un recordatorio visual puro. El texto explicativo se reserva para el Panel
 * Derecho, que es el mapa del nivel ACTUAL.
 */
export function cabecerasDe(ctx: ContextoNivel, paneles: Paneles): CabeceraPaneles {
  const cab = cabecerasDelNivel(ctx, paneles);
  if (!esMinimapaPadre(ctx)) return cab;
  // MINIMAPA PADRE: se CONSERVA el título del nivel (nombre del espacio donde
  // está parado el operador) y sólo se retira la leyenda explicativa larga.
  // La tira acumulada de minimapas de los niveles superiores vive en
  // `#minimapasAnidados` (lib/mapa/portales/minimapasAnidadosContexto.ts) y
  // convive con este título.
  return { ...cab, descIzq: '' };
}

/** Cabeceras por nivel (antes de aplicar la limpieza visual del minimapa padre). */
function cabecerasDelNivel(ctx: ContextoNivel, paneles: Paneles): CabeceraPaneles {
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
  if (paneles.derecho === 'contenidoFinal') {
    return {
      // ESPACIO FINAL: el lienzo del PROPIO nodo no existe, pero el cuadrante
      // izquierdo SÍ se mantiene (plano del nivel superior con el estante/caja
      // activo en naranja + tira de minimapas), así que conserva su título de
      // contexto. El ENCABEZADO derecho lleva el título EXACTO del nivel: la
      // leyenda del explorador jerárquico («Interior jerárquico de la pieza
      // activa…») no aplica porque acá no hay descenso geométrico.
      tituloIzq: '🧭 Plano del nivel superior',
      tituloDer: TITULO_CAJAS_NIVEL,
      descIzq: '',
      descDer: '',
    };
  }
  if (paneles.izquierdo === 'plantaConHabitaciones') {
    return {
      tituloIzq: '🧭 Plano de la planta',
      tituloDer: '📦 Espacios, Muebles y Cajas del cuarto',
      // SIN LEYENDA explicativa: el cuadrante izquierdo es el MINIMAPA PADRE
      // (gráfico puro) y se explica solo con el resalte naranja del cuarto activo.
      descIzq: '',
      descDer:
        'Interior jerárquico del cuarto. Tocá un espacio para bajar a su interior fino.',
    };
  }
  return {
    tituloIzq: '🧭 Plano del nivel superior',
    tituloDer: `🧺 Interior de «${nodo.nombre}»`,
    // SIN LEYENDA: el cuadrante izquierdo es el MINIMAPA PADRE (gráfico puro).
    descIzq: '',
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
  /** ESPACIO FINAL: Panel de Contenido (tarjetas + zona receptora de Drop). */
  contenidoFinal: 'panelEspacioFinalPanel',
} as const;

/** Todos los hosts de la cascada (se ocultan antes de encender los del nivel). */
export const TODOS_LOS_HOSTS: string[] = Object.values(HOSTS).filter((id) => id.length > 0);

/** Par [hostIzquierdo, hostDerecho] del nivel activo, ya resuelto a ids DOM. */
export function hostsDe(paneles: Paneles): [string, string] {
  return [HOSTS[paneles.izquierdo], HOSTS[paneles.derecho]];
}

