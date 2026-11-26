// =============================================================================
// MODAL «🖨️ IMPRIMIR QRs» · CONTROLADOR DE UI
// -----------------------------------------------------------------------------
// Montado por components/inventario/ModalImprimirQR.astro en /almacenamiento y
// /objetos. Cualquier botón de la barra superior con `data-abrir-imprimir-qr`
// abre el diálogo.
//
// FLUJO
//   1. Al abrir se cargan las CAJAS del Estok activo (ver
//      lib/imprimirQrEtiquetasDatos.ts → misma regla que la canasta
//      «Elementos por ubicar»: nunca habitaciones ni muebles).
//   2. Filtro (todas / nuevas / manual) + Formato de hoja A4 (3x3 / 2x2 / 4x4).
//   3. «Generar PDF para Imprimir»: el PDF se abre en una pestaña nueva lista
//      para imprimir y el backend marca `qr_impreso = true`.
//
// La pestaña se abre DENTRO del clic (antes del fetch) para que el navegador no
// la bloquee como pop-up; si igual se bloquea, el PDF se descarga.
//
// Este archivo NO hace fetch: toda la capa HTTP vive en
// lib/imprimirQrEtiquetasDatos.ts, con la auth centralizada de services/auth.
// =============================================================================

import { showToast } from './toast';
import {
  ETIQUETAS_POR_HOJA,
  SESION_EXPIRADA,
  cargarCajasQr,
  descargarBlob,
  pedirPdfEtiquetas,
} from './imprimirQrEtiquetasDatos';
import type { CajaQr } from './imprimirQrEtiquetasDatos';

const IDS = {
  modal: 'modalImprimirQr',
  cerrar: 'imprimirQrCerrar',
  listaWrap: 'imprimirQrListaWrap',
  lista: 'imprimirQrLista',
  listaVacia: 'imprimirQrListaVacia',
  resumenSeleccion: 'imprimirQrSeleccionResumen',
  conteoTodas: 'imprimirQrConteoTodas',
  conteoNuevas: 'imprimirQrConteoNuevas',
  formato: 'imprimirQrFormato',
  resumen: 'imprimirQrResumen',
  error: 'imprimirQrError',
  generar: 'imprimirQrGenerar',
  generarTexto: 'imprimirQrGenerarTexto',
  generarSpinner: 'imprimirQrGenerarSpinner',
  marcarTodas: 'imprimirQrMarcarTodas',
  marcarNinguna: 'imprimirQrMarcarNinguna',
} as const;

interface RefsModal {
  modal: HTMLElement;
  listaWrap: HTMLElement;
  lista: HTMLElement;
  listaVacia: HTMLElement;
  resumenSeleccion: HTMLElement;
  conteoTodas: HTMLElement;
  conteoNuevas: HTMLElement;
  formato: HTMLSelectElement;
  resumen: HTMLElement;
  error: HTMLElement;
  generar: HTMLButtonElement;
  generarTexto: HTMLElement;
  generarSpinner: HTMLElement;
}

let cajas: CajaQr[] = [];
let seleccion = new Set<string>();
let cargadas = false;
let generando = false;
let ui: RefsModal | null = null;

// =============================================================================
// HELPERS DE DOM Y ESTADO
// =============================================================================
function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function mostrarError(mensaje: string): void {
  if (!ui) return;
  ui.error.textContent = mensaje;
  ui.error.classList.remove('hidden');
}

function limpiarError(): void {
  if (!ui) return;
  ui.error.textContent = '';
  ui.error.classList.add('hidden');
}

function mostrar(visible: boolean): void {
  const modal = el(IDS.modal);
  if (!modal) return;
  modal.classList.toggle('hidden', !visible);
  document.body.classList.toggle('overflow-hidden', visible);
  if (!visible && ui) limpiarError();
}

function filtroActivo(): 'todas' | 'nuevas' | 'manual' {
  const radio = document.querySelector<HTMLInputElement>('input[name="filtroImprimirQr"]:checked');
  const valor = radio?.value || 'todas';
  return valor === 'nuevas' || valor === 'manual' ? valor : 'todas';
}

function formatoActivo(): string {
  const valor = ui?.formato.value || '3x3';
  return ETIQUETAS_POR_HOJA[valor] ? valor : '3x3';
}

function etiquetasPorHoja(): number {
  return ETIQUETAS_POR_HOJA[formatoActivo()];
}

/** Ubicación corta de la caja: «Habitación › Mueble contenedor». */
function rutaCaja(caja: CajaQr): string {
  const partes = [caja.ubicacion_nombre, caja.parent_contenedor_nombre]
    .map((parte) => (parte || '').trim())
    .filter(Boolean);
  return partes.length ? partes.join(' › ') : 'Sin ubicación asignada';
}

function cajasDelFiltro(filtro: string): CajaQr[] {
  if (filtro === 'nuevas') return cajas.filter((caja) => !caja.qr_impreso);
  return cajas;
}

// =============================================================================
// LISTA DE SELECCIÓN MANUAL
// =============================================================================
function crearFila(caja: CajaQr): HTMLElement {
  const fila = document.createElement('label');
  fila.className = 'flex items-center gap-2.5 px-3 py-2 hover:bg-amber-50/60 cursor-pointer';

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'w-4 h-4 shrink-0 rounded text-amber-600 focus:ring-amber-500';
  check.checked = seleccion.has(caja.id);
  check.setAttribute('aria-label', `Imprimir la etiqueta de ${caja.nombre || 'la caja'}`);
  check.addEventListener('change', () => {
    if (check.checked) seleccion.add(caja.id);
    else seleccion.delete(caja.id);
    sincronizar();
  });

  const texto = document.createElement('span');
  texto.className = 'min-w-0 flex-1';

  const nombre = document.createElement('span');
  nombre.className = 'block text-sm font-medium text-gray-800 truncate';
  nombre.textContent = caja.nombre || 'Caja sin nombre';

  const ubicacion = document.createElement('span');
  ubicacion.className = 'block text-[11px] text-gray-500 truncate';
  ubicacion.textContent = rutaCaja(caja);

  texto.append(nombre, ubicacion);

  const insignia = document.createElement('span');
  insignia.className = caja.qr_impreso
    ? 'shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600'
    : 'shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700';
  insignia.textContent = caja.qr_impreso ? 'Impreso' : 'Nuevo';

  fila.append(check, texto, insignia);
  return fila;
}

function pintarLista(): void {
  if (!ui) return;
  ui.lista.replaceChildren();
  const vacia = cajas.length === 0;
  ui.listaVacia.classList.toggle('hidden', !vacia);
  if (vacia) return;
  for (const caja of cajas) ui.lista.appendChild(crearFila(caja));
}

// =============================================================================
// ESTADO VISUAL (contadores, resumen de hojas y botón final)
// =============================================================================
function sincronizar(): void {
  if (!ui) return;

  const total = cajas.length;
  const nuevas = cajas.filter((caja) => !caja.qr_impreso).length;
  ui.conteoTodas.textContent = String(total);
  ui.conteoNuevas.textContent = String(nuevas);

  const filtro = filtroActivo();
  ui.listaWrap.classList.toggle('hidden', filtro !== 'manual');
  ui.resumenSeleccion.textContent = `${seleccion.size} de ${total} seleccionadas`;

  const cantidad = filtro === 'manual' ? seleccion.size : cajasDelFiltro(filtro).length;
  const hojas = Math.max(1, Math.ceil(cantidad / etiquetasPorHoja()));

  ui.resumen.textContent = cantidad
    ? `${cantidad} etiqueta(s) · ${hojas} hoja(s) A4 en grilla ${formatoActivo()}`
    : 'No hay etiquetas para el filtro seleccionado.';
  ui.generar.disabled = generando || cantidad === 0;
}

function fijarGenerando(activo: boolean): void {
  if (!ui) return;
  generando = activo;
  ui.generarSpinner.classList.toggle('hidden', !activo);
  ui.generarTexto.textContent = activo ? 'Generando PDF…' : '🖨️ Generar PDF para Imprimir';
  const cantidad = filtroActivo() === 'manual'
    ? seleccion.size
    : cajasDelFiltro(filtroActivo()).length;
  ui.generar.disabled = activo || cantidad === 0;
}

// =============================================================================
// CARGA DE CAJAS
// =============================================================================
async function cargarCajas(): Promise<void> {
  if (!ui) return;
  ui.lista.replaceChildren();
  ui.listaVacia.classList.add('hidden');
  ui.resumen.textContent = 'Cargando cajas…';

  try {
    cajas = await cargarCajasQr();
    // La selección manual arranca con TODAS tildadas: el operador destilda las
    // que no quiere imprimir (menos clics que al revés).
    seleccion = new Set(cajas.map((caja) => caja.id));
    cargadas = true;
    pintarLista();
    sincronizar();
  } catch (err) {
    cargadas = false;
    cajas = [];
    seleccion = new Set();
    pintarLista();
    sincronizar();
    if (err instanceof Error && err.message === SESION_EXPIRADA) return;
    mostrarError('No se pudieron cargar las cajas del Estok. Revisá la conexión e intentá de nuevo.');
    console.error('Error al cargar cajas para imprimir QRs:', err);
  }
}

// =============================================================================
// GENERACIÓN DEL PDF
// =============================================================================
/** Refleja en la lista local las cajas que el backend acaba de marcar. */
function marcarImpresas(ids: string[]): void {
  const marcadas = new Set(ids);
  cajas = cajas.map((caja) => (marcadas.has(caja.id) ? { ...caja, qr_impreso: true } : caja));
  pintarLista();
  sincronizar();
}

async function generar(): Promise<void> {
  if (!ui || generando) return;

  const filtro = filtroActivo();
  const formato = formatoActivo();
  const ids = filtro === 'manual'
    ? [...seleccion]
    : cajasDelFiltro(filtro).map((caja) => caja.id);

  if (ids.length === 0) {
    mostrarError(filtro === 'manual'
      ? 'Elegí al menos una caja en la selección manual.'
      : 'No hay cajas para imprimir con el filtro seleccionado.');
    return;
  }

  limpiarError();
  fijarGenerando(true);

  // Pestaña abierta DENTRO del gesto del operador: el navegador no la bloquea.
  const ventana = window.open('', '_blank');
  if (ventana) {
    try {
      const cuerpo = ventana.document.body;
      if (cuerpo) {
        const aviso = ventana.document.createElement('p');
        aviso.style.cssText = 'font-family:system-ui,sans-serif;padding:24px;color:#374151';
        aviso.textContent = '🖨️ Generando etiquetas QR…';
        cuerpo.replaceChildren(aviso);
      }
    } catch {
      /* pestaña no escribible: se resuelve al asignar la URL del PDF */
    }
  }

  try {
    const { blob, nombre } = await pedirPdfEtiquetas({ filtro, formato, ids });
    const url = window.URL.createObjectURL(blob);

    if (ventana) {
      ventana.location.href = url;
      window.setTimeout(() => window.URL.revokeObjectURL(url), 120000);
    } else {
      descargarBlob(blob, nombre);
    }

    marcarImpresas(ids);
    cargadas = false; // el próximo «Imprimir QRs» re-lee los qr_impreso reales
    mostrar(false);
    showToast(
      `🖨️ PDF con ${ids.length} etiqueta(s) listo. En la pestaña abierta, tocá el ícono de impresora (o Ctrl+P).`,
      ventana ? 'success' : 'info',
    );
  } catch (err) {
    ventana?.close();
    if (err instanceof Error && err.message === SESION_EXPIRADA) return;
    mostrarError(err instanceof Error && err.message
      ? err.message
      : 'Error de conexión al generar el PDF de etiquetas.');
    console.error('Error al generar el PDF de etiquetas QR:', err);
  } finally {
    fijarGenerando(false);
  }
}

// =============================================================================
// APERTURA / CIERRE Y ARRANQUE
// =============================================================================
async function abrir(): Promise<void> {
  mostrar(true);
  if (cargadas) {
    sincronizar();
    return;
  }
  await cargarCajas();
}

export function initModalImprimirQr(): void {
  const modal = el(IDS.modal);
  if (!modal || !el(IDS.generar)) return;

  // Idempotente: evita dobles bindings si el componente se montara dos veces.
  const marca = window as unknown as { __estokImprimirQrInit?: boolean };
  if (marca.__estokImprimirQrInit) return;
  marca.__estokImprimirQrInit = true;

  ui = {
    modal,
    listaWrap: el(IDS.listaWrap)!,
    lista: el(IDS.lista)!,
    listaVacia: el(IDS.listaVacia)!,
    resumenSeleccion: el(IDS.resumenSeleccion)!,
    conteoTodas: el(IDS.conteoTodas)!,
    conteoNuevas: el(IDS.conteoNuevas)!,
    formato: el<HTMLSelectElement>(IDS.formato)!,
    resumen: el(IDS.resumen)!,
    error: el(IDS.error)!,
    generar: el<HTMLButtonElement>(IDS.generar)!,
    generarTexto: el(IDS.generarTexto)!,
    generarSpinner: el(IDS.generarSpinner)!,
  };

  document.querySelectorAll<HTMLElement>('[data-abrir-imprimir-qr]').forEach((boton) => {
    boton.addEventListener('click', () => { void abrir(); });
  });

  el(IDS.cerrar)?.addEventListener('click', () => mostrar(false));
  modal.addEventListener('click', (evento) => {
    if (evento.target === modal) mostrar(false);
  });

  document.querySelectorAll<HTMLInputElement>('input[name="filtroImprimirQr"]')
    .forEach((radio) => radio.addEventListener('change', sincronizar));

  ui.formato.addEventListener('change', sincronizar);

  el(IDS.marcarTodas)?.addEventListener('click', () => {
    seleccion = new Set(cajas.map((caja) => caja.id));
    pintarLista();
    sincronizar();
  });

  el(IDS.marcarNinguna)?.addEventListener('click', () => {
    seleccion = new Set();
    pintarLista();
    sincronizar();
  });

  ui.generar.addEventListener('click', () => { void generar(); });

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !modal.classList.contains('hidden')) mostrar(false);
  });

  sincronizar();
}
