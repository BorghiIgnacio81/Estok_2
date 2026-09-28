// =============================================================================
// MODAL UNIFICADO DE EXPORTACIÓN (pestaña Objetos) — controlador
// -----------------------------------------------------------------------------
// Un único trigger («Exportar Datos / Informe») abre el modal de doble columna
// definido en components/objetos/ModalExportarDatos.astro:
//
//   COLUMNA CSV → selector de alcance (Estok Completo / Solo Objetos /
//     Solo Contenedores) que viaja como ?alcance=... a
//     GET /api/objetos/exportar_csv/
//   COLUMNA PDF → checkboxes de formato (incluir_mapas, mostrar_precios,
//     ahorro_tinta) que viajan como booleanos a
//     GET /api/objetos/exportar_pdf/
//
// Auth centralizada: getAuthHeaders() (JWT + X-Estok-Id del tenant activo)
// vive ÚNICAMENTE en src/services/auth y se reutiliza acá: este módulo NUNCA
// define headers propios (evita el 401 del multi-tenant).
// Avisos flotantes: window.showSuccess/showError del layout base.
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../services/auth';

// -----------------------------------------------------------------------------
// Ids del markup (components/objetos/ModalExportarDatos.astro)
// -----------------------------------------------------------------------------
const BOTON_ABRIR = 'btnExportarDatos';
const MODAL = 'modalExportarDatos';
const BOTON_CERRAR = 'cerrarModalExportarDatos';
const BOTON_CSV = 'btnDescargarCsv';
const BOTON_PDF = 'btnDescargarPdf';
const CHK_MAPAS = 'chkIncluirMapas';
const CHK_PRECIOS = 'chkMostrarPrecios';
const CHK_TINTA = 'chkAhorroTinta';

const CLASES_ACTIVO = ['border-green-500', 'bg-green-50'];
const CLASES_INACTIVO = ['border-gray-200', 'bg-white'];

interface AvisosGlobales {
  showSuccess?: (mensaje: string) => void;
  showError?: (mensaje: string) => void;
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function avisos(): AvisosGlobales {
  return window as unknown as AvisosGlobales;
}

function hoy(): string {
  return new Date().toISOString().split('T')[0];
}

// -----------------------------------------------------------------------------
// Modal (abrir / cerrar)
// -----------------------------------------------------------------------------
function mostrarModal(visible: boolean): void {
  const modal = el(MODAL);
  if (!modal) return;
  modal.classList.toggle('hidden', !visible);
  modal.classList.toggle('flex', visible);
  document.body.classList.toggle('overflow-hidden', visible);
}

function estaAbierto(): boolean {
  const modal = el(MODAL);
  return Boolean(modal) && !modal!.classList.contains('hidden');
}

// -----------------------------------------------------------------------------
// Selección del alcance del CSV (botones segmentados reactivos)
// -----------------------------------------------------------------------------
function alcanceSeleccionado(): string {
  const radio = document.querySelector<HTMLInputElement>('input[name="alcanceCsv"]:checked');
  return radio?.value || 'completo';
}

function sincronizarAlcance(): void {
  const activo = alcanceSeleccionado();
  document.querySelectorAll<HTMLElement>('.js-alcance').forEach((etiqueta) => {
    const esActiva = etiqueta.dataset.alcance === activo;
    for (const clase of CLASES_ACTIVO) etiqueta.classList.toggle(clase, esActiva);
    for (const clase of CLASES_INACTIVO) etiqueta.classList.toggle(clase, !esActiva);
  });
}

function opcionesPdf() {
  return {
    incluir_mapas: el<HTMLInputElement>(CHK_MAPAS)?.checked ?? false,
    mostrar_precios: el<HTMLInputElement>(CHK_PRECIOS)?.checked ?? false,
    ahorro_tinta: el<HTMLInputElement>(CHK_TINTA)?.checked ?? false,
  };
}

function urlCsv(): string {
  return API_BASE_URL + '/objetos/exportar_csv/?alcance='
    + encodeURIComponent(alcanceSeleccionado());
}

function urlPdf(): string {
  const opciones = opcionesPdf();
  const params = new URLSearchParams({
    incluir_mapas: String(opciones.incluir_mapas),
    mostrar_precios: String(opciones.mostrar_precios),
    ahorro_tinta: String(opciones.ahorro_tinta),
  });
  return API_BASE_URL + '/objetos/exportar_pdf/?' + params.toString();
}

// -----------------------------------------------------------------------------
// Descarga (blob) con JWT + X-Estok-Id
// -----------------------------------------------------------------------------
function descargarBlob(blob: Blob, nombre: string): void {
  const url = window.URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  window.URL.revokeObjectURL(url);
}

/** Nombre que propone el backend (Content-Disposition), si es legible. */
function nombreDesdeCabecera(res: Response): string | null {
  const cabecera = res.headers.get('Content-Disposition') || '';
  const coincidencia = /filename="?([^";]+)"?/i.exec(cabecera);
  return coincidencia ? coincidencia[1] : null;
}

async function descargar(
  url: string,
  nombrePorDefecto: string,
  boton: HTMLButtonElement | null,
  etiqueta: string,
): Promise<void> {
  if (boton) boton.disabled = true;
  try {
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) {
      avisos().showError?.('No se pudo generar ' + etiqueta + ' (HTTP ' + res.status + ').');
      return;
    }
    const blob = await res.blob();
    descargarBlob(blob, nombreDesdeCabecera(res) || nombrePorDefecto);
    avisos().showSuccess?.('✅ ' + etiqueta + ' descargado correctamente.');
    mostrarModal(false);
  } catch {
    avisos().showError?.('Error de conexión al descargar ' + etiqueta + '.');
  } finally {
    if (boton) boton.disabled = false;
  }
}

// -----------------------------------------------------------------------------
// Enlace de eventos
// -----------------------------------------------------------------------------
function enlazarAperturaYCierre(): void {
  el(BOTON_ABRIR)?.addEventListener('click', () => {
    sincronizarAlcance();
    mostrarModal(true);
  });

  el(BOTON_CERRAR)?.addEventListener('click', () => mostrarModal(false));

  // Clic en el fondo oscuro (fuera de la tarjeta) cierra el modal.
  const modal = el(MODAL);
  modal?.addEventListener('click', (evento) => {
    if (evento.target === modal) mostrarModal(false);
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && estaAbierto()) mostrarModal(false);
  });

  document.querySelectorAll<HTMLInputElement>('input[name="alcanceCsv"]')
    .forEach((radio) => radio.addEventListener('change', sincronizarAlcance));
}

function enlazarDescargas(): void {
  const botonCsv = el<HTMLButtonElement>(BOTON_CSV);
  botonCsv?.addEventListener('click', () => {
    void descargar(
      urlCsv(),
      'inventario_estok_' + alcanceSeleccionado() + '_' + hoy() + '.csv',
      botonCsv,
      'el CSV',
    );
  });

  const botonPdf = el<HTMLButtonElement>(BOTON_PDF);
  botonPdf?.addEventListener('click', () => {
    void descargar(
      urlPdf(),
      'informe_estok_' + hoy() + '.pdf',
      botonPdf,
      'el informe PDF',
    );
  });
}

// -----------------------------------------------------------------------------
// Entrada pública (invocada desde pages/objetos.astro)
// -----------------------------------------------------------------------------
export function initModalExportarDatos(): void {
  if (!el(BOTON_ABRIR) || !el(MODAL)) return;
  sincronizarAlcance();
  enlazarAperturaYCierre();
  enlazarDescargas();
}
