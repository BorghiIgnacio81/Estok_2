// =============================================================================
// ENLACE PROFUNDO AL MAPA ESPACIAL (/almacenamiento?contenedor=<id>)
// -----------------------------------------------------------------------------
// El listado de /objetos ofrece en cada caja el botón «🗺️ Ver en el mapa»
// (lib/rutaGeograficaWidget.ts). Este módulo es la contraparte en el arranque de
// la cascada de portales: abre la POSICIÓN real de esa caja dentro del mapa
// espacial apilando la ruta completa de nodos (planta → habitación → mueble →
// caja), en vez de dejar al operador en el nivel raíz buscándola a mano.
//
// Toda la física la aporta el motor existente: acá NO se dibuja nada ni se
// reimplementan reglas. Sólo se arma la pila con los datos del padrón
// (datosNodosPortales.ts) y se pide UN refresco del nivel.
//
// Secuencia (no alterar sin verificar):
//   1. PLANTA ACTIVA → mismo evento público que el clic en la casa
//      (`estok:planta-elegida`): el plano general la marca en NARANJA y la
//      cascada fija la planta de la barra de minimapas.
//   2. HABITACIÓN → `nodoDeHabitacion`.
//   3. CADENA de contenedores raíz → … → caja (con la geometría de sus hijos,
//      que alimentan los minimapas de las migas).
//   4. `refrescarNivel()` una sola vez.
// =============================================================================

import { contenedorDesdeUrl } from '../rutaMapaAlmacenamiento';
import {
  cargarContenedores,
  cargarHabitacionesDePlanta,
  cargarPlantas,
  contenedoresHijosDe,
  geometriaDe,
} from './datosNodosPortales';
import type { ContenedorDto } from './datosNodosPortales';
import { empujarNodo, fijarPlanta, limpiarRuta } from './estadoPortales';
import {
  estaRefrescando,
  nodoDeContenedor,
  nodoDeHabitacion,
  refrescarNivel,
} from './portalesAlmacenamiento';

/** Tope de espera del refresco en vuelo (el render normal tarda << 1 s). */
const ESPERA_MAXIMA_MS = 2000;
/** Grano del sondeo del disyuntor `refrescando`. */
const PASO_MS = 50;

/** Promesa que se resuelve tras `ms` milisegundos. */
function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => {
    window.setTimeout(resolver, ms);
  });
}

/**
 * Espera a que el motor termine el refresco que disparó el evento de planta.
 *
 * `refrescarNivel()` es re-entrante: si llega mientras otro refresco está en
 * vuelo lo ignora (disyuntor `refrescando`). Sin esta pausa, la navegación del
 * enlace profundo podría quedar absorbida por el refresco del nivel raíz.
 */
async function esperarRefrescoQuieto(): Promise<void> {
  const inicio = Date.now();
  await esperar(PASO_MS);
  while (estaRefrescando() && Date.now() - inicio < ESPERA_MAXIMA_MS) {
    await esperar(PASO_MS);
  }
}

/** Cadena jerárquica raíz → … → destino (vacía si el id no existe). */
function cadenaHasta(destino: string, contenedores: ContenedorDto[]): ContenedorDto[] {
  const porId = new Map(contenedores.map((c) => [c.id, c]));
  const cadena: ContenedorDto[] = [];
  const visitados = new Set<string>();
  let actual = porId.get(destino);
  while (actual && !visitados.has(actual.id)) {
    visitados.add(actual.id);
    cadena.unshift(actual);
    actual = actual.parent_contenedor ? porId.get(actual.parent_contenedor) : undefined;
  }
  return cadena;
}


/**
 * Abre en el mapa de /almacenamiento la posición del contenedor pedido.
 *
 * Devuelve `true` sólo si la cascada quedó posicionada en ese nodo. Cualquier
 * dato faltante (caja borrada, habitación inexistente, contexto sin cargar)
 * devuelve `false` y la pantalla se queda, sin errores, en su nivel raíz.
 */
export async function abrirContenedorEnMapa(id: string): Promise<boolean> {
  const destino = String(id || '').trim();
  if (!destino) return false;
  try {
    const cadena = cadenaHasta(destino, await cargarContenedores());
    if (cadena.length === 0) return false;

    const ubicacionId = cadena.map((pieza) => pieza.ubicacion).find((u) => Boolean(u)) ?? null;
    if (!ubicacionId) return false;
    const rooms = await cargarHabitacionesDePlanta(null);
    const room = rooms.find((r) => String(r.id) === String(ubicacionId));
    if (!room) return false;

    // 1) PLANTA ACTIVA de la habitación (barra de minimapas + plano en NARANJA).
    const plantas = await cargarPlantas();
    const division = plantas.find((p) => String(p.id) === String(room.parent_ubicacion ?? '')) ?? null;
    const fila = division?.parent_grid_row ?? room.parent_grid_row ?? 1;
    fijarPlanta({
      fila,
      nombre: division?.nombre ?? '',
      total: Math.max(1, plantas.length),
      hermanas: geometriaDe(
        rooms.filter((r) => String(r.parent_ubicacion ?? '') === String(division?.id ?? '')),
      ),
    });
    // Mismo evento público que el clic del operador en la casa: el plano general
    // queda con esa planta seleccionada y el motor fija su contexto.
    window.dispatchEvent(new CustomEvent('estok:planta-elegida', { detail: { fila } }));
    await esperarRefrescoQuieto();

    // 2) HABITACIÓN + 3) CADENA COMPLETA de contenedores (hasta la caja).
    limpiarRuta();
    const nodoRoom = await nodoDeHabitacion(String(room.id));
    if (!nodoRoom) return false;
    empujarNodo(nodoRoom);
    for (const pieza of cadena) {
      const nodo = await nodoDeContenedor(pieza.id);
      if (!nodo) return false;
      // Geometría de los hijos: alimenta los minimapas de las migas.
      nodo.hijos = geometriaDe(await contenedoresHijosDe(pieza.id));
      empujarNodo(nodo);
    }

    // 4) UN solo refresco: pinta el ancla (nivel superior) y el interior activo.
    await refrescarNivel();
    return true;
  } catch {
    // El enlace profundo NUNCA puede romper el arranque de la pantalla.
    return false;
  }
}

/**
 * Ejecuta el enlace profundo pedido en la URL (si lo hay).
 *
 * Se llama DESPUÉS de `volverARaiz()`: la raíz queda montada y la navegación se
 * apila encima, igual que si el operador hubiese hecho los clics.
 */
export function abrirDestinoDelMapaDesdeUrl(): Promise<boolean> {
  const pedido = contenedorDesdeUrl(window.location.search);
  if (!pedido) return Promise.resolve(false);
  return abrirContenedorEnMapa(pedido);
}

