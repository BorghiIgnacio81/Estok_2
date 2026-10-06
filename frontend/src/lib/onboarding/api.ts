// =============================================================================
// ASISTENTE DE BIENVENIDA (ONBOARDING) — CAPA DE DATOS
// -----------------------------------------------------------------------------
// Encapsula TODAS las operaciones contra el backend que necesita el asistente
// de primer inicio. No reimplementa nada: reutiliza la infraestructura viva
// del proyecto.
//   - Auth centralizada (JWT + X-Estok-Id) → src/services/auth
//   - Alta del inquilinato → crearEstok() (POST /api/estoks/)
//   - Estructura espacial → mapaJerarquico (crearDivisionUbicacion /
//     fetchUbicacionesPlano), el MISMO contrato que usa Almacenamiento.
//
// CONTRATO DEL BACKEND (por qué NO se usa /api/usuarios/{id}/asignar-estok/):
// ese endpoint vincula a OTRO usuario con un Estok YA existente y exige ser
// Admin de ese Estok; no sirve para que un usuario recién registrado funde su
// propio inquilinato (era la causa del 403 + "no tenés Estok asociado").
// La vía correcta es POST /api/estoks/: EstokCreateSerializer crea el Estok y
// la Membresía(Admin) del creador en la misma operación y devuelve su `id`,
// que el front persiste como 'estok_activo_id' (→ header X-Estok-Id).
// =============================================================================

import {
  API_BASE_URL,
  cacheUser,
  cambiarEstokActivo,
  crearEstok,
  getAuthHeaders,
  getCachedUser,
  getEstokActivoId,
  setEstokActivoId,
} from '../../services/auth';
import type { EstokInfo } from '../../types';
import {
  crearDivisionUbicacion,
  fetchUbicacionesPlano,
  type UbicacionPlano,
} from '../mapaJerarquico';

// =============================================================================
// TIPOS
// =============================================================================

export interface RecursoCreado {
  id: string;
  nombre: string;
}

/**
 * División raíz (Nivel 1) que aloja los ambientes del asistente.
 * Se llama «Departamento» para ser coherente con la convención de Planta Única
 * que ya usa el Mapa Estok navegable (mapaCasitaNavegable.ts).
 */
const NOMBRE_DIVISION_RAIZ = 'Departamento';

// =============================================================================
// HELPERS DE ERROR
// =============================================================================

async function mensajeRespuesta(res: Response, porDefecto: string): Promise<string> {
  try {
    const data = await res.json();
    return data?.error || data?.detail || Object.values(data ?? {}).flat().join(', ') || porDefecto;
  } catch {
    return porDefecto;
  }
}

/** fetch con auth multi-tenant + 401 → login. Lanza Error legible si no es 2xx. */
async function pedirJson(url: string, opciones: RequestInit, mensajeError: string): Promise<any> {
  const res = await fetch(url, opciones);
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sesión expirada');
  }
  if (!res.ok) throw new Error(await mensajeRespuesta(res, mensajeError));
  return res.json();
}

// =============================================================================
// DETECCIÓN DEL ESTADO VACÍO (usuario sin Estok asignado)
// =============================================================================

/** Chequeo SÍNCRONO desde la caché de sesión ('estok_user'). */
export function hayEstokEnCache(): boolean {
  const user = getCachedUser();
  return Boolean(user?.estoks && user.estoks.length > 0);
}

/**
 * Lista REAL de inquilinatos del usuario (fuente de verdad multi-tenant).
 * GET /api/estoks/mis-estoks/ (solo exige estar autenticado, no X-Estok-Id).
 * Devuelve `null` cuando la respuesta NO pudo confirmarse (red caída o 403):
 * en ese caso el asistente se decide por el chequeo síncrono de caché para no
 * bloquear a un usuario que sí tiene Estok por un error transitorio.
 */
export async function consultarEstoksDelUsuario(): Promise<EstokInfo[] | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/estoks/mis-estoks/`, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : (data?.results ?? []);
  } catch {
    return null;
  }
}

// =============================================================================
// FUNDAR EL PRIMER ESTOK (PASO 1 — BLOQUEANTE)
// =============================================================================

/**
 * Activa un Estok en el navegador (X-Estok-Id) y en el backend.
 * Si la persistencia del «último Estok activo» falla, se fija igual la copia
 * local para que el asistente pueda seguir creando espacios.
 */
export async function activarEstok(estok: EstokInfo): Promise<void> {
  try {
    await cambiarEstokActivo(estok.id);
    return;
  } catch {
    setEstokActivoId(estok.id);
    const user = getCachedUser();
    if (user) {
      user.ultimo_estok_activo_id = estok.id;
      if (!user.estoks?.some((e) => e.id === estok.id)) {
        user.estoks = [...(user.estoks || []), estok];
      }
      cacheUser(user);
    }
  }
}

/**
 * Funda el primer Estok y lo deja activo (contrato del requerimiento:
 * localStorage + estado global + X-Estok-Id para el resto de la aplicación).
 */
export async function fundarEstok(nombre: string, cantidadPisos: number): Promise<EstokInfo> {
  const estok = await crearEstok(nombre, { cantidad_pisos: cantidadPisos });
  await activarEstok(estok);
  setEstokActivoId(estok.id);
  return estok;
}

/** Si hay Estoks pero falta el activo local, activa el primero (evita 403). */
export async function sincronizarEstokActivo(estoks: EstokInfo[]): Promise<string | null> {
  const activo = getEstokActivoId();
  if (activo && estoks.some((e) => e.id === activo)) return activo;
  if (estoks.length === 0) return null;
  await activarEstok(estoks[0]);
  return estoks[0].id;
}

// =============================================================================
// PASO 2 — DIVIDIR ESPACIOS (Nivel 1-2)
// =============================================================================

/**
 * División raíz del Estok activo: la existente o una «Departamento» nueva.
 * EXPORTADA para que el modelador 2D del Paso 2 del asistente (planoPaso2.ts)
 * garantice EXACTAMENTE el mismo contenedor perimetral que usa Almacenamiento.
 */
export async function asegurarDivisionRaiz(): Promise<UbicacionPlano> {
  const ubicaciones = await fetchUbicacionesPlano();
  const raiz =
    ubicaciones.find((u) => !u.parent_ubicacion && u.parent_grid_row === 1) ??
    ubicaciones.find((u) => !u.parent_ubicacion);
  if (raiz) return raiz;

  const creada = await crearDivisionUbicacion(NOMBRE_DIVISION_RAIZ, 1, 3);
  if (!creada) throw new Error('No se pudo preparar la estructura del Estok.');
  return creada;
}

/** Ambientes (habitaciones) ya existentes del Estok activo. */
export async function listarAmbientes(): Promise<RecursoCreado[]> {
  // `true` → el backend colapsa cada espacio fusionado en «L» a UNA sola fila
  // (parámetro ?deduplicar_grupos=1): el desplegable del Paso 3 no repite el
  // cuarto absorbido por la fusión («Cocina, Fusión, Fusión, Baño»).
  const ubicaciones = await fetchUbicacionesPlano(true);
  // Red de seguridad ADICIONAL en el cliente: si el backend devolviera dos tiles
  // del MISMO `fusion_grupo`, se conserva sólo el primero (nombres unificados).
  const gruposVistos = new Set<string>();
  const ambientes: RecursoCreado[] = [];
  for (const u of ubicaciones) {
    if (!u.parent_ubicacion) continue;
    if (u.fusion_grupo) {
      if (gruposVistos.has(u.fusion_grupo)) continue;
      gruposVistos.add(u.fusion_grupo);
    }
    ambientes.push({ id: u.id, nombre: u.nombre });
  }
  return ambientes;
}

/**
 * Crea un ambiente (Nivel 2) dentro de la división raíz con geometría elástica
 * inicial, replicando el payload ya validado en producción por
 * mapaCasitaNavegable.crearHabitacionEnPlanta.
 */
export async function crearAmbiente(nombre: string, orden: number): Promise<RecursoCreado> {
  const division = await asegurarDivisionRaiz();
  const data = await pedirJson(
    `${API_BASE_URL}/ubicaciones/`,
    {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre,
        parent_ubicacion: division.id,
        piso: division.piso || 'PRIMER_PISO',
        ui_left: `${6 + (orden % 5) * 12}%`,
        ui_top: `${8 + (orden % 4) * 16}%`,
        ui_width: '28%',
        ui_height: '24%',
      }),
    },
    `No se pudo crear el ambiente «${nombre}».`,
  );
  return { id: data.id, nombre: data.nombre || nombre };
}

/** Garantiza al menos un ambiente para colgarle un mueble o un objeto. */
export async function asegurarPrimerAmbiente(): Promise<RecursoCreado | null> {
  const ambientes = await listarAmbientes();
  if (ambientes.length > 0) return ambientes[0];
  try {
    return await crearAmbiente('Habitación principal', 0);
  } catch {
    return null;
  }
}


