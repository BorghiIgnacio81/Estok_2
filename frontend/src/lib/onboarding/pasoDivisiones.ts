// =============================================================================
// PASO 3 DEL ASISTENTE — DIVISIONES DE LA HABITACIÓN (lienzo elástico naranja)
// -----------------------------------------------------------------------------
// Al elegir una habitación se dibuja su lienzo elástico (MISMO motor 2D que los
// planos: renderLienzoElastico + conectarLienzoElastico) con el botón
// «➕ Crear Espacio». Cada espacio es una subdivisión FÍSICA y ESTRUCTURAL de la
// habitación: se crea in-place con POST /api/contenedores/ (crear_espejo=false
// → impacta SOLO en la geometría del plano y NUNCA genera stock), se arrastra,
// se estira y se fusiona en un bloque ÚNICO e INDISOLUBLE (espacio en «L»).
//
// Persistencia multi-tenant estricta (JWT + X-Estok-Id) delegada al motor 2D
// (adaptadorContenedores). No reimplementa fetch de headers ni geometría.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../../services/auth';
import { renderLienzoElastico } from '../mapaPlantaUnica';
import { conectarLienzoElastico } from '../plantaUnicaInteractivo';
import { adaptadorContenedores } from '../lienzoElastico';
import type { ItemElastico } from '../lienzoElastico';

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

/** Ayuda contextual del lienzo de divisiones (se dibuja dentro del lienzo). */
const TIP_DIVISIONES =
  '🧱 <strong>Divisiones de la habitación</strong> · inyectá cada zona con <strong>«➕ Crear Espacio»</strong>, arrastrala para acomodarla, estirá de su esquina para cambiar su tamaño y <strong>seleccioná 2+ para fusionarlas</strong> en un único bloque indisoluble. Todo se guarda solo.';

let contenedor: HTMLElement | null = null;
let roomId: string | null = null;
let espacios: ItemElastico[] = [];

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
        // Subdivisión estructural del paso 3: geometría del mapa sin stock espejo.
        crear_espejo: false,
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

/** Render + re-enlace del motor 2D (el marcado se regenera en cada refresco). */
function pintar(): void {
  const cont = contenedor;
  if (!cont) return;
  cont.innerHTML = renderLienzoElastico({
    items: espacios,
    etiquetaCrear: 'Crear Espacio',
    textoVacio:
      'Sin divisiones todavía. Usá «➕ Crear Espacio» para subdividir esta habitación en zonas físicas.',
    tip: TIP_DIVISIONES,
  });
  conectarLienzoElastico({
    scope: cont,
    rooms: () => espacios,
    adaptador: adaptadorContenedores(),
    notificarCambios: () => void refrescar(),
    crearItem: () => crearEspacio(roomId ?? ''),
  });
}

/** Ciclo completo: leer el backend, dibujar y re-enlazar la edición. */
async function refrescar(): Promise<void> {
  espacios = roomId ? await fetchEspacios(roomId) : [];
  pintar();
}

/**
 * Monta el lienzo de divisiones de la habitación elegida. Nace y se refresca de
 * forma IDEMPOTENTE: reemplaza el marcado y vuelve a enlazar los listeners.
 */
export async function montarDivisiones(id: string | null, cont: HTMLElement): Promise<void> {
  contenedor = cont;
  roomId = id;
  await refrescar();
}

/** Limpia el estado del lienzo de divisiones (vuelta atrás o cierre del paso). */
export function desmontarDivisiones(): void {
  contenedor = null;
  roomId = null;
  espacios = [];
}
