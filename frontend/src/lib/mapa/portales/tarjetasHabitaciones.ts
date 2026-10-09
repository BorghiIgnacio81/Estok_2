// =============================================================================
// MINI-MAPA AMPLIADO DEL NIVEL PLANTA (Panel Derecho del NIVEL INICIAL) · PURO
// -----------------------------------------------------------------------------
// MURIÓ EL TEXTO PLANO: el Panel Derecho del nivel inicial ya NO lista renglones
// de habitaciones. Dibuja el MINI-MAPA DE LA PLANTA A ESCALA AMPLIADA con el
// MISMO motor gráfico del interior recursivo (./lienzoHijos.ts → lib/minimapa.ts):
// cada POLÍGONO REAL de habitación viaja rotulado con su NOMBRE y su ICONO
// SEMÁNTICO automático (🚿 Baño · 🛏️ Habitación · 🍽️ Cocina · 🚪 Pasillo …)
// impreso ENCIMA de su silueta.
//
// Cada polígono es, a la vez, el PORTAL del nivel: al tocarlo la habitación se
// traslada al Panel Izquierdo y la derecha abre su interior jerárquico.
//
// Módulo PURO: no toca el DOM ni hace fetch (el clic lo conecta el orquestador
// por delegación con `[data-portal-abrir]`, en portalesEnlaces.ts).
// =============================================================================

import { escapeHtml } from '../../mapaJerarquico';
import type { UbicacionPlano } from '../../mapaJerarquico';
import { iconoDeHabitacion } from '../../planoHabitaciones';
import { lienzoAmpliadoHtml } from './lienzoHijos';
import type { PiezaLienzo } from './lienzoHijos';
import type { ContenedorDto } from './datosNodosPortales';

/** Rótulo estampado sobre la silueta: nombre real + espacios internos del padrón. */
function etiquetaDeHabitacion(nombre: string, espacios: number): string {
  if (!espacios) return nombre;
  return `${nombre} · ${espacios} espacio${espacios === 1 ? '' : 's'}`;
}

/** Traduce una habitación real del padrón a la pieza que dibuja el lienzo. */
function piezaDeHabitacion(room: UbicacionPlano, espacios: ContenedorDto[]): PiezaLienzo {
  const id = String(room.id);
  const nombre = String(room.nombre ?? 'Habitación');
  return {
    id,
    nombre,
    etiqueta: etiquetaDeHabitacion(nombre, espacios.length),
    // Icono semántico automático por nombre del ambiente (fuente única).
    icono: iconoDeHabitacion(nombre),
    // Silueta REAL del cuarto dentro del lienzo de la planta (proporcional).
    geometria: {
      id,
      nombre,
      ui_left: room.ui_left ?? null,
      ui_top: room.ui_top ?? null,
      ui_width: room.ui_width ?? null,
      ui_height: room.ui_height ?? null,
      fusion_grupo: room.fusion_grupo ?? null,
    },
    conDivisiones: espacios.length > 0,
  };
}

/**
 * Panel Derecho del NIVEL INICIAL: el mini-mapa AMPLIADO de la planta, con cada
 * habitación navegable (nombre + icono semántico rotulados encima de su silueta).
 * Si la planta todavía no tiene habitaciones devuelve un estado vacío explicativo
 * (nunca un panel mudo).
 */
export function listaHabitacionesHtml(
  rooms: UbicacionPlano[],
  espaciosPorRoom: Map<string, ContenedorDto[]>,
  aspecto: number,
  nombrePlanta: string | null = null,
  activoId: string | null = null,
): string {
  if (!rooms.length) {
    return `<div class="portal-vacio">
      <span class="portal-vacio-ico" aria-hidden="true">🚪</span>
      <p class="portal-vacio-texto">Esta planta todavía no tiene habitaciones encastradas. Modelala en el plano de la izquierda para poder entrar a su interior.</p>
    </div>`;
  }
  const planta = String(nombrePlanta ?? '').trim() || 'Planta activa';
  const piezas = rooms.map((r) => piezaDeHabitacion(r, espaciosPorRoom.get(String(r.id)) ?? []));
  return `<div class="portal-lienzo-planta">${lienzoAmpliadoHtml(piezas, aspecto, planta, {
    tip: `🗺️ <strong>Mini-mapa ampliado de «${escapeHtml(planta)}»</strong>: tocá la silueta de una habitación para entrar a su interior.`,
    activoId,
    atributosSector: (pieza) => [
      `data-portal-abrir="${escapeHtml(pieza.id)}"`,
      'data-portal-tipo="habitacion"',
      `data-portal-nombre="${escapeHtml(pieza.nombre)}"`,
    ].join(' '),
  })}</div>`;
}
