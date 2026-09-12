// =============================================================================
// LISTADO JERÁRQUICO DE OBJETOS (controlador)
// -----------------------------------------------------------------------------
// Consume GET /api/contenedores/arbol/ (payload optimizado sin N+1) y pinta la
// pantalla en TRES secciones jerárquicas descendentes:
//   1. SECCIÓN 1 · 📦 Cajas e Inventario Interno → SOLO cajas móviles
//      (`tipo='CAJA'` y `es_inmueble=false`). El Armario Empotrado y el Setup PC
//      (estructuras fijas) quedan FUERA de este bloque superior.
//   2. SECCIÓN 2 · 🧸 Objetos Sueltos o sin Caja (bandeja de huérfanos).
//   3. SECCIÓN 3 · 🗄 Muebles y Estructuras Móviles (excluye `es_inmueble`).
//   Los `tipo='ESTANTE'` quedan EXCLUIDOS de toda consulta y renderizado.
// La construcción de HTML vive en listadoObjetosRender.ts (capa pura) y las
// acciones operativas de las tarjetas (Mover/Editar/Eliminar) en cajaOperativa.ts.
// Auth centralizada: getAuthHeaders() desde src/services/auth (no se duplica).
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { cargarContextoRutaCaja } from './rutaCajaMinimapas';
import { initCajaOperativa } from './cajaOperativa';
import {
  esc,
  resumenInventarioHtml,
  seccionCajasHtml,
  seccionMueblesHtml,
  seccionSueltosHtml,
} from './listadoObjetosRender';
import type { PayloadArbol } from './listadoObjetosRender';

// Re-export del contrato del payload para consumidores externos.
export type { ObjetoArbol, NodoContenedor, GrupoEstructura, PayloadArbol } from './listadoObjetosRender';

interface Filtros {
  decision: string;
  categoria: string;
  publicado_ml: string;
}

// ---------------------------------------------------------------------------
// Estado y referencias DOM
// ---------------------------------------------------------------------------

let loadingEl: HTMLElement | null = null;
let errorEl: HTMLElement | null = null;
let errorMsgEl: HTMLElement | null = null;
let retryBtn: HTMLElement | null = null;
let emptyEl: HTMLElement | null = null;
let sinResultadosEl: HTMLElement | null = null;
let resumenEl: HTMLElement | null = null;
let seccionesWrap: HTMLElement | null = null;
let seccionCajas: HTMLElement | null = null;
let cajasContainer: HTMLElement | null = null;
let seccionMuebles: HTMLElement | null = null;
let mueblesContainer: HTMLElement | null = null;
let seccionSueltos: HTMLElement | null = null;
let gridSueltos: HTMLElement | null = null;
let filtroDecision: HTMLSelectElement | null = null;
let filtroCategoria: HTMLSelectElement | null = null;
let filtroPublicado: HTMLSelectElement | null = null;
let searchInput: HTMLInputElement | null = null;
let exportCsvBtn: HTMLElement | null = null;

const filtros: Filtros = { decision: '', categoria: '', publicado_ml: '' };

function mostrar(el: HTMLElement | null, visible: boolean): void {
  if (!el) return;
  el.classList.toggle('hidden', !visible);
}

// ---------------------------------------------------------------------------
// Carga del payload jerárquico (GET /api/contenedores/arbol/)
// ---------------------------------------------------------------------------

function construirUrlArbol(): string {
  const params = new URLSearchParams();
  if (filtros.decision) params.set('decision', filtros.decision);
  if (filtros.categoria) params.set('categoria', filtros.categoria);
  if (filtros.publicado_ml) params.set('publicado_ml', filtros.publicado_ml);
  const texto = (searchInput && searchInput.value ? searchInput.value : '').trim();
  if (texto.length >= 2) params.set('search', texto);
  const qs = params.toString();
  return API_BASE_URL + '/contenedores/arbol/' + (qs ? '?' + qs : '');
}

async function cargar(): Promise<void> {
  if (!loadingEl || !errorEl) return;
  mostrar(errorEl, false);
  mostrar(emptyEl, false);
  mostrar(sinResultadosEl, false);
  mostrar(loadingEl, true);
  try {
    const res = await fetch(construirUrlArbol(), { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) {
      throw new Error('Error al consultar el árbol de inventario (' + res.status + ').');
    }
    const payload = (await res.json()) as PayloadArbol;
    render(payload);
  } catch (err: any) {
    if (errorMsgEl) {
      errorMsgEl.textContent = err && err.message
        ? err.message
        : 'Error de conexión al cargar el inventario.';
    }
    mostrar(errorEl, true);
  } finally {
    mostrar(loadingEl, false);
  }
}

// ---------------------------------------------------------------------------
// Render del árbol jerárquico
// ---------------------------------------------------------------------------

function render(payload: PayloadArbol): void {
  const estructuras = payload.estructuras || [];
  const cajas = payload.cajas || [];
  const sueltos = payload.sueltos || [];
  const resumen = payload.resumen || { contenedores: 0, objetos_ubicados: 0, objetos_sueltos: 0 };

  // SECCIÓN 1 · 📦 Cajas e Inventario Interno. FILTRO DE DESCARTE ABSOLUTO
  // aplicado en seccionCajasHtml: SOLO cajas móviles (`tipo='CAJA'` y
  // `es_inmueble=false`). Armario Empotrado / Setup PC → removidos.
  const cajasHtml = seccionCajasHtml(cajas);
  // SECCIÓN 3 · 🗄 Muebles y Estructuras Móviles (excluye inmuebles fijos).
  const mueblesHtml = seccionMueblesHtml(estructuras);
  // SECCIÓN 2 · 🧸 Objetos Sueltos o sin Caja (bandeja de huérfanos).
  const sueltosHtml = seccionSueltosHtml(sueltos);

  const haySecciones = cajasHtml.length > 0 || mueblesHtml.length > 0 || sueltosHtml.length > 0;

  if (resumenEl && haySecciones) {
    resumenEl.innerHTML = resumenInventarioHtml(resumen, payload.filtros_activos);
    mostrar(resumenEl, true);
  }

  // Caso borde: si TODOS los contenedores del Estok son inmuebles fijos
  // (descartados de forma absoluta) y no hay objetos sueltos, no queda nada que
  // listar → se degrada al estado vacío en vez de una pantalla muda.
  if (!haySecciones) {
    mostrar(seccionCajas, false);
    mostrar(seccionSueltos, false);
    mostrar(seccionMuebles, false);
    mostrar(seccionesWrap, false);
    mostrar(resumenEl, false);
    if (payload.filtros_activos) {
      mostrar(sinResultadosEl, true);
    } else {
      mostrar(emptyEl, true);
    }
    return;
  }

  mostrar(sinResultadosEl, false);
  mostrar(emptyEl, false);

  if (cajasContainer) cajasContainer.innerHTML = cajasHtml;
  if (mueblesContainer) mueblesContainer.innerHTML = mueblesHtml;
  if (gridSueltos) gridSueltos.innerHTML = sueltosHtml;

  mostrar(seccionCajas, cajasHtml.length > 0);
  mostrar(seccionSueltos, sueltosHtml.length > 0);
  mostrar(seccionMuebles, mueblesHtml.length > 0);
  // El lienzo de textura corporativa solo se muestra si hay alguna sección.
  mostrar(seccionesWrap, true);
}

// ---------------------------------------------------------------------------
// Filtros dinámicos y búsqueda
// ---------------------------------------------------------------------------

function aplicarFiltros(): void {
  filtros.decision = filtroDecision ? filtroDecision.value : '';
  filtros.categoria = filtroCategoria ? filtroCategoria.value : '';
  filtros.publicado_ml = filtroPublicado ? filtroPublicado.value : '';
  void cargar();
}

async function cargarCategoriasFiltros(): Promise<void> {
  if (!filtroCategoria) return;
  try {
    const res = await fetch(API_BASE_URL + '/categorias/', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const categorias: Array<{ id: string; nombre: string; icono?: string }> = data.results || data || [];
    let html = '<option value="">Todas</option>';
    for (const c of categorias) {
      html += '<option value="' + esc(c.id) + '">' + esc(c.icono || '🏷️') + ' ' + esc(c.nombre) + '</option>';
    }
    filtroCategoria.innerHTML = html;
  } catch {
    // El árbol se carga igual sin el desplegable de categorías.
  }
}

// ---------------------------------------------------------------------------
// Eliminación de objetos sueltos (soft delete vía API)
// ---------------------------------------------------------------------------

async function eliminarObjeto(id: string): Promise<void> {
  try {
    const res = await fetch(API_BASE_URL + '/objetos/' + encodeURIComponent(id) + '/', {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) {
      const win = window as any;
      if (win.showError) win.showError('Error al eliminar el objeto.');
      return;
    }
    const win = window as any;
    if (win.showSuccess) win.showSuccess('✅ Objeto eliminado correctamente');
    void cargar();
  } catch {
    const win = window as any;
    if (win.showError) win.showError('Error de conexión al eliminar el objeto.');
  }
}

// ---------------------------------------------------------------------------
// Exportar CSV (acción del encabezado)
// ---------------------------------------------------------------------------

function enlazarExportarCsv(): void {
  if (!exportCsvBtn) return;
  exportCsvBtn.addEventListener('click', async () => {
    const win = window as any;
    try {
      const res = await fetch(API_BASE_URL + '/objetos/exportar_csv/', { headers: getAuthHeaders() });
      if (!res.ok) {
        if (win.showError) win.showError('Error al exportar CSV');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'inventario_estok_' + new Date().toISOString().split('T')[0] + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      if (win.showSuccess) win.showSuccess('✅ CSV exportado correctamente');
    } catch {
      if (win.showError) win.showError('Error de conexión al exportar CSV');
    }
  });
}

// ---------------------------------------------------------------------------
// Enlace de eventos con delegación (auth centralizada en src/services/auth)
// ---------------------------------------------------------------------------

function enlazarEventos(): void {
  if (filtroDecision) filtroDecision.addEventListener('change', aplicarFiltros);
  if (filtroCategoria) filtroCategoria.addEventListener('change', aplicarFiltros);
  if (filtroPublicado) filtroPublicado.addEventListener('change', aplicarFiltros);

  let timeout: number | null = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      if (timeout) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => void cargar(), 300);
    });
  }

  if (retryBtn) retryBtn.addEventListener('click', () => void cargar());
  enlazarExportarCsv();

  // Delegación global para botones "Eliminar" dentro de viñetas y tarjetas.
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const btn = target && target.closest ? target.closest('.js-eliminar-objeto') as HTMLElement | null : null;
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const nombre = btn.getAttribute('data-nombre') || 'este objeto';
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    const ok = window.confirm('¿Eliminar "' + nombre + '"?\nSe marcará como eliminado (soft delete).');
    if (!ok) return;
    void eliminarObjeto(id);
  });
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------

export function initListadoJerarquicoObjetos(): void {
  loadingEl = document.getElementById('loadingState');
  errorEl = document.getElementById('errorState');
  errorMsgEl = document.getElementById('errorMessage');
  retryBtn = document.getElementById('retryBtn');
  emptyEl = document.getElementById('emptyState');
  sinResultadosEl = document.getElementById('sinResultados');
  resumenEl = document.getElementById('resumenInventario');
  seccionesWrap = document.getElementById('seccionesInventario');
  seccionCajas = document.getElementById('seccionCajas');
  cajasContainer = document.getElementById('cajasContainer');
  seccionMuebles = document.getElementById('seccionMuebles');
  mueblesContainer = document.getElementById('mueblesContainer');
  seccionSueltos = document.getElementById('seccionSueltos');
  gridSueltos = document.getElementById('objetosGrid');
  filtroDecision = document.getElementById('filtroDecision') as HTMLSelectElement | null;
  filtroCategoria = document.getElementById('filtroCategoria') as HTMLSelectElement | null;
  filtroPublicado = document.getElementById('filtroPublicado') as HTMLSelectElement | null;
  searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
  exportCsvBtn = document.getElementById('exportCsvBtn');

  mostrar(sinResultadosEl, false);
  mostrar(seccionesWrap, false);
  mostrar(seccionCajas, false);
  mostrar(seccionSueltos, false);
  mostrar(seccionMuebles, false);
  enlazarEventos();

  // Capacidades operacionales de las tarjetas de contenedor: los botones
  // Mover/Editar/Eliminar abren micro-modales que persisten en la API y, al
  // guardar/eliminar, re-pintan el árbol en caliente.
  initCajaOperativa(() => void cargar());

  // La red de minimapas en cadena de cada caja necesita el plano de ubicaciones,
  // TODOS los contenedores del Estok (incluidas las cajas anidadas) y la grilla
  // del macro-Estok: se cargan una sola vez y la primera carga del árbol espera
  // ese contexto para poder pintar la ruta (Piso → Habitación → Mueble).
  const contextoRuta = cargarContextoRutaCaja();

  // Navegación cruzada desde el Dashboard: /objetos?categoria_id=XX (en caliente).
  const params = new URLSearchParams(window.location.search);
  const catId = params.get('categoria_id');

  if (catId) {
    Promise.all([contextoRuta, cargarCategoriasFiltros()]).then(() => {
      const existe = filtroCategoria ? Array.from(filtroCategoria.options).some((opt) => opt.value === catId) : false;
      if (existe && filtroCategoria) {
        filtroCategoria.value = catId;
        filtroCategoria.dispatchEvent(new Event('change'));
      } else {
        void cargar();
      }
    });
  } else {
    Promise.all([contextoRuta, cargarCategoriasFiltros()]).then(() => void cargar());
  }
}



