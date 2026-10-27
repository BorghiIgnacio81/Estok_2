// =============================================================================
// PASO 3 DEL ASISTENTE — LIENZO ELÁSTICO DE DIVISIONES (motor 2D)
// -----------------------------------------------------------------------------
// Envuelve el MISMO motor elástico del plano (renderLienzoElastico +
// conectarLienzoElastico) para subdividir UNA habitación en zonas físicas:
// crear, arrastrar, estirar y fusionar en un bloque indisoluble.
//
// Cada espacio es una subdivisión ESTRUCTURAL (POST /api/contenedores/,
// crear_espejo=false → impacta SOLO en la geometría del mapa y NUNCA genera
// stock). La persistencia multi-tenant (JWT + X-Estok-Id) queda 100% delegada al
// motor 2D (adaptadorContenedores): este módulo NO reimplementa headers ni red.
//
// Lo consume ./pasoDivisiones (embudo secuencial del Paso 3), que sólo monta y
// limpia el lienzo; toda la edición elástica vive acá.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../../services/auth';
import { renderLienzoElastico } from '../mapaPlantaUnica';
import { conectarLienzoElastico } from '../plantaUnicaInteractivo';
import { adaptadorContenedores, adaptadorUbicaciones } from '../lienzoElastico';
import type { ItemElastico } from '../lienzoElastico';
// PERÍMETRO ELÁSTICO: el MISMO marco ámbar redimensionable del Paso 2 se
// inyecta sobre el lienzo de sub-divisiones, para poder estirar los bordes
// EXTERIORES de la habitación (derecho, inferior y esquina) sin salir del paso.
import {
  conectarPerimetroElastico,
  guardarMedidaCon,
  inyectarPerimetroElastico,
} from '../perimetroElastico';
import type { MedidaPerimetro } from '../perimetroElastico';
// Modo del plano: el Paso 3 ES edición in-place (mismo interruptor que el Paso 2).
import { aplicarModo } from '../modoLienzo';

/** Contenedor/espacio raíz de una habitación tal como lo devuelve el backend. */
interface EspacioApi {
  id: string | number;
  nombre: string;
  ui_left?: string | null;
  ui_top?: string | null;
  ui_width?: string | null;
  ui_height?: string | null;
  fusion_grupo?: string | null;
}

/**
 * Habitación (Ubicación) DUEÑA del perímetro del lienzo: su `ui_width`/`ui_height`
 * guardan la medida general de la caja exterior, igual que la división de planta
 * en el Paso 2.
 */
interface HabitacionApi {
  id: string | number;
  nombre?: string;
  ui_width?: string | null;
  ui_height?: string | null;
  espacio_unico?: boolean;
}


/** Ayuda contextual del lienzo de divisiones (se dibuja dentro del lienzo). */
const TIP_DIVISIONES =
  '🧱 <strong>Divisiones de la habitación</strong> · inyectá cada zona con <strong>«➕ Crear Espacio»</strong>, arrastrala para acomodarla, estirá de su esquina para cambiar su tamaño y <strong>seleccioná 2+ para fusionarlas</strong> en un único bloque indisoluble. Todo se guarda solo.';

let contenedor: HTMLElement | null = null;
let roomId: string | null = null;
let espacios: ItemElastico[] = [];
/** Habitación dueña del perímetro (medida general + estado «Espacio Único»). */
let habitacion: HabitacionApi | null = null;

/** GET de los espacios RAÍZ de la habitación (fuente de verdad = PostgreSQL). */
async function fetchEspacios(id: string): Promise<ItemElastico[]> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/contenedores/?ubicacion=${id}&raiz=true&page_size=1000`,
      { headers: { ...getAuthHeaders() } },
    );
    if (res.status === 401) {
      window.location.href = '/login';
      return [];
    }
    if (!res.ok) return [];
    const data = (await res.json()) as EspacioApi[] | { results?: EspacioApi[] };
    const lista: EspacioApi[] = Array.isArray(data) ? data : data?.results ?? [];
    return lista.map((c) => ({
      id: String(c.id),
      nombre: c.nombre,
      ui_left: c.ui_left ?? null,
      ui_top: c.ui_top ?? null,
      ui_width: c.ui_width ?? null,
      ui_height: c.ui_height ?? null,
      fusion_grupo: c.fusion_grupo ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * GET de la habitación DUEÑA del lienzo: trae la medida general persistida
 * (`ui_width`/`ui_height`) que consume el perímetro elástico y el estado
 * «Espacio Único». Un fallo de red nunca rompe el Paso 3: se devuelve null.
 */
async function fetchHabitacion(id: string): Promise<HabitacionApi | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/ubicaciones/${id}/`, {
      headers: { ...getAuthHeaders() },
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return null;
    }
    if (!res.ok) return null;
    return (await res.json()) as HabitacionApi;
  } catch {
    return null;
  }
}

/**
 * ¿La habitación YA tiene divisiones creadas? Lo consume el botón «Continuar»
 * del Paso 3 para OMITIR el modal de las 3 opciones y avanzar directo cuando el
 * usuario ya modeló el interior de ese ambiente.
 */
export async function habitacionTieneDivisiones(id: string): Promise<boolean> {
  if (!id) return false;
  return (await fetchEspacios(id)).length > 0;
}

/** Crea un espacio estructural (sin espejo de stock) dentro de la habitación. */
async function crearEspacio(id: string): Promise<boolean> {
  if (!id) return false;
  const n = espacios.length;
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: `Espacio ${n + 1}`,
        descripcion: '',
        ubicacion: id,
        ui_left: `${6 + (n % 5) * 12}%`,
        ui_top: `${8 + (n % 4) * 16}%`,
        ui_width: '28%',
        ui_height: '24%',
        es_inmueble: false,
        // Subdivisión estructural: geometría del mapa sin stock espejo.
        crear_espejo: false,
        // Una DIVISIÓN interna nunca es monolítica: no nace como «Espacio Único».
        espacio_unico: false,
      }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * ¿La medida persistida es un PORCENTAJE del lienzo padre? Las habitaciones del
 * plano de la planta (Paso 2 / Mapa Estok) guardan su posición y tamaño así
 * (`ui_width: '28%'`, `ui_height: '24%'`).
 */
function usaGeometriaPorcentual(valor?: string | null): boolean {
  return /^\s*\d{1,3}(?:\.\d+)?%\s*$/.test(valor ?? '');
}

/**
 * Persistencia de la MEDIDA del perímetro de la habitación.
 *
 * PARIDAD CON EL PASO 2 SIN ROMPER EL ENCUADRE: si la habitación todavía usa
 * porcentajes (su geometría en el plano de la planta), NO se sobrescribe con px
 * —eso la devolvería a una caja por defecto en el Paso 2 / Mapa Estok—; el
 * estirado igual se aplica en caliente y las SUB-DIVISIONES internas se
 * persisten rebasadas (px → % del nuevo marco), así el interior conserva
 * exactamente lo modelado. Cuando la habitación no tiene medidas propias, la
 * medida general se guarda normalmente en su Ubicación.
 */
async function guardarMedidaHabitacion(id: string, medida: MedidaPerimetro): Promise<boolean> {
  const conservaEncuadre =
    usaGeometriaPorcentual(habitacion?.ui_width) || usaGeometriaPorcentual(habitacion?.ui_height);
  if (conservaEncuadre) return true;
  return guardarMedidaCon(adaptadorUbicaciones())(id, medida);
}

/** Render + re-enlace del motor 2D (el marcado se regenera en cada refresco). */
function pintar(): void {
  const cont = contenedor;
  if (!cont) return;
  // PERÍMETRO ELÁSTICO EN LA VISTA DE SUB-ESPACIOS (paridad con el Paso 2): el
  // marco ámbar de la habitación es redimensionable (borde derecho, inferior y
  // esquina). Al soltar se rebasa y persiste el interior; la medida general se
  // guarda en la propia Ubicación (guardarMedidaHabitacion), sin pisar el
  // encuadre porcentual que la habitación usa en el plano de la planta. Los
  // tiradores se inyectan SIEMPRE y se ven solo en modo edición.
  cont.innerHTML = inyectarPerimetroElastico(
    renderLienzoElastico({
      items: espacios,
      etiquetaCrear: 'Crear Espacio',
      textoVacio:
        'Sin divisiones todavía. Usá «➕ Crear Espacio» para subdividir esta habitación en zonas físicas.',
      tip: TIP_DIVISIONES,
    }),
    habitacion,
  );
  conectarLienzoElastico({
    scope: cont,
    rooms: () => espacios,
    adaptador: adaptadorContenedores(),
    notificarCambios: () => void refrescar(),
    crearItem: () => crearEspacio(roomId ?? ''),
  });
  // TIRADORES DEL PERÍMETRO: la medida general se guarda en la Ubicación de la
  // habitación (PUT ui_width/ui_height en px) y el rebase de las sub-divisiones
  // internas viaja por el adaptador de Contenedores (los hijos son contenedores).
  conectarPerimetroElastico({
    scope: cont,
    id: () => roomId,
    guardar: guardarMedidaHabitacion,
    adaptador: adaptadorContenedores(),
    alGuardar: () => void refrescar(),
  });
}

/** Ciclo completo: leer el backend, dibujar y re-enlazar la edición. */
async function refrescar(): Promise<void> {
  espacios = roomId ? await fetchEspacios(roomId) : [];
  habitacion = roomId ? await fetchHabitacion(roomId) : null;
  pintar();
}

/** Monta (o refresca) el lienzo elástico de la habitación elegida (idempotente). */
export async function montarLienzoDivisiones(id: string, cont: HTMLElement): Promise<void> {
  contenedor = cont;
  roomId = id;
  // MODO EDICIÓN forzado (paridad con el Paso 2): el paso ES edición in-place
  // (crear, arrastrar, fusionar y estirar los BORDES EXTERIORES de la
  // habitación). En modo navegación los tiradores del perímetro quedan ocultos
  // y el motor bloquea los asideros.
  aplicarModo('edicion');
  await refrescar();
}

/** Limpia el estado del lienzo y vacía su DOM (el embudo sigue vivo). */
export function limpiarLienzoDivisiones(cont: HTMLElement | null): void {
  contenedor = null;
  roomId = null;
  espacios = [];
  habitacion = null;
  if (cont) cont.innerHTML = '';
}
