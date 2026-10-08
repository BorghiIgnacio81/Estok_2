// =============================================================================
// TARJETAS DE HABITACIÓN (Panel Derecho del NIVEL PLANTA) · RENDER PURO
// -----------------------------------------------------------------------------
// Nivel inicial de la cascada: el Panel Izquierdo dibuja el plano general de la
// planta y el Panel Derecho lista las HABITACIONES de esa planta, cada una con
// su MINI-MAPA DE ESPACIOS INTERNOS (siluetas proporcionales reales a partir de
// ui_left/ui_top/ui_width/ui_height de los contenedores raíz del cuarto).
//
// Cada tarjeta es, además, el PORTAL del nivel: al tocarla la habitación se
// traslada al Panel Izquierdo y la derecha abre su interior jerárquico.
//
// Módulo PURO: no toca el DOM ni hace fetch (el clic lo conecta el orquestador
// por delegación con `[data-portal-abrir]`).
// =============================================================================

import { escapeHtml } from '../../mapaJerarquico';
import type { UbicacionPlano } from '../../mapaJerarquico';
import { ASPECTO_LIENZO } from '../../minimapa';
import { renderMinimapasAnidados } from '../../minimapasAnidados';
import { sectoresDeItems } from '../../sectoresMinimapa';
import { iconoDeHabitacion } from '../../planoHabitaciones';
import type { ContenedorDto } from './datosNodosPortales';

/** Mini-mapa interno de un cuarto: sus espacios reales en silueta proporcional. */
function minimapaInternoHtml(
  nombre: string,
  id: string,
  espacios: ContenedorDto[],
  aspecto: number,
): string {
  const sectores = sectoresDeItems(
    espacios.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      ui_left: c.ui_left,
      ui_top: c.ui_top,
      ui_width: c.ui_width,
      ui_height: c.ui_height,
      fusion_grupo: c.fusion_grupo,
    })),
    null,
  );
  return renderMinimapasAnidados(
    [
      {
        tipo: 'habitacion',
        nombre,
        id,
        sectores,
        aspecto: aspecto || ASPECTO_LIENZO,
      },
    ],
    { hermanas: true },
  );
}

/**
 * Tarjeta de una habitación con el mini-mapa de sus espacios internos.
 * `data-portal-abrir` la convierte en PORTAL hacia su interior jerárquico.
 */
export function tarjetaHabitacionHtml(
  room: UbicacionPlano,
  espacios: ContenedorDto[],
  aspecto: number,
): string {
  const id = String(room.id);
  const nombre = String(room.nombre ?? 'Habitación');
  const icono = iconoDeHabitacion(nombre);
  const cantidad = espacios.length;
  const detalle = cantidad
    ? `${cantidad} espacio${cantidad === 1 ? '' : 's'} interno${cantidad === 1 ? '' : 's'}`
    : 'Sin espacios internos todavía';
  return `<article class="portal-tarjeta portal-tarjeta-room${cantidad ? '' : ' portal-tarjeta-vacia'}"
    data-portal-abrir="${escapeHtml(id)}"
    data-portal-tipo="habitacion"
    data-portal-nombre="${escapeHtml(nombre)}"
    title="Entrar a «${escapeHtml(nombre)}»: la habitación pasa al panel izquierdo y sus espacios se abren a la derecha">
    <div class="portal-tarjeta-cab">
      <span class="portal-tarjeta-ico" aria-hidden="true">${icono}</span>
      <span class="portal-tarjeta-nombre">${escapeHtml(nombre)}</span>
      <span class="portal-tarjeta-flecha" aria-hidden="true">→</span>
    </div>
    ${
      cantidad
        ? `<div class="portal-tarjeta-minimapa">${minimapaInternoHtml(nombre, id, espacios, aspecto)}</div>`
        : ''
    }
    <span class="portal-tarjeta-detalle">${escapeHtml(detalle)}</span>
  </article>`;
}

/**
 * Listado completo del Panel Derecho en el NIVEL PLANTA. Si la planta todavía no
 * tiene habitaciones devuelve un estado vacío explicativo (nunca un panel mudo).
 */
export function listaHabitacionesHtml(
  rooms: UbicacionPlano[],
  espaciosPorRoom: Map<string, ContenedorDto[]>,
  aspecto: number,
): string {
  if (!rooms.length) {
    return `<div class="portal-vacio">
      <span class="portal-vacio-ico" aria-hidden="true">🚪</span>
      <p class="portal-vacio-texto">Esta planta todavía no tiene habitaciones encastradas. Modelala en el plano de la izquierda para poder entrar a su interior.</p>
    </div>`;
  }
  const tarjetas = rooms
    .map((r) => tarjetaHabitacionHtml(r, espaciosPorRoom.get(String(r.id)) ?? [], aspecto))
    .join('');
  return `<div class="portal-lista portal-lista-rooms">${tarjetas}</div>`;
}
