// =============================================================================
// «EN TRÁNSITO INTERNO» NATIVO · SERVICIO DE RECEPCIÓN DEL DRAG & DROP
// -----------------------------------------------------------------------------
// Conecta el Drop de la canasta lateral con la figura PREEXISTENTE del sistema:
// cuando el operador suelta un bulto sobre un contenedor que TIENE divisiones
// internas sin elegir un estante/celda fina, el backend deriva el flag
// `en_transito_interno = True` (inventario/services/transito_interno.py →
// esta_en_transito_interno, invocado desde los serializers de Contenedor y de
// Objeto). El frontend NO reimplementa esa regla: sólo envía la relación
// jerárquica (`parent_contenedor` / `contenedor`) con coordenadas nulas y deja
// que la figura canónica del tránsito decida.
//
// Si el contenedor destino es «Espacio Único», el backend NUNCA lo considera
// anfitrión con divisiones: el elemento queda guardado de forma DIRECTA.
//
// Auth centralizada: getAuthHeaders()/API_BASE_URL de src/services/auth.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../../../services/auth';
import { toast } from '../../mapaJerarquico';
import { indicadorTransitoHtml } from '../../indicadorTransito';

/** Naturaleza del elemento arrastrado. */
export type TipoCarga = 'contenedor' | 'objeto';

/** Carga arrastrada leída de los MIME types estándar del sistema. */
export interface CargaArrastrada {
  tipo: TipoCarga;
  id: string;
}

/** Destino del Drop dentro de un contenedor PADRE. */
export interface DestinoDrop {
  /** UUID del contenedor que recibe al elemento (su anfitrión). */
  contenedorId: string;
  /** Nombre legible (sólo para los avisos en pantalla). */
  nombre: string;
  /** El destino tiene divisiones internas propias. */
  tieneDivisiones: boolean;
  /** Celda fina elegida (F·C). `null` = a ciegas → «En Tránsito Interno». */
  fila?: number | null;
  col?: number | null;
}

/** Etiqueta roja reutilizada del sistema («🔴 En tránsito interno»). */
export function etiquetaTransitoInternoHtml(): string {
  return indicadorTransitoHtml('interno');
}

/** Lee la carga arrastrada de los MIME types estándar (null si no hay nada). */
export function leerCargaArrastrada(de: DragEvent): CargaArrastrada | null {
  const contId = de.dataTransfer?.getData('application/x-estok-contenedor');
  const objId = de.dataTransfer?.getData('application/x-estok-objeto');
  if (contId) return { tipo: 'contenedor', id: contId };
  if (objId) return { tipo: 'objeto', id: objId };
  return null;
}

/** PUT multi-tenant con manejo de sesión y mensaje de error unificado. */
async function pedirPut(
  recurso: 'contenedores' | 'objetos',
  id: string,
  cuerpo: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/${recurso}/${id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (res.ok) return true;
    const err = await res.json().catch(() => ({}));
    toast('❌ ' + (err?.detail || err?.error || 'No se pudo guardar el elemento.'));
    return false;
  } catch {
    toast('❌ Error de conexión al guardar el elemento.');
    return false;
  }
}

/**
 * Guarda un elemento DENTRO de un contenedor padre.
 *
 *   · Con celda fina (F·C) → ubicación exacta.
 *   · Sin celda fina y con divisiones → anfitrión con divisiones: el backend
 *     marca «En Tránsito Interno» (queda dentro del mueble, pendiente de
 *     estante definitivo).
 *   · Destino «Espacio Único» → guardado DIRECTO (nunca tránsito).
 */
export async function guardarEnContenedor(
  carga: CargaArrastrada,
  destino: DestinoDrop,
): Promise<boolean> {
  const fila = destino.fila ?? null;
  const col = destino.col ?? null;
  const aCiegas = destino.tieneDivisiones && fila == null && col == null;
  const cuerpo =
    carga.tipo === 'contenedor'
      ? { parent_contenedor: destino.contenedorId, parent_grid_row: fila, parent_grid_col: col }
      : { contenedor: destino.contenedorId, parent_grid_row: fila, parent_grid_col: col };
  const recurso = carga.tipo === 'contenedor' ? 'contenedores' : 'objetos';
  const ok = await pedirPut(recurso, carga.id, cuerpo);
  if (!ok) return false;
  if (aCiegas) {
    toast(
      `🔴 En tránsito interno: el elemento ya está dentro de «${destino.nombre}», pendiente de estante fino.`,
    );
  } else {
    toast(`✅ Guardado en «${destino.nombre}».`);
  }
  window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
  return true;
}

/**
 * Guarda un elemento en una HABITACIÓN de forma general (sin celda fina):
 * queda localizado físicamente en el cuarto, esperando asignación de espacio.
 */
export async function guardarEnUbicacion(
  carga: CargaArrastrada,
  ubicacionId: string,
  nombre: string,
): Promise<boolean> {
  const cuerpo =
    carga.tipo === 'contenedor'
      ? { ubicacion: ubicacionId, parent_contenedor: null, parent_grid_row: null, parent_grid_col: null }
      : { ubicacion: ubicacionId, contenedor: null, parent_grid_row: null, parent_grid_col: null };
  const recurso = carga.tipo === 'contenedor' ? 'contenedores' : 'objetos';
  const ok = await pedirPut(recurso, carga.id, cuerpo);
  if (!ok) return false;
  toast(`✅ Guardado en «${nombre}» sin celda fina (pendiente de ubicación detallada).`);
  window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
  return true;
}

/** Destino del Drop a ciegas sobre el host activo del panel izquierdo. */
export interface DestinoCiego {
  tipo: 'contenedor' | 'ubicacion';
  id: string;
  nombre: string;
  tieneDivisiones: boolean;
}

/**
 * DROP A CIEGAS: conecta un host para que acepte la suelta de un chip sobre el
 * contenedor/cuarto activo cuando ningún casillero fino la capturó. El handler
 * de `drop` sólo actúa si NADIE previo llamó `preventDefault()` en ese mismo
 * evento (los casilleros finos de los visores sí lo hacen), de modo que jamás se
 * duplica una asignación.
 */
export function conectarDropCiego(
  host: HTMLElement,
  obtenerDestino: () => DestinoCiego | null,
): void {
  host.addEventListener('dragover', (e) => {
    const de = e as DragEvent;
    if (de.defaultPrevented) return;
    if (!obtenerDestino()) return;
    e.preventDefault();
    if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
    host.classList.add('portales-drop-activo');
  });
  host.addEventListener('dragleave', (e) => {
    if (e.target === host) host.classList.remove('portales-drop-activo');
  });
  host.addEventListener('drop', (e) => {
    const de = e as DragEvent;
    host.classList.remove('portales-drop-activo');
    // Un casillero fino ya procesó la suelta: no se duplica.
    if (de.defaultPrevented) return;
    const destino = obtenerDestino();
    if (!destino) return;
    const carga = leerCargaArrastrada(de);
    if (!carga) return;
    e.preventDefault();
    if (destino.tipo === 'ubicacion') {
      void guardarEnUbicacion(carga, destino.id, destino.nombre);
      return;
    }
    void guardarEnContenedor(carga, {
      contenedorId: destino.id,
      nombre: destino.nombre,
      tieneDivisiones: destino.tieneDivisiones,
      fila: null,
      col: null,
    });
  });
}

