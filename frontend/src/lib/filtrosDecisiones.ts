// =============================================================================
// BARRA DE FILTROS DEL TABLERO DE DECISIONES (/alertas-stock)
// -----------------------------------------------------------------------------
// Filtro EN VIVO de las tarjetas y filas de la página:
//
//   · 🔍 Búsqueda por texto → nombre, marca o categoría del objeto.
//   · 👤 Propietario        → un miembro del Estok (o «Todos»).
//
// CONTRATO ÚNICO DEL FILTRO: todo elemento filtrable se marca con
// `atributosFiltroObjeto()` (data-filtro-objeto + data-filtro-nombre /
// -marca / -categoria / -dueno). Lo usan las tarjetas compartidas del tablero
// (lib/decisionesTarjeta.ts) y las filas del histórico
// (lib/historicoDecisiones.ts): un solo contrato para todas las vistas.
//
// Las islas del tablero repintan sus grillas en caliente (decisión tomada,
// publicación actualizada, cierre de ciclo…), por eso el filtro se re-aplica
// con un MutationObserver debounced: una tarjeta inyectada después NUNCA queda
// sin filtrar ni se muestra fuera del filtro activo.
//
// 🔴 CÍRCULO DE COINCIDENCIAS POR ACORDEÓN (indicador tipo notificación móvil):
// cada encabezado de sección colapsable muestra cuántos objetos DE ESA SECCIÓN
// coinciden con el filtro activo; sin coincidencias el círculo se oculta y la
// barra queda atenuada. Sin filtro activo el círculo no se muestra (el badge
// del total ya informa el tamaño de la sección). Lo pinta este módulo en el
// <span data-coincidencias-acordeon> de components/decisiones/SeccionAcordeon.
//
// Auth centralizada: los propietarios se leen con `cargarUsuariosEstok()`
// (lib/catalogosEstok.ts), que usa services/auth. Este módulo no define headers.
// =============================================================================

import { cargarUsuariosEstok } from './catalogosEstok';
import { escapeHtml as escapar } from './escapeHtml';

/** ids del markup de la barra (pages/alertas-stock/index.astro). */
const ID_INPUT = 'filtroTextoDecisiones';
const ID_SELECT = 'filtroPropietarioDecisiones';
const ID_LIMPIAR = 'btnLimpiarFiltrosDecisiones';
const ID_RESULTADO = 'filtroResultadoDecisiones';

/** Selector de TODO elemento filtrable (tarjetas del tablero y filas). */
const SELECTOR_FILTRABLE = '[data-filtro-objeto]';

/** Círculo rojo de coincidencias del encabezado de cada acordeón. */
const SELECTOR_COINCIDENCIAS = '[data-coincidencias-acordeon]';

/** Atributo del <details> que atenúa la barra de una sección sin coincidencias. */
const ATRIBUTO_SIN_COINCIDENCIAS = 'data-filtro-sin-coincidencias';

/** Datos del objeto que alimentan el filtro. */
export interface DatosFiltroObjeto {
  nombre?: string | null;
  marca?: string | null;
  categoria?: string | null;
  /** id del propietario registrado del objeto (null ⇒ sin dueño). */
  duenoId?: string | null;
}

/**
 * Atributos `data-filtro-*` que hacen filtrable una tarjeta o fila.
 *
 * Los valores se escapan (pueden venir de la base y ser editables por el
 * usuario) y se leen normalizados en `aplicarFiltros()`.
 */
export function atributosFiltroObjeto(datos: DatosFiltroObjeto): string {
  return [
    'data-filtro-objeto="1"',
    `data-filtro-nombre="${escapar(datos.nombre)}"`,
    `data-filtro-marca="${escapar(datos.marca)}"`,
    `data-filtro-categoria="${escapar(datos.categoria)}"`,
    `data-filtro-dueno="${escapar(datos.duenoId)}"`,
  ].join(' ');
}


// -----------------------------------------------------------------------------
// Estado del filtro (una sola instancia por página)
// -----------------------------------------------------------------------------

let texto = '';
let propietario = '';
let observer: MutationObserver | null = null;
let reaplicarProgramado = false;

/** Texto normalizado para comparar (minúsculas y sin acentos). */
function normalizar(valor: string | null | undefined): string {
  return String(valor ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** ¿El elemento coincide con el texto y el propietario elegidos? */
function coincide(elemento: HTMLElement, buscado: string): boolean {
  const dueno = String(elemento.dataset.filtroDueno || '');
  if (propietario && dueno !== propietario) return false;
  if (!buscado) return true;
  return (
    normalizar(elemento.dataset.filtroNombre).includes(buscado)
    || normalizar(elemento.dataset.filtroMarca).includes(buscado)
    || normalizar(elemento.dataset.filtroCategoria).includes(buscado)
  );
}

/** Resumen «X de N objetos coinciden» de la barra (sólo con filtro activo). */
function actualizarResumen(visibles: number, total: number, activo: boolean): void {
  const resumen = document.getElementById(ID_RESULTADO);
  if (!resumen) return;
  const nuevo = activo
    ? `${visibles} de ${total} objeto(s) coinciden con el filtro`
    : '';
  // Guarda contra bucles: reasignar el MISMO texto reemplaza el nodo hijo y
  // despertaría al MutationObserver en cada frame (ver `observarRepintados`).
  if (resumen.textContent !== nuevo) resumen.textContent = nuevo;
  resumen.classList.toggle('hidden', !activo);
}

/**
 * Pinta (o esconde) el círculo rojo de un acordeón.
 *
 * `visible` es el estado del filtro (texto o propietario). Con el filtro
 * apagado el círculo NUNCA se muestra: el badge del total de la sección ya
 * informa cuántos ítems tiene.
 */
function pintarCoincidencias(badge: HTMLElement, coincidencias: number, activo: boolean): void {
  const mostrar = activo && coincidencias > 0;
  // Atributo NATIVO `hidden` (no la clase `hidden`): Tailwind v4 emite
  // `.hidden` antes de `.inline-flex`, así que la clase NO ocultaría el badge.
  // La regla `[data-coincidencias-acordeon][hidden]` de SeccionAcordeon.astro
  // resuelve el empate de especificidad.
  badge.toggleAttribute('hidden', !mostrar);
  if (!mostrar) return;
  const texto = String(coincidencias);
  // Igual que en `actualizarResumen`: sólo se escribe si el valor cambió.
  if (badge.textContent !== texto) badge.textContent = texto;
  const etiqueta = `${coincidencias} coincidencia(s) con el filtro`;
  if (badge.title !== etiqueta) {
    badge.title = etiqueta;
    badge.setAttribute('aria-label', etiqueta);
  }
}

/**
 * Actualiza el círculo rojo de coincidencias de CADA acordeón.
 *
 * Cada acordeón es la <section> que contiene su círculo
 * (components/decisiones/SeccionAcordeon.astro). Se cuentan los elementos
 * marcados con `atributosFiltroObjeto()` que el filtro dejó visibles; las
 * sub-secciones de «Objetos pendientes de decisión» cuentan también dentro de
 * su acordeón padre, porque el padre las contiene.
 *
 * Sección sin elementos filtrables (p. ej. Votaciones, cuyas tarjetas no pasan
 * por la barra de filtros): el círculo se oculta y la barra NO se atenúa, para
 * no informar «0 coincidencias» de algo que el filtro no toca.
 */
function actualizarCoincidenciasAcordeones(activo: boolean): void {
  const badges = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR_COINCIDENCIAS));
  for (const badge of badges) {
    const seccion = badge.closest('section');
    if (!seccion) continue;
    const detalles = badge.closest('details');
    const items = Array.from(seccion.querySelectorAll<HTMLElement>(SELECTOR_FILTRABLE));
    if (items.length === 0) {
      pintarCoincidencias(badge, 0, false);
      detalles?.removeAttribute(ATRIBUTO_SIN_COINCIDENCIAS);
      continue;
    }
    let coincidencias = 0;
    for (const item of items) {
      if (!item.classList.contains('hidden')) coincidencias += 1;
    }
    pintarCoincidencias(badge, coincidencias, activo);
    // Sin coincidencias la sección queda atenuada (el círculo ya está oculto).
    if (activo && coincidencias === 0) {
      detalles?.setAttribute(ATRIBUTO_SIN_COINCIDENCIAS, 'true');
    } else {
      detalles?.removeAttribute(ATRIBUTO_SIN_COINCIDENCIAS);
    }
  }
}

/** Muestra u oculta cada elemento filtrable según el estado actual. */
function aplicarFiltros(): void {
  const buscado = normalizar(texto);
  const activo = Boolean(texto.trim() || propietario);
  const elementos = Array.from(
    document.querySelectorAll<HTMLElement>(SELECTOR_FILTRABLE),
  );
  let visibles = 0;
  for (const elemento of elementos) {
    const oculto = !coincide(elemento, buscado);
    elemento.classList.toggle('hidden', oculto);
    if (!oculto) visibles += 1;
  }
  actualizarResumen(visibles, elementos.length, activo);
  actualizarCoincidenciasAcordeones(activo);
}

/**
 * Re-aplica el filtro cuando las islas repintan sus grillas.
 *
 * `childList` + `subtree` únicamente: alternar la clase `hidden` de un elemento
 * es una mutación de ATRIBUTO y no vuelve a disparar el observer (sin bucles).
 */
function observarRepintados(): void {
  if (observer) return;
  observer = new MutationObserver(() => {
    if (reaplicarProgramado) return;
    reaplicarProgramado = true;
    requestAnimationFrame(() => {
      reaplicarProgramado = false;
      aplicarFiltros();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** Carga los propietarios del Estok activo en el desplegable. */
async function cargarPropietarios(select: HTMLSelectElement): Promise<void> {
  const elegido = select.value;
  try {
    const usuarios = await cargarUsuariosEstok();
    const opciones = usuarios
      .map((usuario) => `<option value="${escapar(usuario.id)}">${escapar(usuario.nombre)}</option>`)
      .join('');
    select.innerHTML = `<option value="">👤 Todos los propietarios</option>${opciones}`;
    // Se conserva la selección previa (el desplegable puede recargarse).
    select.value = elegido;
  } catch (error) {
    console.warn('[Filtros] No se pudieron cargar los propietarios:', error);
  }
}

// -----------------------------------------------------------------------------
// Arranque (idempotente)
// -----------------------------------------------------------------------------

/** Inicializa la barra de filtros (texto + propietario) del tablero. */
export function iniciarFiltrosDecisiones(): void {
  const input = document.getElementById(ID_INPUT) as HTMLInputElement | null;
  const select = document.getElementById(ID_SELECT) as HTMLSelectElement | null;
  if (!input || !select) return;
  if (input.dataset.filtroActivo === 'true') return;
  input.dataset.filtroActivo = 'true';

  input.addEventListener('input', () => {
    texto = input.value;
    aplicarFiltros();
  });
  // Botón «✕» del <input type="search">: el navegador limpia sin disparar input.
  input.addEventListener('search', () => {
    texto = input.value;
    aplicarFiltros();
  });
  select.addEventListener('change', () => {
    propietario = select.value;
    aplicarFiltros();
  });
  document.getElementById(ID_LIMPIAR)?.addEventListener('click', () => {
    texto = '';
    propietario = '';
    input.value = '';
    select.value = '';
    aplicarFiltros();
    input.focus();
  });

  void cargarPropietarios(select);
  observarRepintados();
  aplicarFiltros();
}
