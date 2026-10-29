// =============================================================================
// BANDEJA DE ELEMENTOS POR UBICAR (responsive híbrido dual Web ⇄ Móvil)
// -----------------------------------------------------------------------------
// TRES HOSTS, una única lógica:
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
//   · CUADRANTE DERECHO DEL VISOR (Lote 31 · punto 2) → en el fin de cadena
//     «Espacio Único» (ambiente sin muebles internos) la canasta se INTEGRA al
//     cuadrante derecho del visor (`#canastaCuadranteContenido`, dentro de
//     `#contenidoPanelDerecho`) para mantener la consistencia con el lienzo
//     habitual. Es EL MISMO módulo con un host más: sin lógica ni estado
//     duplicado. La visibilidad la gobierna la clase `portales-canasta-cuadrante`
//     sobre <html> (lib/mapa/portales/portalesAlmacenamiento.ts).
//
// CONTENIDO (cascada movible en este orden secuencial EXACTO):
//   1) Objetos sueltos      → sin ningún hogar espacial (huérfanos).
//   2) Cajas sueltas        → cajas móviles sin ubicación general (incluye las
//                             mudadas al limbo «En Tránsito», Lote 28).
//   3) Objetos a reubicar   → objetos ubicados que requieren reubicación urgente.
//   4) Cajas a reubicar     → cajas ubicadas que requieren reubicación urgente.
//
// REGLA DE RECUPERABILIDAD (una sola autoridad: PostgreSQL). La canasta lista los
// bultos RECUPERABLES del Estok activo, que son:
//   · los SUELTOS sin ubicación general (comportamiento base),
//   · MÁS los que, estando ubicados, arrastran `en_transito_interno = True`
//     (guardados sin estante fino: reubicación urgente),
//   · MÁS los que viven dentro de una ubicación o de un contenedor «Espacio
//     Único» (bloque monolítico: no admiten casillero fino posible),
//   · MÁS las CAJAS MUDADAS AL LIMBO (Lote 28): la mudanza inter-Estok deja la
//     caja como RAÍZ SUELTA en la habitación limbo «En Tránsito» —espacio
//     VIRTUAL del tablero, no un cuarto del plano—, así que entra por el canal
//     de RESCATE sin exigir la declaración de movilidad ni la ausencia de
//     geometría residual: tiene que poder verse, editarse y arrastrarse al
//     plano nuevo. Se muestra en el grupo 2 · Cajas sueltas.
// La resuelve `?bandeja=true` en el servidor
// (viewsets/organizacion/filtros_bandeja.py y viewsets/objetos/base.py).
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

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { escapeHtml, toast } from './mapaJerarquico';
import { cargarDatosBandeja } from './bandejaSinUbicarDatos';
import type { ContenedorBandeja, ObjetoBandeja } from './bandejaSinUbicarDatos';
import { esCajaEnLimbo, esCajaMovil } from './taxonomiaContenedor';
// Iconografía de interfaz: rutas canónicas (WebP optimizados) en UN solo módulo.
import { ASSET_CAJA, ASSET_MUEBLE } from './assetsUi';

const IMG_CONTENEDOR_PEQUENO = ASSET_CAJA;
const IMG_OBJETO = ASSET_MUEBLE;

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
// CARGA + RENDER EN CASCADA (en TODOS los hosts activos)
// =============================================================================

async function cargar(): Promise<void> {
  if (!hosts.length) return;
  try {
    // La consulta, la normalización y la purga estructural viven en la capa de
    // datos (`bandejaSinUbicarDatos.ts`): PostgreSQL es la autoridad de la regla
    // de recuperabilidad (sueltas + En Tránsito Interno + «Espacio Único» +
    // 🔓 RESCATE de las cajas mudadas al limbo, ver `filtros_bandeja.py`).
    const datos = await cargarDatosBandeja();
    contenedores = datos.contenedores;
    objetos = datos.objetos;
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
    // 🔴 Sólo si está ubicada de verdad: el LIMBO de mudanza no es una
    // ubicación física (una caja mudada entra al grupo 2 · Cajas sueltas).
    urgente: !esCajaEnLimbo(c),
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
 * Segmentos de la cascada en ORDEN EXACTO. La HABITACIÓN LIMBO de mudanza
 * (Lote 28) se resuelve con `esCajaEnLimbo`: una caja mudada entre Estoks no
 * tiene cuarto físico, así que se lista como «suelta» (grupo 2) y NO como
 * «a reubicar» (grupo 4), que es lo que permite volver a arrastrarla al plano.
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
      // 🔓 Lote 28 · RESCATE DEL LIMBO: la caja mudada entre Estoks no tiene
      // habitación física (vive en la zona «En Tránsito»): es un bulto SUELTO
      // recuperable, no una caja «a reubicar» con alerta.
      chips: cajas.filter(esCajaEnLimbo).map(chipContenedor),
    },
    {
      clave: 'objetos-reubicar',
      titulo: '3 · Objetos a reubicar',
      chips: objetos.filter((o) => o.ubicacion != null).map(chipObjeto),
    },
    {
      clave: 'cajas-reubicar',
      titulo: '4 · Cajas a reubicar',
      chips: cajas.filter((c) => !esCajaEnLimbo(c)).map(chipContenedor),
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
      // Refresco del inventario en las demás pantallas (/objetos, tarjetas).
      window.dispatchEvent(new CustomEvent('estok:objetos-cambiados', { detail: { id } }));
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

/**
 * REFRESCO PÚBLICO DE LA CANASTA (Lote 29): ÚNICA puerta de entrada para que otra
 * pantalla pida repintar la bandeja SIN depender del latido global
 * `estok:espacios-cambiados` (que además re-dispara el motor de portales). La usa
 * el orquestador al abrir un «Espacio Único» (fin de cadena), donde la canasta es
 * la fuente del arrastre hacia la grilla directa de objetos.
 */
export function refrescarBandeja(): void {
  void cargar();
}

export function initBandeja(opts: {
  contenedor?: HTMLElement | null;
  /** Host de la barra horizontal inferior (celulares). */
  contenedorMovil?: HTMLElement | null;
  /**
   * Host del CUADRANTE DERECHO del visor (Lote 31 · punto 2): la canasta se
   * integra ahí cuando el nodo activo es un «Espacio Único» (sin muebles
   * internos). Mismo módulo, un host más: la regla de recuperabilidad sigue
   * teniendo UNA sola autoridad (PostgreSQL + `?bandeja=true`).
   */
  contenedorCuadrante?: HTMLElement | null;
}): void {
  hosts = [opts.contenedor, opts.contenedorMovil, opts.contenedorCuadrante].filter(
    (h): h is HTMLElement => Boolean(h),
  );
  if (!hosts.length) return;
  // Una sola vía de refresco: el latido global y el llamado explícito comparten
  // exactamente la misma puerta pública.
  window.addEventListener('estok:espacios-cambiados', refrescarBandeja);
  // REFRESCO POR MUTACIÓN DE OBJETOS: el alta/edición/borrado de un objeto
  // emite `estok:objetos-cambiados`. La canasta lateral re-consulta PostgreSQL
  // para que el chip del objeto aparezca (o desaparezca) al instante, sin F5 ni
  // tener que forzar el cambio a «Espacio Único».
  window.addEventListener('estok:objetos-cambiados', refrescarBandeja);
  enlazarExtraccion();
  void cargar();
}


