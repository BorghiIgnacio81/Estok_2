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
// CONTENIDO · CUATRO PESTAÑAS con filtros EXACTOS (sólo una visible a la vez):
//   1 · Objetos sueltos    → `contenedor_id IS NULL` Y (en tránsito o sin
//                            ubicación). Excluye de raíz todo objeto alojado en
//                            una caja: su ubicación depende de esa caja y el
//                            bulto recuperable es el chip de la caja.
//   2 · Cajas sueltas      → cajas/contenedores (incluidos los Objetos-caja) en
//                            tránsito o SIN espacio físico asignado (`ubicacion`
//                            nula o la habitación VIRTUAL del limbo).
//   3 · Objetos a reubicar → `contenedor_id IS NULL` Y `ubicacion_id IS NULL`
//                            (estricto: ni caja ni espacio, ni siquiera limbo).
//   4 · Cajas a reubicar   → TODAS las cajas/contenedores que SÍ tienen un
//                            espacio físico asignado: se seleccionan y se
//                            arrastran a otro espacio, caja o casillero.
// Las pestañas 1 ⇄ 3 y 2 ⇄ 4 son complementarias por construcción (una pieza con
// espacio físico nunca cae en la pestaña de «sueltas»), y el reparto lo hace
// `gruposCascada()` re-verificando en el cliente el payload de PostgreSQL.
//
// FILTRADO ESTRICTO DE «OBJETOS SUELTOS» (Lote 32): un objeto que pertenece a un
// CONTENEDOR (`contenedor_id IS NOT NULL`) NUNCA se lista como suelto ni se marca
// «En tránsito» individualmente. Su ubicación física depende EXCLUSIVAMENTE de la
// caja que lo aloja, así que el bulto recuperable es el chip de SU CONTENEDOR
// (grupo 2 · Cajas sueltas si la caja quedó en el limbo). Evita el doble listado
// «caja + cada uno de sus objetos» que ensuciaba la barra flotante.
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
// Render PURO de las cuatro pestañas, de los chips y del panel activo (módulo
// propio para sostener el límite de 400 líneas: incluye el rótulo «· En tránsito»).
import { grupoHtml, pestanasHtml } from './bandejaChipHtml';
import type { GrupoChips } from './bandejaChipHtml';
// Filtros EXACTOS de las cuatro pestañas (módulo puro, sin DOM ni fetch).
import { construirPestanas } from './bandejaPestanas';

let contenedores: ContenedorBandeja[] = [];
let objetos: ObjetoBandeja[] = [];
/** Pestaña activa (clave de `gruposCascada`). Se conserva entre refrescos. */
let pestanaActiva = 'objetos-sueltos';
/** Hosts activos: panel lateral (escritorio) y barra inferior (celular). */
let hosts: HTMLElement[] = [];

// =============================================================================
// CARGA + RENDER DE LAS CUATRO PESTAÑAS (en TODOS los hosts activos)
// =============================================================================

async function cargar(): Promise<void> {
  if (!hosts.length) return;
  try {
    // La consulta, la normalización y la purga estructural viven en la capa de
    // datos (`bandejaSinUbicarDatos.ts`): PostgreSQL es la autoridad de la regla
    // (cajas móviles reconocidas por declaración, tránsito interno, rótulo
    // numerado o limbo; objetos sueltos + cajas-Objeto, ver `?bandeja=true`).
    const datos = await cargarDatosBandeja();
    contenedores = datos.contenedores;
    objetos = datos.objetos;
  } catch {
    contenedores = [];
    objetos = [];
  }
  render();
}

function render(): void {
  if (!hosts.length) return;
  const grupos: GrupoChips[] = construirPestanas(contenedores, objetos);
  // El contador global cuenta BULTOS ÚNICOS: las pestañas 1 y 3 comparten los
  // objetos sin caja y sin espacio (la 3 es el subconjunto estricto de la 1), así
  // que sumar los chips de las cuatro pestañas los contaría dos veces.
  const total = new Set(
    grupos.flatMap((g) => g.chips.map((chip) => `${chip.tipo}:${chip.id}`)),
  ).size;
  document.querySelectorAll<HTMLElement>('[data-contador-bandeja]').forEach((contador) => {
    contador.textContent = `${total}`;
  });
  // Sólo se pinta la pestaña activa (con su barra de solapas arriba).
  const activo = grupos.find((g) => g.clave === pestanaActiva) ?? grupos[0];
  const cuerpo = pestanasHtml(grupos, activo.clave) + grupoHtml(activo);
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

/**
 * CAMBIO DE PESTAÑA: cada solapa re-renderiza la canasta con su filtro. El
 * estado (`pestanaActiva`) es de módulo, así que el panel lateral, la barra
 * inferior del celular y el cuadrante del visor muestran SIEMPRE la misma
 * pestaña (una sola canasta en pantalla, sin lógica duplicada).
 */
function enlazarPestanas(): void {
  for (const host of hosts) {
    host.querySelectorAll<HTMLElement>('[data-bandeja-pestana]').forEach((solapa) => {
      solapa.addEventListener('click', () => {
        const clave = solapa.dataset.bandejaPestana || '';
        if (!clave || clave === pestanaActiva) return;
        pestanaActiva = clave;
        render();
      });
    });
  }
}

function enlazar(): void {
  enlazarPestanas();
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
// estado «sin casillero» para volver a ubicarlo. Las CAJAS viajan al limbo
// «En Tránsito» (misma regla que el ex-botón del panel, delegada al backend),
// de modo que entran SIEMPRE al grupo «Cajas sueltas» y se pueden reubicar
// arrastrándolas: el modelo híbrido unificado no necesita ninguna acción extra.
// =============================================================================

/**
 * Soltar una CAJA sobre la canasta la deja en «En Tránsito» (limbo de mudanza
 * del Estok activo): POST /contenedores/{id}/en_transito/.
 *
 * Se usa el endpoint canónico —no un PUT suelto— porque además de desanclar el
 * contenedor (`parent_contenedor` y casillero nulos) lo muda a la habitación
 * virtual «En Tránsito», que es la que la canasta lista como bulto recuperable
 * incluso cuando la pieza arrastra geometría residual del plano de origen.
 */
async function extraerContenedor(id: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/${id}/en_transito/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    const datos = await res.json().catch(() => ({}));
    if (res.ok) {
      toast(datos?.mensaje || '🧺 Caja enviada a «En Tránsito»: reubicala arrastrándola.');
      window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
    } else {
      toast('❌ ' + (datos?.detail || datos?.error || 'No se pudo extraer el elemento.'));
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


