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
//   · MÁS los que quedaron en la zona VIRTUAL «En Tránsito» (limbo de mudanza),
//     incluidos los OBJETOS recién registrados en tránsito: sin espacio físico
//     fijo no pueden quedar fuera de la barra inferior, porque son justamente
//     los que el operador tiene que arrastrar a un espacio o a una caja,
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
import { toast } from './mapaJerarquico';
import { cargarDatosBandeja } from './bandejaSinUbicarDatos';
import type { ContenedorBandeja, ObjetoBandeja } from './bandejaSinUbicarDatos';
// Render PURO de los chips y de cada grupo de la cascada (módulo propio para
// sostener el límite de 400 líneas: incluye el rótulo «· En tránsito»).
import { grupoHtml } from './bandejaChipHtml';
import type { ChipBandeja, GrupoChips } from './bandejaChipHtml';
import { esCajaEnLimbo, esCajaMovil, esHabitacionLimbo, esObjetoContenedor } from './taxonomiaContenedor';
// Iconografía de interfaz: rutas canónicas (WebP optimizados) en UN solo módulo.
import { ASSET_CAJA, ASSET_MUEBLE } from './assetsUi';

const IMG_CONTENEDOR_PEQUENO = ASSET_CAJA;
const IMG_OBJETO = ASSET_MUEBLE;

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

/**
 * OBJETO / CAJA-OBJETO en el limbo «En Tránsito»: no tiene espacio físico fijo
 * (misma lectura que `esCajaEnLimbo` para los contenedores). Se lista con los
 * SUELTOS porque es justamente un bulto que hay que asignar a un espacio o caja.
 */
function esObjetoEnLimbo(o: ObjetoBandeja): boolean {
  return o.ubicacion != null && esHabitacionLimbo(o.ubicacion_nombre);
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
  // OBJETO EN TRÁNSITO: registrado en el limbo «En Tránsito» (sin espacio físico
  // fijo). Se lista con los SUELTOS: no lleva el 🔴 de «reubicación urgente»
  // porque el backend ya lo devuelve en `?bandeja=true` y el chip lo rotula.
  const enTransito = esObjetoEnLimbo(o);
  return {
    id: o.id,
    nombre: o.nombre,
    tipo: 'objeto',
    img: IMG_OBJETO,
    urgente: o.ubicacion != null && !enTransito,
    enTransito,
  };
}

/**
 * Chip de un OBJETO CONTENEDOR (caja declarada por `es_contenedor=true` o por la
 * categoría «Cajas y Contenedores»). Conserva `tipo='objeto'` a propósito: el
 * registro físico es un Objeto y el arrastre debe seguir persistiendo por
 * PUT /objetos/{id}. Solo cambia la iconografía y el grupo donde se lista.
 */
function chipObjetoContenedor(o: ObjetoBandeja): ChipBandeja {
  const enTransito = esObjetoEnLimbo(o);
  return {
    id: o.id,
    nombre: o.nombre,
    tipo: 'objeto',
    img: IMG_CONTENEDOR_PEQUENO,
    urgente: o.ubicacion != null && !enTransito,
    // Caja declarada como Objeto que quedó en el limbo «En Tránsito».
    enTransito,
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
function gruposCascada(): GrupoChips[] {
  const cajas = contenedores.filter(esCaja);
  // SEPARACIÓN DE BULTOS CONTENEDOR: los Objetos declarados caja/contenedor o
  // categorizados como «Cajas y Contenedores» viajan con las CAJAS (grupos 2 y
  // 4) y JAMÁS se listan como «Objetos sueltos» (grupos 1 y 3).
  const objetosContenedor = objetos.filter(esObjetoContenedor);
  const objetosSimples = objetos.filter((o) => !esObjetoContenedor(o));
  return [
    {
      clave: 'objetos-sueltos',
      titulo: '1 · Objetos sueltos',
      // SUELTOS + EN TRÁNSITO: un objeto sin espacio físico fijo (huérfano) o
      // registrado en el limbo «En Tránsito» se lista acá, para que el libro
      // recién cargado SIEMPRE aparezca en la barra inferior y pueda arrastrarse
      // a un espacio o a una caja.
      chips: objetosSimples
        .filter((o) => o.ubicacion == null || esObjetoEnLimbo(o))
        .map(chipObjeto),
    },
    {
      clave: 'cajas-sueltas',
      titulo: '2 · Cajas sueltas',
      // 🔓 Lote 28 · RESCATE DEL LIMBO: la caja mudada entre Estoks no tiene
      // habitación física (vive en la zona «En Tránsito»): es un bulto SUELTO
      // recuperable, no una caja «a reubicar» con alerta.
      // + Los Objetos contenedor sin habitación (o en tránsito) también son cajas
      //   sueltas.
      chips: cajas.filter(esCajaEnLimbo).map(chipContenedor).concat(
        objetosContenedor
          .filter((o) => o.ubicacion == null || esObjetoEnLimbo(o))
          .map(chipObjetoContenedor),
      ),
    },
    {
      clave: 'objetos-reubicar',
      titulo: '3 · Objetos a reubicar',
      chips: objetosSimples
        .filter((o) => o.ubicacion != null && !esObjetoEnLimbo(o))
        .map(chipObjeto),
    },
    {
      clave: 'cajas-reubicar',
      titulo: '4 · Cajas a reubicar',
      chips: cajas.filter((c) => !esCajaEnLimbo(c)).map(chipContenedor).concat(
        objetosContenedor
          .filter((o) => o.ubicacion != null && !esObjetoEnLimbo(o))
          .map(chipObjetoContenedor),
      ),
    },
  ];
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

/**
 * Guardia de arrastre: `dragstart` en un chip también dispara `click` al soltar.
 * Sin este flag, mover una caja hacia un casillero abriría su ficha y se perdería
 * el gesto.
 */
let arrastrandoChip = false;

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
        arrastrandoChip = true;
        const mime =
          tipo === 'contenedor' ? 'application/x-estok-contenedor' : 'application/x-estok-objeto';
        de.dataTransfer?.setData(mime, id);
        de.dataTransfer?.setData('text/plain', id);
        de.dataTransfer?.setData('application/x-estok-origen', 'bandeja');
        if (de.dataTransfer) de.dataTransfer.effectAllowed = 'move';
        chip.classList.add('bandeja-chip-arrastrando');
      });
      chip.addEventListener('dragend', () => {
        chip.classList.remove('bandeja-chip-arrastrando');
        // El `click` sintético del final del arrastre llega antes que este
        // temporizador: así el gesto de arrastre nunca abre la ficha.
        window.setTimeout(() => {
          arrastrandoChip = false;
        }, 0);
      });
      // CLIC / ENTER: abre la ficha de detalle del bulto. Los chips son
      // `role="link" tabindex="0"` (ver bandejaChipHtml.ts), así que también
      // responden al teclado como cualquier enlace de la app.
      const abrirFicha = (): void => {
        const destino = chip.dataset.bandejaAbrir || '';
        if (destino) window.location.href = destino;
      };
      chip.addEventListener('click', (ev) => {
        if (arrastrandoChip) {
          ev.preventDefault();
          return;
        }
        abrirFicha();
      });
      chip.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        abrirFicha();
      });
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
  /**
   * Host del PANEL DERECHO cuando el nodo activo es una CAJA / CONTENEDOR:
   * la bandeja de objetos disponibles para arrastrar DENTRO de la caja abierta.
   * El motor de portales lo enciende/apaga; la lógica es exactamente la misma.
   */
  contenedorCaja?: HTMLElement | null;
}): void {
  hosts = [
    opts.contenedor,
    opts.contenedorMovil,
    opts.contenedorCuadrante,
    opts.contenedorCaja,
  ].filter((h): h is HTMLElement => Boolean(h));
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


