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
//   1) Objetos sueltos      → sin ningún hogar espacial (huérfanos).
//   2) Cajas sueltas        → cajas móviles sin ubicación general.
//   3) Objetos a reubicar   → objetos ubicados que requieren reubicación urgente.
//   4) Cajas a reubicar     → cajas ubicadas que requieren reubicación urgente.
//
// REGLA DE RECUPERABILIDAD (una sola autoridad: PostgreSQL). La canasta lista los
// bultos RECUPERABLES del Estok activo, que son:
//   · los SUELTOS sin ubicación general (comportamiento base),
//   · MÁS los que, estando ubicados, arrastran `en_transito_interno = True`
//     (guardados sin estante fino: reubicación urgente),
//   · MÁS los que viven dentro de una ubicación o de un contenedor «Espacio
//     Único» (bloque monolítico: no admiten casillero fino posible).
// La resuelve `?bandeja=true` en el servidor
// (viewsets/organizacion/contenedores.py y viewsets/objetos/base.py).
//
// PURGA INVENCIBLE DE ARQUITECTURA FIJA: la canasta NUNCA lista la arquitectura
// clavada en el plano — habitaciones, «Espacios», estanterías y muebles con
// coordenadas propias (`ui_left`/`ui_top`/`ui_height` fuera del origen) — ni
// contenedores con sub-divisiones propias. El servidor la descarta por geometría
// y el cliente la re-verifica con `esBultoMovibleDeBandeja` (defensa en
// profundidad).
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
  /** 🔴 Ubicado y pendiente: entró por «reubicación urgente» (tránsito interno o bloque monolítico). */
  urgente: boolean;
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
      // CONSULTA DE LA CANASTA (PostgreSQL, autoridad única): el servidor aplica
      // la whitelist física (CAJA no inmueble), la purga de arquitectura fija por
      // geometría y la regla de RECUPERABILIDAD (sueltas + En Tránsito Interno +
      // dentro de «Espacio Único»). Ver ContenedorViewSet.get_queryset.
      fetchTodos(`${API_BASE_URL}/contenedores/?page_size=1000&bandeja=true`),
      // Objetos: misma regla de recuperabilidad, resuelta en el ObjetoViewSet.
      fetchTodos(`${API_BASE_URL}/objetos/?page_size=1000&bandeja=true`),
    ]);
    // PURGA ESTRUCTURAL EN EL CLIENTE (defensa en profundidad): una caja con
    // sub-divisiones propias o con geometría de plano es estructura, no bulto.
    contenedores = (contData as Record<string, unknown>[])
      .map(normalizarContenedor)
      .filter(esBultoMovibleDeBandeja);
    // Los objetos ya vienen filtrados por el servidor (recuperabilidad estricta):
    // acá sólo se descartan los registros borrados (soft-delete).
    objetos = (objData as Record<string, unknown>[])
      .map(normalizarObjeto)
      .filter((o) => !o.deleted_at);
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
  return {
    id: c.id,
    nombre: c.nombre,
    tipo: 'contenedor',
    img: IMG_CONTENEDOR_PEQUENO,
    urgente: c.ubicacion != null,
  };
}

function chipObjeto(o: ObjetoBandeja): ChipBandeja {
  return {
    id: o.id,
    nombre: o.nombre,
    tipo: 'objeto',
    img: IMG_OBJETO,
    urgente: o.ubicacion != null,
  };
}

/**
 * Segmentos de la cascada en ORDEN EXACTO. `ubicacion` distingue los elementos
 * con hogar espacial (recuperables por reubicación) de los huérfanos («sueltos»).
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
      clave: 'objetos-reubicar',
      titulo: '3 · Objetos a reubicar',
      chips: objetos.filter((o) => o.ubicacion != null).map(chipObjeto),
    },
    {
      clave: 'cajas-reubicar',
      titulo: '4 · Cajas a reubicar',
      chips: cajas.filter((c) => c.ubicacion != null).map(chipContenedor),
    },
  ];
}

function chipHtml(chip: ChipBandeja): string {
  const claseImg =
    chip.tipo === 'objeto' ? 'bandeja-chip-img bandeja-chip-img-objeto' : 'bandeja-chip-img';
  const eco = chip.tipo === 'contenedor' ? '📦' : '🧸';
  // Los elementos ubicados entran a la canasta por REUBICACIÓN URGENTE: el
  // tooltip lo explica para que el operador sepa POR QUÉ está listado.
  const pendiente = chip.urgente ? ' 🔴' : '';
  const ayuda = chip.urgente
    ? `«${chip.nombre}» está ubicado pero necesita reubicación urgente (en tránsito interno o dentro de un bloque monolítico): arrastralo a un contenedor, a un casillero o al bloque de la izquierda.`
    : `Arrastrá «${chip.nombre}» hacia un contenedor, un casillero o el bloque de la izquierda para ubicarlo.`;
  return `<span class="bandeja-chip" draggable="true" data-bandeja-dnd="${chip.id}" data-bandeja-tipo="${chip.tipo}" title="${escapeHtml(ayuda)}">
    <img src="${chip.img}" alt="" class="${claseImg}" draggable="false" />
    <span class="bandeja-chip-nombre">${eco} ${escapeHtml(chip.nombre)}${pendiente}</span>
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


