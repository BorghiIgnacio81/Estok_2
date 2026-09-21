// =============================================================================
// PASO 2 DEL ASISTENTE — MODELADOR 2D EN VIVO (usuario de UNA sola planta)
// -----------------------------------------------------------------------------
// Cuando el usuario funda un Estok de 1 SOLA planta, el paso «Dividí tus espacios»
// deja de ser una lista de chips y se convierte en el MISMO plano espacial
// reactivo de Almacenamiento (renderPlantaUnica + el motor 2D elástico de
// rectángulos mutables): inyección, arrastre con física de colisiones, resizing
// por esquina, fusión en «L» y perímetro redimensionable.
//
// NACE COMPLETAMENTE VACÍO: sin ambientes pre-cargados. Cada habitación se crea
// al toque con el botón «➕ Habitación» (POST /api/ubicaciones/) y se modela en el
// acto, de modo que el paso no arrastra un estado «sin guardar». La única
// dependencia estructural es la división raíz («Departamento») del Estok, que se
// crea de forma perezosa reutilizando asegurarDivisionRaiz() de ./api.
//
// Reutiliza 100% infraestructura viva: no reimplementa ni geometría ni red.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../../services/auth';
import { toast } from '../mapaJerarquico';
import type { UbicacionPlano } from '../mapaJerarquico';
import { fetchUbicacionesPlano } from '../mapaJerarquico';
import { adaptadorUbicaciones } from '../lienzoElastico';
import type { ItemElastico } from '../lienzoElastico';
import { renderPlantaUnica } from '../mapaPlantaUnica';
import { conectarLienzoElastico } from '../plantaUnicaInteractivo';
import { aplicarModo } from '../modoLienzo';
import { asegurarDivisionRaiz } from './api';

/** Habitaciones máximas que dibuja el asistente (evita planos gigantes). */
const MAX_HABITACIONES_DEFECTO = 8;

/** Ayuda contextual del plano (se renderiza dentro del lienzo). */
const TIP_PLANO =
  '🏢 <strong>Plano de una sola planta</strong> · inyectá cada habitación con <strong>«➕ Habitación»</strong> y modelala en el acto: arrastrá para acomodarla, estirá de su esquina para cambiar su tamaño, seleccioná 2+ para fusionarlas en un «L» y estirá el <strong>borde derecho, inferior o la esquina</strong> del recuadro ámbar para agrandar el plano completo. Cada cambio se guarda solo.';

export interface OpcionesPlanoPaso2 {
  /** Contenedor donde se dibuja el plano (nace vacío). */
  contenedor: HTMLElement;
  /** Tope de habitaciones del asistente. */
  maxItems?: number;
  /** Cartel de estado/errores del paso (`null` = limpiar). */
  aviso: (mensaje: string | null) => void;
  /** Notifica al asistente que el plano cambió (para refrescar el Paso 3). */
  alCambiarAmbientes: (total: number) => void;
}

let contenedor: HTMLElement | null = null;
let aviso: (mensaje: string | null) => void = () => undefined;
let alCambiar: (total: number) => void = () => undefined;
let maxItems = MAX_HABITACIONES_DEFECTO;
/** Estado vivo del plano (se recalcula del backend en cada refresco). */
let rooms: ItemElastico[] = [];
let apartamento: UbicacionPlano | null = null;

/** POST con auth multi-tenant (JWT + X-Estok-Id). true si fue 2xx. */
async function postUbicacion(body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/ubicaciones/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
 * Garantiza el contenedor perimetral («Departamento») y lo deja en memoria.
 * Reutiliza la MISMA división raíz que Almacenamiento, por lo que el plano del
 * asistente es idéntico al que el usuario verá después en el Mapa Estok.
 */
async function asegurarDepartamento(): Promise<string | null> {
  try {
    const division = await asegurarDivisionRaiz();
    apartamento = division;
    return division.id;
  } catch {
    return null;
  }
}

/** Crea una habitación nueva (rectángulo elástico) en el plano del asistente. */
async function crearHabitacion(): Promise<boolean> {
  const n = rooms.length;
  if (n >= maxItems) {
    aviso(`El asistente dibuja hasta ${maxItems} habitaciones. Después podés sumar más desde Almacenamiento.`);
    return false;
  }
  const apartamentoId = apartamento?.id ?? (await asegurarDepartamento());
  if (!apartamentoId) {
    aviso('No se pudo preparar el contenedor del plano. Reintentá.');
    return false;
  }
  const ok = await postUbicacion({
    nombre: `Habitación ${n + 1}`,
    parent_ubicacion: apartamentoId,
    piso: 'PRIMER_PISO',
    ui_left: `${6 + (n % 5) * 12}%`,
    ui_top: `${8 + (n % 4) * 16}%`,
    ui_width: '28%',
    ui_height: '24%',
  });
  if (!ok) {
    aviso('No se pudo crear la habitación. Reintentá.');
    return false;
  }
  aviso(null);
  return true;
}

/** Relee la jerarquía real del Estok activo (fuente de verdad = PostgreSQL). */
async function leerEstado(): Promise<void> {
  const ubicaciones = await fetchUbicacionesPlano();
  apartamento =
    ubicaciones.find((u) => !u.parent_ubicacion && u.parent_grid_row === 1) ??
    ubicaciones.find((u) => !u.parent_ubicacion) ??
    null;
  rooms = apartamento ? ubicaciones.filter((u) => u.parent_ubicacion === apartamento?.id) : [];
}

/** Render + re-enlace del motor 2D (el marcado se regenera en cada refresco). */
function pintar(): void {
  const cont = contenedor;
  if (!cont) return;
  cont.innerHTML = renderPlantaUnica({
    apartamento,
    rooms,
    etiquetaCrear: 'Habitación',
    tip: TIP_PLANO,
  });
  conectarLienzoElastico({
    scope: cont,
    rooms: () => rooms,
    apartamentoId: () => apartamento?.id ?? null,
    asegurarApartamento: asegurarDepartamento,
    adaptador: adaptadorUbicaciones(),
    crearItem: crearHabitacion,
    notificarCambios: () => void refrescar(),
  });
}

/** Ciclo completo del plano: leer el backend, dibujar y re-enlazar la edición. */
async function refrescar(): Promise<void> {
  await leerEstado();
  pintar();
  alCambiar(rooms.length);
}

/**
 * Monta el modelador 2D del Paso 2 (idempotente por parte del asistente).
 * Fuerza MODO EDICIÓN: el paso ES edición in-place (arrastre, fusión, resizing y
 * perímetro quedan habilitados; en modo navegación el motor está bloqueado).
 */
export async function montarPlanoPaso2(opciones: OpcionesPlanoPaso2): Promise<void> {
  contenedor = opciones.contenedor;
  aviso = opciones.aviso;
  alCambiar = opciones.alCambiarAmbientes;
  maxItems = Math.max(1, opciones.maxItems ?? MAX_HABITACIONES_DEFECTO);
  aplicarModo('edicion');
  await refrescar();
  if (rooms.length === 0) {
    toast('🧭 Plano vacío: usá «➕ Habitación» para inyectar el primer espacio.');
  }
}

/** Limpia el estado del modelador (vuelta atrás o cierre del asistente). */
export function desmontarPlanoPaso2(): void {
  contenedor = null;
  rooms = [];
  apartamento = null;
  aviso = () => undefined;
  alCambiar = () => undefined;
}

