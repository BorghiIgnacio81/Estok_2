// =============================================================================
// «FILTRO POR UBICACIÓN» DEL LISTADO DE OBJETOS (/objetos) — combo + estado
// -----------------------------------------------------------------------------
// Responsabilidades de esta capa (DOM + estado del filtro):
//   1. POBLAR el <select id="filtroUbicacion"> de la barra de filtros con las
//      ubicaciones disponibles del Estok activo, separadas en dos grupos:
//        · «Habitaciones y espacios»  → Ubicaciones (value `u:<uuid>`).
//        · «Contenedores padre»       → muebles y piezas que alojan otras
//                                       piezas (value `c:<uuid>`).
//   2. GUARDAR el último payload del árbol y devolverlo RECORTADO según la
//      selección vigente, para que el listado se re-pinte en el acto (sin
//      volver a consultar la API) y los contadores de los acordeones cambien en
//      tiempo real.
//
// FUENTE GEOGRÁFICA ÚNICA: el contexto ya cargado por `rutaCajaMinimapas.ts`
// (ubicaciones + TODOS los contenedores, incluidas las cajas anidadas). Este
// módulo NO repite consultas ni define un fetch propio: la sesión la resuelve
// `services/auth`.
// =============================================================================

import { cargarContextoRutaCaja, contextoGeograficoCargado } from './rutaCajaMinimapas';
import {
  construirIndiceFiltro,
  filtrarPayloadPorUbicacion,
  indiceFiltroVacio,
  leerSeleccionUbicacion,
} from './filtroUbicacionObjetos';
import type { IndiceFiltroUbicacion } from './filtroUbicacionObjetos';
import type { PayloadArbol } from './listadoObjetosPiezas';

/** Etiqueta legible de la naturaleza del contenedor en el combo. */
const ETIQUETA_TIPO_CONTENEDOR: Record<string, string> = {
  MUEBLE_MOVIL: 'Mueble',
  MUEBLE: 'Mueble',
  MUEBLE_INMUEBLE: 'Mueble fijo',
  CONJUNTO: 'Estante',
  ESTANTE: 'Estante',
  CAJA: 'Caja',
};

/** Payload recortado + bandera de filtro activo (la consume la vista). */
export interface RecorteUbicacion {
  payload: PayloadArbol;
  activo: boolean;
}

/** Ubicación mínima que consume el combo. */
interface UbicacionSelect {
  id: string;
  nombre: string;
  parent_ubicacion_nombre?: string | null;
}

/** Contenedor mínimo que consume el combo. */
interface ContenedorSelect {
  id: string;
  nombre: string;
  tipo: string;
  ubicacion: string | null;
  parent_contenedor: string | null;
}

let selectFiltro: HTMLSelectElement | null = null;
let indice: IndiceFiltroUbicacion = indiceFiltroVacio();
let ultimoPayload: PayloadArbol | null = null;

// ---------------------------------------------------------------------------
// Poblado del combo
// ---------------------------------------------------------------------------

function nuevaOpcion(valor: string, etiqueta: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = valor;
  option.textContent = etiqueta;
  return option;
}

/** Opciones de habitaciones/espacios (colapsa los espacios fusionados en «L»). */
function opcionesUbicaciones(
  ubicaciones: UbicacionSelect[],
  guia: IndiceFiltroUbicacion,
): Array<{ id: string; etiqueta: string }> {
  const vistas = new Set<string>();
  const lista: Array<{ id: string; etiqueta: string }> = [];
  for (const ubicacion of ubicaciones) {
    const id = String(ubicacion.id);
    const representante = guia.grupoUbicacion.get(id) || id;
    if (vistas.has(representante)) continue;
    vistas.add(representante);
    const padre = String(ubicacion.parent_ubicacion_nombre || '').trim();
    lista.push({
      id: representante,
      etiqueta: padre ? padre + ' › ' + ubicacion.nombre : ubicacion.nombre,
    });
  }
  lista.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
  return lista;
}

/** Opciones de «Contenedores padre»: muebles y piezas que alojan otras piezas. */
function opcionesContenedores(
  contenedores: ContenedorSelect[],
  guia: IndiceFiltroUbicacion,
  nombresUbicacion: Map<string, string>,
): Array<{ id: string; etiqueta: string }> {
  const conHijos = new Set<string>();
  for (const padre of guia.padre.values()) {
    if (padre) conHijos.add(String(padre));
  }

  const vistos = new Set<string>();
  const lista: Array<{ id: string; etiqueta: string }> = [];
  for (const contenedor of contenedores) {
    const id = String(contenedor.id);
    if (vistos.has(id)) continue;
    const tipo = String(contenedor.tipo || '').toUpperCase();
    if (!tipo.includes('MUEBLE') && !conHijos.has(id)) continue;
    vistos.add(id);
    const ubicacionId = guia.ubicacion.get(id) || null;
    const nombreUbicacion = ubicacionId ? nombresUbicacion.get(String(ubicacionId)) || '' : '';
    const etiqueta = [
      contenedor.nombre,
      ETIQUETA_TIPO_CONTENEDOR[tipo] ? '(' + ETIQUETA_TIPO_CONTENEDOR[tipo] + ')' : '',
      nombreUbicacion ? '· ' + nombreUbicacion : '',
    ].filter(Boolean).join(' ');
    lista.push({ id, etiqueta });
  }
  lista.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
  return lista;
}

function agregarGrupo(
  select: HTMLSelectElement,
  label: string,
  clave: string,
  prefijo: string,
  opciones: Array<{ id: string; etiqueta: string }>,
): void {
  if (opciones.length === 0) return;
  const grupo = document.createElement('optgroup');
  grupo.label = label;
  grupo.dataset.filtroUbicacion = clave;
  for (const opcion of opciones) {
    grupo.appendChild(nuevaOpcion(prefijo + opcion.id, opcion.etiqueta));
  }
  select.appendChild(grupo);
}

function poblarSelect(
  select: HTMLSelectElement,
  ubicaciones: UbicacionSelect[],
  contenedores: ContenedorSelect[],
  guia: IndiceFiltroUbicacion,
): void {
  // Sólo se limpian los grupos dinámicos: «Todas las ubicaciones» se conserva.
  select.querySelectorAll('optgroup[data-filtro-ubicacion]').forEach((grupo) => grupo.remove());

  const nombresUbicacion = new Map<string, string>();
  for (const ubicacion of ubicaciones) nombresUbicacion.set(String(ubicacion.id), ubicacion.nombre);

  agregarGrupo(select, 'Habitaciones y espacios', 'ubicaciones', 'u:',
    opcionesUbicaciones(ubicaciones, guia));
  agregarGrupo(select, 'Contenedores padre', 'contenedores', 'c:',
    opcionesContenedores(contenedores, guia, nombresUbicacion));
}

// ---------------------------------------------------------------------------
// API pública del filtro
// ---------------------------------------------------------------------------

/**
 * Espera el contexto geográfico del Estok y puebla el combo «Filtro por
 * Ubicación». `alCambiar` se invoca con cada cambio de selección (el listado se
 * re-pinta en el acto, sin refetch).
 *
 * Idempotente: si el select no existe (otra pantalla) no hace nada.
 */
export async function initFiltroUbicacionListado(
  select: HTMLSelectElement | null,
  alCambiar: () => void,
): Promise<void> {
  selectFiltro = select;
  if (!select) return;
  select.addEventListener('change', () => alCambiar());
  try {
    await cargarContextoRutaCaja();
  } catch {
    // Sin contexto el combo conserva sólo «Todas las ubicaciones».
    return;
  }
  const { ubicaciones, contenedores } = contextoGeograficoCargado();
  indice = construirIndiceFiltro(contenedores, ubicaciones);
  poblarSelect(select, ubicaciones, contenedores, indice);
}

/** Guarda el payload CRUDO del árbol y lo devuelve recortado por el filtro. */
export function aplicarFiltroUbicacion(payload: PayloadArbol): RecorteUbicacion {
  ultimoPayload = payload;
  return recorteActual();
}

/** Recalcula el recorte sobre el último payload (cambio del combo). */
export function repintarFiltroUbicacion(): RecorteUbicacion | null {
  return ultimoPayload ? recorteActual() : null;
}

/** Devuelve el combo a «Todas las ubicaciones» (botón «Limpiar Filtros»). */
export function limpiarFiltroUbicacion(): void {
  if (selectFiltro) selectFiltro.value = '';
}

function recorteActual(): RecorteUbicacion {
  const seleccion = leerSeleccionUbicacion(selectFiltro ? selectFiltro.value : '');
  const payload = ultimoPayload as PayloadArbol;
  return {
    payload: filtrarPayloadPorUbicacion(payload, seleccion, indice),
    activo: seleccion.tipo !== 'todas',
  };
}
