// =============================================================================
// BANDEJA DE ELEMENTOS POR UBICAR (responsive híbrido dual Web ⇄ Móvil)
// -----------------------------------------------------------------------------
// Dos HOSTS, una única lógica:
//
//   · ESCRITORIO (md:block) → panel VERTICAL flotante anclado al lateral derecho
//     de la pantalla de almacenamiento (`.bandeja-lateral`,
//     `md:w-80 h-full fixed right-0`). El contenedor principal de la página
//     reserva su espacio con `md:pr-80` y arranca con PADDING IZQUIERDO CERO, de
//     modo que el mapa interactivo se apoya contra el borde izquierdo y el panel
//     derecho nunca pisa el canvas.
//   · CELULARES (block md:hidden) → barra HORIZONTAL fija en el MARGEN INFERIOR
//     (`#bandejaSinUbicarMovil`): el panel derecho flotante se APAGA por completo
//     y la canasta viaja al pie de la página.
//
// CONTENIDO (cascada movible en este orden secuencial EXACTO):
//   1) Objetos sueltos   → objetos sin ubicación (huérfanos).
//   2) Cajas sueltas     → cajas móviles sin ubicación.
//   3) Objetos ubicados  → objetos con ubicación (viven en un espacio, sin caja).
//   4) Cajas ubicadas    → cajas móviles con ubicación (se pueden reciclar).
//
// PURGA ESTRICTA DE NODOS JERÁRQUICOS: queda TERMINANTEMENTE PROHIBIDO listar
// contenedores que actúen como PADRES ESTRUCTURADORES de nivel superior
// (CONJUNTOS/estanterías, muebles de cualquier tipo y zonas geográficas tipo
// «PC Setup» o «Zona Indoor»). La canasta expone pura y exclusivamente BULTOS
// MOVIBLES REALES (cajas móviles sin sub-divisiones propias) u OBJETOS
// TERMINALES sueltos. La purga corre DOS veces: en la consulta a PostgreSQL
// (`?tipo=CAJA&movibles=true`, que además descarta la arquitectura fija por
// geometría) y en el cliente (`esBultoMovibleDeBandeja`).
//
// PURGA INVENCIBLE DE ARQUITECTURA FIJA: cualquier contenedor con coordenadas
// geométricas propias en un plano (ui_left/ui_top fuera del origen o altura
// modelada ≠ 'auto') está CLAVADO en el lienzo de su cuarto —los «Espacios» de
// las habitaciones son exactamente eso—, así que queda EXCLUIDO de la canasta y
// sólo se listan bultos y objetos realmente sueltos.
//
// Doble rol de Drag & Drop:
//   1. ORIGEN de arrastre: los chips van a los casilleros finos del Visor, a las
//      tarjetas del interior jerárquico o al bloque monolítico del «Espacio Único».
//   2. DROP ZONE de EXTRACCIÓN viva: soltar un elemento de un casillero acá lo
//      devuelve al estado «sin casillero» (PUT con coordenadas nulas).
// Persistencia multi-tenant estricta: JWT + header X-Estok-Id (getAuthHeaders).
// =============================================================================

import { getAuthHeaders, API_BASE_URL, normalizarUrlApi } from '../services/auth';
import { escapeHtml, toast } from './mapaJerarquico';
import { esBultoMovibleDeBandeja, esCajaMovil } from './taxonomiaContenedor';

const IMG_CONTENEDOR_PEQUENO = '/Nuevo Contenedor.png';
const IMG_OBJETO = '/mueble.png';

interface ContenedorBandeja {
  id: string;
  nombre: string;
  tipo: string;
  es_inmueble: boolean;
  /** Sub-divisiones propias: una caja con hijos es estructura, no bulto. */
  subcontenedores_count: number;
  ubicacion: string | null;
  /** Geometría del plano: si tiene coordenadas propias es arquitectura fija. */
  ui_left: string | null;
  ui_top: string | null;
  ui_height: string | null;
}

interface ObjetoBandeja {
  id: string;
  nombre: string;
  contenedor: string | null;
  ubicacion: string | null;
  deleted_at: string | null;
}

/** Chip draggable de la bandeja (caja móvil u objeto terminal suelto). */
interface ChipBandeja {
  id: string;
  nombre: string;
  tipo: 'contenedor' | 'objeto';
  img: string;
}

let contenedores: ContenedorBandeja[] = [];
let objetos: ObjetoBandeja[] = [];
/** Hosts activos: panel lateral (escritorio) y barra inferior (celular). */
let hosts: HTMLElement[] = [];

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
    subcontenedores_count: Number(c.subcontenedores_count) || 0,
    ubicacion: c.ubicacion != null ? String(c.ubicacion) : null,
    // Geometría del plano: la purga de arquitectura fija la necesita EN EL
    // CLIENTE (`esBultoMovibleDeBandeja`), así que viaja normalizada.
    ui_left: c.ui_left != null ? String(c.ui_left) : null,
    ui_top: c.ui_top != null ? String(c.ui_top) : null,
    ui_height: c.ui_height != null ? String(c.ui_height) : null,
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
// CARGA + RENDER EN CASCADA (en TODOS los hosts activos)
// =============================================================================

async function cargar(): Promise<void> {
  if (!hosts.length) return;
  try {
    const [contData, objData] = await Promise.all([
      // PURGA DE RAÍZ (PostgreSQL): SOLO CAJA no inmueble, con la whitelist
      // física aplicada en el servidor Y sin geometría fija de plano. Toda
      // estructura fija (CONJUNTO / MUEBLE_INMUEBLE), todo mueble (MUEBLE_MOVIL)
      // y todo «Espacio» modelado queda EXCLUIDO de la consulta: jamás se listan
      // como bultos de la canasta.
      fetchTodos(`${API_BASE_URL}/contenedores/?page_size=1000&tipo=CAJA&movibles=true`),
      fetchTodos(`${API_BASE_URL}/objetos/?page_size=1000`),
    ]);
    // PURGA EN EL CLIENTE (defensa en profundidad): misma whitelist de bultos.
    contenedores = (contData as Record<string, unknown>[])
      .map(normalizarContenedor)
      .filter(esBultoMovibleDeBandeja);
    // Los objetos con `contenedor` asignado ya tienen hogar espacial y NO van en
    // la canasta (evita chips fantasma duplicados de un mueble).
    objetos = (objData as Record<string, unknown>[])
      .map(normalizarObjeto)
      .filter((o) => !o.deleted_at && !o.contenedor);
  } catch {
    contenedores = [];
    objetos = [];
  }
  render();
}

/** Caja móvil (tipo=CAJA, no inmueble): reutiliza la whitelist compartida. */
function esCaja(c: ContenedorBandeja): boolean {
  return esCajaMovil(c);
}

function chipContenedor(c: ContenedorBandeja): ChipBandeja {
  // La canasta sólo expone cajas móviles reales: no hay rama de mueble.
  return { id: c.id, nombre: c.nombre, tipo: 'contenedor', img: IMG_CONTENEDOR_PEQUENO };
}

function chipObjeto(o: ObjetoBandeja): ChipBandeja {
  return { id: o.id, nombre: o.nombre, tipo: 'objeto', img: IMG_OBJETO };
}

/**
 * Segmentos de la cascada en ORDEN EXACTO. `ubicado` distingue los elementos con
 * hogar espacial (ubicacion != null) de los huérfanos («sueltos»).
 * El grupo de MUEBLES MÓVILES fue ELIMINADO por la purga estricta de nodos
 * jerárquicos: la canasta sólo muestra bultos movibles y objetos terminales.
 */
function gruposCascada(): { clave: string; titulo: string; chips: ChipBandeja[] }[] {
  const cajas = contenedores.filter(esCaja);
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
  ];
}

function chipHtml(chip: ChipBandeja): string {
  const claseImg =
    chip.tipo === 'objeto' ? 'bandeja-chip-img bandeja-chip-img-objeto' : 'bandeja-chip-img';
  const eco = chip.tipo === 'contenedor' ? '📦' : '🧸';
  return `<span class="bandeja-chip" draggable="true" data-bandeja-dnd="${chip.id}" data-bandeja-tipo="${chip.tipo}" title="Arrastrá «${escapeHtml(chip.nombre)}» hacia un contenedor, un casillero o el bloque de la izquierda para ubicarlo">
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
  if (!hosts.length) return;
  const grupos = gruposCascada();
  const total = grupos.reduce((acc, g) => acc + g.chips.length, 0);
  document.querySelectorAll<HTMLElement>('[data-contador-bandeja]').forEach((contador) => {
    contador.textContent = `${total}`;
  });
  const cuerpo = grupos.map(grupoHtml).join('');
  for (const host of hosts) host.innerHTML = cuerpo;
  enlazar();
}

// =============================================================================
// DRAG & DROP - ORIGEN (chips de la canasta hacia contenedores y casilleros)
// =============================================================================

function enlazar(): void {
  for (const host of hosts) {
    host.querySelectorAll<HTMLElement>('[data-bandeja-dnd]').forEach((chip) => {
      chip.addEventListener('dragstart', (e) => {
        const de = e as DragEvent;
        const id = chip.dataset.bandejaDnd;
        const tipo = chip.dataset.bandejaTipo;
        if (!id || !tipo) {
          de.preventDefault();
          return;
        }
        const mime =
          tipo === 'contenedor' ? 'application/x-estok-contenedor' : 'application/x-estok-objeto';
        de.dataTransfer?.setData(mime, id);
        de.dataTransfer?.setData('text/plain', id);
        de.dataTransfer?.setData('application/x-estok-origen', 'bandeja');
        if (de.dataTransfer) de.dataTransfer.effectAllowed = 'move';
        chip.classList.add('bandeja-chip-arrastrando');
      });
      chip.addEventListener('dragend', () => chip.classList.remove('bandeja-chip-arrastrando'));
    });
  }
}

// =============================================================================
// DRAG & DROP - DROP ZONE DE EXTRACCIÓN VIVA (en TODOS los hosts)
// Soltar sobre la canasta un elemento que vive en un casillero lo devuelve al
// estado «sin casillero» (PUT con coordenadas nulas) para volver a ubicarlo.
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
  for (const host of hosts) {
    host.addEventListener('dragover', (e) => {
      const de = e as DragEvent;
      e.preventDefault();
      if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
      host.classList.add('bandeja-drop-activo');
    });
    host.addEventListener('dragleave', (e) => {
      if (e.target === host) host.classList.remove('bandeja-drop-activo');
    });
    host.addEventListener('drop', (e) => {
      const de = e as DragEvent;
      e.preventDefault();
      host.classList.remove('bandeja-drop-activo');
      // Ignorar un chip que se soltó de nuevo sobre la propia canasta.
      if (de.dataTransfer?.getData('application/x-estok-origen') === 'bandeja') return;
      const contId = de.dataTransfer?.getData('application/x-estok-contenedor');
      const objId = de.dataTransfer?.getData('application/x-estok-objeto');
      if (contId) void extraerContenedor(contId);
      else if (objId) void extraerObjeto(objId);
    });
  }
}

// =============================================================================
// ENTRADA (responsive híbrido dual: panel lateral ⇄ barra inferior)
// =============================================================================

export function initBandeja(opts: {
  contenedor?: HTMLElement | null;
  /** Host de la barra horizontal inferior (celulares). */
  contenedorMovil?: HTMLElement | null;
}): void {
  hosts = [opts.contenedor, opts.contenedorMovil].filter((h): h is HTMLElement => Boolean(h));
  if (!hosts.length) return;
  window.addEventListener('estok:espacios-cambiados', () => {
    void cargar();
  });
  enlazarExtraccion();
  void cargar();
}


