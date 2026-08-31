// =============================================================================
// MAPA ESPACIAL - lienzo adaptativo por Estok (inquilino)
// -----------------------------------------------------------------------------
// Lee el campo `tipo_layout` del Estok activo (GET /api/estoks/{id}/) y
// renderiza el lienzo del almacenamiento según la configuración del inquilino:
//
//   - 'CASA_2_PISOS'      => layout VERTICAL dividido (Primer Piso / Planta Baja)
//   - 'VISTA_PLANTA_UNICA'=> lienzo ÚNICO plano visto desde arriba, con la
//                            grilla "estilo Word" ocupando todo el ancho para
//                            diagramar las habitaciones.
//
// El aislamiento por inquilino lo garantiza getAuthHeaders() (header X-Estok-Id)
// que ya inyecta el Estok activo del usuario en cada request.
// =============================================================================

import { getAuthHeaders, getEstokActivoId, API_BASE_URL } from '../services/auth';

// =============================================================================
// CONSTANTES DE LAYOUT
// =============================================================================

export const TIPO_LAYOUT_CASA_2_PISOS = 'CASA_2_PISOS';
export const TIPO_LAYOUT_VISTA_PLANTA_UNICA = 'VISTA_PLANTA_UNICA';

export const ETIQUETAS_LAYOUT: Record<string, string> = {
  [TIPO_LAYOUT_CASA_2_PISOS]: '🏠 Casa de 2 pisos',
  [TIPO_LAYOUT_VISTA_PLANTA_UNICA]: '📐 Vista planta única',
};

export function esCasa2Pisos(tipo: string | null | undefined): boolean {
  return tipo === TIPO_LAYOUT_CASA_2_PISOS;
}

// =============================================================================
// TIPOS
// =============================================================================

export interface UbicacionMapa {
  id: string;
  nombre: string;
  objetos_count: number;
  contenedores_count: number;
}

// =============================================================================
// API: tipo de layout del Estok activo
// =============================================================================

/**
 * Obtiene el `tipo_layout` del Estok activo (inquilino actual).
 * Devuelve null si no hay Estok activo o si la consulta falla.
 */
export async function fetchTipoLayoutEstokActivo(): Promise<string | null> {
  const estokId = getEstokActivoId();
  if (!estokId) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/estoks/${estokId}/`, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    return data.tipo_layout || TIPO_LAYOUT_VISTA_PLANTA_UNICA;
  } catch {
    return null;
  }
}

// =============================================================================
// ASIGNACIÓN DE PISOS (solo para CASA_2_PISOS)
// -----------------------------------------------------------------------------
// Heurística por palabras clave sobre el nombre de la Ubicación. Es una
// asignación automática inicial: si el nombre no matchea ninguna palabra
// clave, la habitación se ubica por defecto en Planta Baja (zona de
// almacenamiento típica). Documentado a propósito para que el usuario pueda
// re-clasificar manualmente en el futuro.
// =============================================================================

export function pisoDeUbicacion(nombre: string): 'PRIMER_PISO' | 'PLANTA_BAJA' {
  const n = (nombre || '').toLowerCase();
  const enPrimerPiso =
    /(piso|arriba|balc|terraza|dormitorio|habitacion|estudio|atico|altillo|desvan)/.test(n);
  if (enPrimerPiso) return 'PRIMER_PISO';
  return 'PLANTA_BAJA';
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// =============================================================================
// RENDER HTML DEL LIENZO
// =============================================================================

function tileUbicacionHtml(u: UbicacionMapa): string {
  return `
    <div class="mapa-habitacion" title="${u.nombre}">
      <p class="mapa-habitacion-nombre">📍 ${escapeHtml(u.nombre)}</p>
      <p class="mapa-habitacion-meta">📦 ${u.contenedores_count || 0} contenedores · 🧺 ${u.objetos_count || 0} objetos</p>
    </div>`;
}

function celdaLibreHtml(): string {
  return `<div class="mapa-habitacion mapa-habitacion-libre">➕</div>`;
}

/** Rellena la grilla con celdas libres hasta completar filas de `columnas`. */
function completarGrilla(tiles: string[], columnas: number): string {
  const resto = tiles.length % columnas;
  const faltantes = resto === 0 ? 0 : columnas - resto;
  for (let i = 0; i < faltantes; i++) tiles.push(celdaLibreHtml());
  return tiles.join('');
}

/**
 * Genera el HTML del lienzo según el tipo de layout del Estok.
 * La grilla "estilo Word" ocupa todo el ancho disponible (grid auto-fill).
 */
export function mapaEspacialHtml(tipoLayout: string | null | undefined, ubicaciones: UbicacionMapa[]): string {
  const lista = Array.isArray(ubicaciones) ? ubicaciones : [];
  const columnas = 4;

  if (esCasa2Pisos(tipoLayout)) {
    const primerPiso = lista.filter((u) => pisoDeUbicacion(u.nombre) === 'PRIMER_PISO');
    const plantaBaja = lista.filter((u) => pisoDeUbicacion(u.nombre) === 'PLANTA_BAJA');

    const tilesPiso1 = primerPiso.map(tileUbicacionHtml);
    const tilesPiso0 = plantaBaja.map(tileUbicacionHtml);

    return `
    <div class="mapa-espacial" data-layout="CASA_2_PISOS">
      <p class="mapa-espacial-nota">
        Layout vertical dividido · Las habitaciones se asignan a cada piso automáticamente
        según su nombre (se puede re-clasificar más adelante).
      </p>
      <div class="mapa-piso">
        <div class="mapa-piso-titulo">🏠 Primer Piso</div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          ${completarGrilla(tilesPiso1, columnas) || celdaLibreHtml()}
        </div>
      </div>
      <div class="mapa-piso">
        <div class="mapa-piso-titulo">🏚️ Planta Baja</div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          ${completarGrilla(tilesPiso0, columnas) || celdaLibreHtml()}
        </div>
      </div>
    </div>`;
  }

  // VISTA_PLANTA_UNICA (default): lienzo único visto desde arriba, grilla a lo ancho.
  const tiles = lista.map(tileUbicacionHtml);
  return `
  <div class="mapa-espacial" data-layout="VISTA_PLANTA_UNICA">
    <p class="mapa-espacial-nota">
      Lienzo único plano visto desde arriba · La grilla ocupa todo el ancho para diagramar las habitaciones.
    </p>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      ${completarGrilla(tiles, columnas) || celdaLibreHtml()}
    </div>
  </div>`;
}

/**
 * Renderiza el lienzo dentro del contenedor destino y opcionalmente actualiza
 * el badge de layout.
 */
export function renderMapaEspacial(
  contenedor: HTMLElement | null,
  tipoLayout: string | null,
  ubicaciones: UbicacionMapa[],
  badge?: HTMLElement | null,
): void {
  if (!contenedor) return;
  if (badge) badge.textContent = ETIQUETAS_LAYOUT[tipoLayout || ''] || ETIQUETAS_LAYOUT[TIPO_LAYOUT_VISTA_PLANTA_UNICA];
  contenedor.innerHTML = mapaEspacialHtml(tipoLayout, ubicaciones);
}

