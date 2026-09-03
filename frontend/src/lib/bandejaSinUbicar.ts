// =============================================================================
// BANDEJA INFERIOR DE ELEMENTOS POR UBICAR (permanente)
// -----------------------------------------------------------------------------
// Panel horizontal fijo en la parte inferior de la pantalla de almacenamiento.
// Lista mediante fetch asíncrono todos los Contenedores Pequeños (/Nuevo
// Contenedor.png) y Objetos (/fluffy_plush_ball.jpg) cuyo campo relacional de
// ubicación sea nulo o que aún NO tengan casillero asignado
// (parent_grid_row / parent_grid_col nulos).
//
// Doble rol de Drag & Drop:
//   1. ORIGEN de arrastre: los chips se arrastran hacia los casilleros del
//      Visor de Habitación o de un Mueble (Visor Contenedor Grande).
//   2. DROP ZONE de EXTRACCIÓN viva: soltar un elemento que ya estaba en un
//      casillero sobre la bandeja lo devuelve al estado "sin casillero"
//      (PUT asincrónico con coordenadas nulas).
// Persistencia multi-tenant estricta: JWT + header X-Estok-Id (getAuthHeaders).
// =============================================================================

import { getAuthHeaders, API_BASE_URL, normalizarUrlApi } from '../services/auth';
import { escapeHtml, toast } from './mapaJerarquico';

const IMG_CONTENEDOR_PEQUENO = '/Nuevo Contenedor.png';
const IMG_OBJETO = '/fluffy_plush_ball.jpg';

interface ItemBandejaContenedor {
  id: string;
  nombre: string;
  tipo: 'contenedor';
  es_inmueble?: boolean;
}
interface ItemBandejaObjeto {
  id: string;
  nombre: string;
  tipo: 'objeto';
}
type ItemBandeja = ItemBandejaContenedor | ItemBandejaObjeto;

let items: ItemBandeja[] = [];
let rootEl: HTMLElement | null = null;

// =============================================================================
// HELPERS
// =============================================================================

async function fetchTodos(url: string): Promise<Record<string, unknown>[]> {
  const todos: Record<string, unknown>[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return todos;
    }
    if (!res.ok) return todos;
    const data = await res.json();
    todos.push(...(data.results || data));
    nextUrl = normalizarUrlApi(data.next);
  }
  return todos;
}

function sinCasillero(x: { parent_grid_row?: unknown; parent_grid_col?: unknown }): boolean {
  return x.parent_grid_row == null && x.parent_grid_col == null;
}

// =============================================================================
// CARGA + RENDER
// =============================================================================

async function cargar(): Promise<void> {
  if (!rootEl) return;
  try {
    const [contData, objData] = await Promise.all([
      fetchTodos(`${API_BASE_URL}/contenedores/?page_size=1000`),
      fetchTodos(`${API_BASE_URL}/objetos/?page_size=1000`),
    ]);

    // Contenedores PEQUEÑOS (sin sub-contenedores, no inmuebles) sin casillero.
    const contenedores: ItemBandeja[] = (contData as Record<string, unknown>[])
      .filter((c) => (Number(c.subcontenedores_count) || 0) === 0)
      .filter((c) => !c.es_inmueble)
      .filter((c) => sinCasillero(c))
      .map((c) => ({
        id: String(c.id),
        nombre: String(c.nombre || 'Contenedor'),
        tipo: 'contenedor' as const,
      }));

    // Objetos sin ubicación O sin casillero asignado todavía.
    // REGLA HERMÉTICA DE LA DUALIDAD: un objeto ya asignado a un Contenedor
    // (p.ej. el registro espejo en Objeto de un mueble mudable creado con
    // dualidad Contenedor+Objeto) NO es "por ubicar": ya tiene hogar espacial,
    // aunque no esté sobre un casillero de grilla. Se excluye para no mostrar
    // chips fantasma del mueble en la bandeja.
    const objetos: ItemBandeja[] = (objData as Record<string, unknown>[])
      .filter((o) => !o.deleted_at)
      .filter((o) => !o.contenedor)
      .filter((o) => o.ubicacion == null || sinCasillero(o))
      .map((o) => ({
        id: String(o.id),
        nombre: String(o.nombre || 'Objeto'),
        tipo: 'objeto' as const,
      }));

    items = [...contenedores, ...objetos];
  } catch {
    items = [];
  }
  render();
}

function render(): void {
  if (!rootEl) return;
  const contador = document.getElementById('contadorBandeja');
  if (contador) contador.textContent = `${items.length}`;

  if (!items.length) {
    rootEl.innerHTML =
      '<span class="bandeja-vacio">✨ No hay elementos sin ubicar. Arrastrá un elemento desde un casillero hacia acá para extraerlo.</span>';
    return;
  }

  rootEl.innerHTML = items
    .map((it) => {
      if (it.tipo === 'contenedor') {
        return `<span class="bandeja-chip" draggable="true" data-bandeja-dnd="${it.id}" data-bandeja-tipo="contenedor" title="Arrastrá «${escapeHtml(it.nombre)}» a un casillero para fijar su coordenada">
          <img src="${IMG_CONTENEDOR_PEQUENO}" alt="" class="bandeja-chip-img" draggable="false" />
          <span class="bandeja-chip-nombre">${escapeHtml(it.nombre)}</span>
        </span>`;
      }
      return `<span class="bandeja-chip" draggable="true" data-bandeja-dnd="${it.id}" data-bandeja-tipo="objeto" title="Arrastrá «${escapeHtml(it.nombre)}» a un casillero para fijar su coordenada">
        <img src="${IMG_OBJETO}" alt="" class="bandeja-chip-img bandeja-chip-img-objeto" draggable="false" />
        <span class="bandeja-chip-nombre">${escapeHtml(it.nombre)}</span>
      </span>`;
    })
    .join('');
  enlazar();
}

// =============================================================================
// DRAG & DROP - ORIGEN (chips de la bandeja hacia los casilleros)
// =============================================================================

function enlazar(): void {
  if (!rootEl) return;
  rootEl.querySelectorAll<HTMLElement>('[data-bandeja-dnd]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      const de = e as DragEvent;
      const id = el.dataset.bandejaDnd;
      const tipo = el.dataset.bandejaTipo;
      if (!id || !tipo) {
        de.preventDefault();
        return;
      }
      const mime = tipo === 'contenedor' ? 'application/x-estok-contenedor' : 'application/x-estok-objeto';
      de.dataTransfer?.setData(mime, id);
      de.dataTransfer?.setData('text/plain', id);
      de.dataTransfer?.setData('application/x-estok-origen', 'bandeja');
      if (de.dataTransfer) de.dataTransfer.effectAllowed = 'move';
      el.classList.add('bandeja-chip-arrastrando');
    });
    el.addEventListener('dragend', () => el.classList.remove('bandeja-chip-arrastrando'));
  });
}

// =============================================================================
// DRAG & DROP - DROP ZONE DE EXTRACCIÓN VIVA
// Soltar sobre la bandeja un elemento que vive en un casillero lo devuelve al
// estado "sin casillero" (PUT con coordenadas nulas) para volver a ubicarlo.
// =============================================================================

async function extraerContenedor(id: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/${id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_contenedor: null, parent_grid_row: null, parent_grid_col: null }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (res.ok) {
      toast('🧺 Elemento extraído a la bandeja de «por ubicar».');
      window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
    } else {
      const err = await res.json().catch(() => ({}));
      toast('❌ ' + (err?.detail || err?.error || 'No se pudo extraer el elemento.'));
    }
  } catch {
    toast('❌ Error de conexión al extraer el elemento.');
  }
}

async function extraerObjeto(id: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/objetos/${id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ contenedor: null, parent_grid_row: null, parent_grid_col: null }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (res.ok) {
      toast('🧺 Objeto extraído a la bandeja de «por ubicar».');
      window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
    } else {
      const err = await res.json().catch(() => ({}));
      toast('❌ ' + (err?.detail || err?.error || 'No se pudo extraer el objeto.'));
    }
  } catch {
    toast('❌ Error de conexión al extraer el objeto.');
  }
}

function enlazarExtraccion(): void {
  if (!rootEl) return;
  rootEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    if ((e as DragEvent).dataTransfer) (e as DragEvent).dataTransfer!.dropEffect = 'move';
    rootEl!.classList.add('bandeja-drop-activo');
  });
  rootEl.addEventListener('dragleave', (e) => {
    if (e.target === rootEl) rootEl!.classList.remove('bandeja-drop-activo');
  });
  rootEl.addEventListener('drop', (e) => {
    const de = e as DragEvent;
    e.preventDefault();
    rootEl!.classList.remove('bandeja-drop-activo');
    // Ignorar un chip que se soltó de nuevo sobre la propia bandeja.
    if (de.dataTransfer?.getData('application/x-estok-origen') === 'bandeja') return;
    const contId = de.dataTransfer?.getData('application/x-estok-contenedor');
    const objId = de.dataTransfer?.getData('application/x-estok-objeto');
    if (contId) void extraerContenedor(contId);
    else if (objId) void extraerObjeto(objId);
  });
}

// =============================================================================
// ENTRADA
// =============================================================================

export function initBandeja(opts: { contenedor?: HTMLElement | null }): void {
  rootEl = opts.contenedor ?? null;
  if (!rootEl) return;
  window.addEventListener('estok:espacios-cambiados', () => {
    void cargar();
  });
  enlazarExtraccion();
  void cargar();
}
