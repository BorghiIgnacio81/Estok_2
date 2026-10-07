// =============================================================================
// BANDEJA LATERAL DE ELEMENTOS POR UBICAR (panel vertical flotante derecho)
// -----------------------------------------------------------------------------
// Panel VERTICAL flotante anclado al lateral derecho de la pantalla de
// almacenamiento (`.bandeja-lateral`, md:w-80 h-full fixed right-0). Reemplaza a
// la antigua bandeja inferior fija: su contenido se lista en CASCADA MOVIBLE, en
// este orden secuencial EXACTO:
//
//   1) Objetos sueltos   → objetos sin ubicación ni contenedor (huérfanos).
//   2) Cajas sueltas     → cajas móviles (tipo=CAJA, es_inmueble=false) sin ubicación.
//   3) Objetos ubicados  → objetos con ubicación (viven en un espacio, sin caja).
//   4) Cajas ubicadas    → cajas móviles con ubicación (se pueden reciclar).
//   5) Muebles móviles   → muebles mudables (MUEBLE_MOVIL) sin anclar.
//
// PURGA ESTRUCTURAL: del query del cliente se excluye TODA arquitectura fija
// (habitaciones y espacios = Ubicaciones, nunca consultadas; estanterías/CONJUNTO
// y muebles inmuebles = excluidos de raíz con `?movibles=true` en PostgreSQL) y,
// como defensa en profundidad, también en el cliente con la MISMA taxonomía
// física (`esCajaMovil` / `esMuebleMovil`). Nada estructural puede colarse.
//
// Doble rol de Drag & Drop:
//   1. ORIGEN de arrastre: los chips se arrastran hacia los casilleros del Visor.
//   2. DROP ZONE de EXTRACCIÓN viva: soltar un elemento de un casillero acá lo
//      devuelve al estado «sin casillero» (PUT asincrónico con coordenadas nulas).
// Persistencia multi-tenant estricta: JWT + header X-Estok-Id (getAuthHeaders).
// =============================================================================

import { getAuthHeaders, API_BASE_URL, normalizarUrlApi } from '../services/auth';
import { escapeHtml, toast } from './mapaJerarquico';
import { esCajaMovil, esMuebleMovil } from './taxonomiaContenedor';

const IMG_CONTENEDOR_PEQUENO = '/Nuevo Contenedor.png';
const IMG_MUEBLE = '/mueble.png';
const IMG_OBJETO = '/mueble.png';

interface ContenedorBandeja {
  id: string;
  nombre: string;
  tipo: string;
  es_inmueble: boolean;
  ubicacion: string | null;
}

interface ObjetoBandeja {
  id: string;
  nombre: string;
  contenedor: string | null;
  ubicacion: string | null;
  deleted_at: string | null;
}

/** Chip draggable de la bandeja (caja, mueble móvil u objeto individual). */
interface ChipBandeja {
  id: string;
  nombre: string;
  tipo: 'contenedor' | 'objeto';
  img: string;
  esMueble: boolean;
}

let contenedores: ContenedorBandeja[] = [];
let objetos: ObjetoBandeja[] = [];
let rootEl: HTMLElement | null = null;

// =============================================================================
// HELPERS DE CARGA
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

function normalizarContenedor(c: Record<string, unknown>): ContenedorBandeja {
  return {
    id: String(c.id),
    nombre: String(c.nombre || 'Contenedor'),
    tipo: String(c.tipo || '').toUpperCase(),
    es_inmueble: Boolean(c.es_inmueble),
    ubicacion: c.ubicacion != null ? String(c.ubicacion) : null,
  };
}

function normalizarObjeto(o: Record<string, unknown>): ObjetoBandeja {
  return {
    id: String(o.id),
    nombre: String(o.nombre || 'Objeto'),
    contenedor: o.contenedor != null ? String(o.contenedor) : null,
    ubicacion: o.ubicacion != null ? String(o.ubicacion) : null,
    deleted_at: o.deleted_at != null ? String(o.deleted_at) : null,
  };
}

// =============================================================================
// CARGA + RENDER EN CASCADA
// =============================================================================

async function cargar(): Promise<void> {
  if (!rootEl) return;
  try {
    const [contData, objData] = await Promise.all([
      // PURGA DE RAÍZ (PostgreSQL): `movibles=true` = SOLO CAJA y MUEBLE_MOVIL
      // no inmuebles. Toda arquitectura fija (CONJUNTO / MUEBLE_INMUEBLE) queda
      // EXCLUIDA de la consulta, jamás listada como chip de la bandeja.
      fetchTodos(`${API_BASE_URL}/contenedores/?page_size=1000&movibles=true`),
      fetchTodos(`${API_BASE_URL}/objetos/?page_size=1000`),
    ]);
    // PURGA EN EL CLIENTE (defensa en profundidad): misma whitelist taxonómica.
    contenedores = (contData as Record<string, unknown>[])
      .map(normalizarContenedor)
      .filter((c) => esCajaMovil(c) || esMuebleMovil(c));
    // Los objetos con `contenedor` asignado son el registro ESPEJO de un mueble o
    // el contenido fino de una caja: ya tienen hogar espacial y NO van en la
    // bandeja (evita chips fantasma duplicados del mueble).
    objetos = (objData as Record<string, unknown>[])
      .map(normalizarObjeto)
      .filter((o) => !o.deleted_at && !o.contenedor);
  } catch {
    contenedores = [];
    objetos = [];
  }
  render();
}

function chipContenedor(c: ContenedorBandeja): ChipBandeja {
  const mueble = esMuebleMovil(c);
  return {
    id: c.id,
    nombre: c.nombre,
    tipo: 'contenedor',
    img: mueble ? IMG_MUEBLE : IMG_CONTENEDOR_PEQUENO,
    esMueble: mueble,
  };
}

function chipObjeto(o: ObjetoBandeja): ChipBandeja {
  return { id: o.id, nombre: o.nombre, tipo: 'objeto', img: IMG_OBJETO, esMueble: false };
}

/** Caja móvil (tipo=CAJA, no inmueble): reutiliza la whitelist compartida. */
function esCaja(c: ContenedorBandeja): boolean {
  return esCajaMovil(c);
}

/**
 * Segmentos de la cascada en ORDEN EXACTO. `ubicado` distingue los elementos con
 * hogar espacial (ubicacion != null) de los huérfanos («sueltos»).
 */
function gruposCascada(): { clave: string; titulo: string; chips: ChipBandeja[] }[] {
  const cajas = contenedores.filter(esCaja);
  const muebles = contenedores.filter(esMuebleMovil);
  return [
    {
      clave: 'objetos-sueltos',
      titulo: '1 · Objetos sueltos',
      chips: objetos.filter((o) => o.ubicacion == null).map(chipObjeto),
    },
    {
      clave: 'cajas-sueltas',
      titulo: '2 · Cajas sueltas',
      chips: cajas.filter((c) => c.ubicacion == null).map(chipContenedor),
    },
    {
      clave: 'objetos-ubicados',
      titulo: '3 · Objetos ubicados',
      chips: objetos.filter((o) => o.ubicacion != null).map(chipObjeto),
    },
    {
      clave: 'cajas-ubicadas',
      titulo: '4 · Cajas ubicadas',
      chips: cajas.filter((c) => c.ubicacion != null).map(chipContenedor),
    },
    {
      clave: 'muebles-moviles',
      titulo: '5 · Muebles móviles',
      chips: muebles.map(chipContenedor),
    },
  ];
}

function chipHtml(chip: ChipBandeja): string {
  const claseImg = chip.tipo === 'objeto'
    ? 'bandeja-chip-img bandeja-chip-img-objeto'
    : 'bandeja-chip-img';
  const claseGrupo = chip.esMueble ? ' bandeja-chip-mueble' : '';
  const eco = chip.tipo === 'contenedor' ? (chip.esMueble ? '🛋️' : '📦') : '🧸';
  return `<span class="bandeja-chip${claseGrupo}" draggable="true" data-bandeja-dnd="${chip.id}" data-bandeja-tipo="${chip.tipo}" title="Arrastrá «${escapeHtml(chip.nombre)}» hacia un casillero para fijar su coordenada">
    <img src="${chip.img}" alt="" class="${claseImg}" draggable="false" />
    <span class="bandeja-chip-nombre">${eco} ${escapeHtml(chip.nombre)}</span>
  </span>`;
}

function grupoHtml(grupo: { clave: string; titulo: string; chips: ChipBandeja[] }): string {
  const chips = grupo.chips.length
    ? `<div class="bandeja-grupo-chips">${grupo.chips.map(chipHtml).join('')}</div>`
    : '<span class="bandeja-grupo-vacio">Sin elementos en este grupo.</span>';
  return `<section class="bandeja-grupo" data-bandeja-grupo="${grupo.clave}">
    <div class="bandeja-grupo-cab">
      <span class="bandeja-grupo-titulo">${grupo.titulo}</span>
      <span class="bandeja-grupo-num">${grupo.chips.length}</span>
    </div>
    ${chips}
  </section>`;
}

function render(): void {
  if (!rootEl) return;
  const grupos = gruposCascada();
  const total = grupos.reduce((acc, g) => acc + g.chips.length, 0);
  const contador = document.getElementById('contadorBandeja');
  if (contador) contador.textContent = `${total}`;
  rootEl.innerHTML = grupos.map(grupoHtml).join('');
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

