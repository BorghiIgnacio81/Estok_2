// =============================================================================
// SECCIÓN DESTACADA · 🏷️ OBJETOS CON DECISIÓN DE VENTA / LISTOS PARA PUBLICAR
// -----------------------------------------------------------------------------
// Acceso rápido de la cima de /alertas-stock: muestra TODOS los objetos del
// Estok activo con decisión patrimonial de venta (owner_action = 'vender'),
// separando los que ya se publicaron de los que están listos para publicar.
//
// Datos: GET /api/objetos/en_venta/ (DecisionesActionsMixin), que devuelve el
// payload único de Decisiones (nombre, foto, valor estimado, ubicación actual y
// estado de publicación) sin depender de los demás bloques del tablero.
//
// Cada tarjeta ofrece:
//   · 📢 Publicar / Generar Anuncio → abre el modal de publicación existente
//     (lib/publicarObjeto.ts) para Mercado Libre / Facebook Marketplace.
//   · 🔗 Ver publicación / 👁️ Ver detalle → ficha interna del objeto.
//
// El markup de la tarjeta NO se duplica: lo comparte con el resto del tablero
// desde lib/decisionesTarjeta.ts (disciplina de modularidad del proyecto).
// Auth 100% centralizada en services/auth (getAuthHeaders).
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { escapar, formatUSD, tarjetaObjetoHtml } from './decisionesTarjeta';
import type { ObjetoDecision } from './decisionesTarjeta';
import { estaPublicado, ordenarVentasDestacadas } from './decisionesOrden';
import { abrirPublicarObjeto } from './publicarObjeto';
import { cargarContextoRutaCaja } from './rutaCajaMinimapas';
import { initRutaGeograficaDespliegue } from './rutaGeograficaDespliegue';
import {
  EVENTO_DECISION_CAMBIADA,
  EVENTO_PUBLICACION_ACTUALIZADA,
} from './eventosDecisiones';

/** Respuesta de GET /api/objetos/en_venta/. */
interface RespuestaVenta {
  count: number;
  results: ObjetoDecision[];
  resumen?: {
    total?: number;
    sin_publicar?: number;
    publicados?: number;
    valor_total?: number;
  };
}

let objetos: ObjetoDecision[] = [];
let cargando = false;

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function mostrar(id: string, visible: boolean): void {
  el(id)?.classList.toggle('hidden', !visible);
}

// -----------------------------------------------------------------------------
// Carga
// -----------------------------------------------------------------------------

async function traerVentas(): Promise<RespuestaVenta> {
  const res = await fetch(`${API_BASE_URL}/objetos/en_venta/`, {
    headers: getAuthHeaders(),
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sesión expirada.');
  }
  if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
  return res.json();
}

/**
 * Recarga la sección destacada de venta (también desde otras islas).
 *
 * ORDEN DE CARGA A PRUEBA DE FALLOS: primero se piden y pintan las tarjetas
 * de venta y DESPUÉS se intenta cargar el contexto geográfico de minimapas.
 * El contexto es SECUNDARIO: si `cargarContextoRutaCaja()` falla (403 de un
 * rol, endpoint caído, estok sin plano), las tarjetas YA están visibles y el
 * listado de venta NO se pierde. Bug real corregido: antes un fallo del
 * contexto vaciaba la sección completa y parecía que no había objetos para
 * vender cuando el backend sí los devolvía.
 */
async function refrescarVentasDestacadas(): Promise<void> {
  if (cargando) return;
  cargando = true;
  el('ventaDestacadaLoading')?.classList.remove('hidden');
  mostrar('ventaDestacadaError', false);
  try {
    const data = await traerVentas();
    // Listos para publicar arriba; ya publicados después; despachados al fondo.
    objetos = ordenarVentasDestacadas(data.results || []);
    render(data.resumen);

    try {
      await cargarContextoRutaCaja();
      // Re-render para dibujar la mini-guía geográfica ya con el contexto.
      render(data.resumen);
    } catch (contextoError) {
      console.warn(
        '[Ventas] Contexto de minimapas no disponible (la lista se mantiene):',
        contextoError,
      );
    }
  } catch (error) {
    objetos = [];
    render();
    // El estado vacío NO se muestra junto al error: son estados excluyentes.
    mostrar('ventaDestacadaVacio', false);
    const detalle = el('ventaDestacadaError');
    if (detalle) {
      detalle.textContent = error instanceof Error
        ? `⚠️ No se pudieron cargar los objetos en venta: ${error.message}`
        : '⚠️ No se pudieron cargar los objetos en venta.';
    }
    mostrar('ventaDestacadaError', true);
  } finally {
    cargando = false;
    el('ventaDestacadaLoading')?.classList.add('hidden');
  }
}


// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

function piePublicacionHtml(obj: ObjetoDecision): string {
  if (estaPublicado(obj)) {
    return `
      <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-[11px] text-emerald-800 font-semibold">
        🔗 ${escapar(obj.estado_publicacion_label || 'Publicado')} · listo para vender
      </div>`;
  }
  return `
    <div class="bg-emerald-600 text-white rounded-lg p-2 text-[11px] font-bold text-center tracking-wide">
      📢 LISTO PARA PUBLICAR
    </div>`;
}

/** Acciones rápidas: publicar/generar anuncio + acceso a la ficha. */
function accionesVentaHtml(obj: ObjetoDecision): string {
  const id = escapar(obj.id);
  const verDetalle = `
    <a href="/objetos/${id}"
      class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-base">
      👁️ Ver detalle
    </a>`;

  const accionPrincipal = estaPublicado(obj)
    ? `<a href="${escapar(obj.url_publicacion || `/objetos/${obj.id}`)}"
        ${obj.url_publicacion ? 'target="_blank" rel="noopener"' : ''}
        class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-base">
        🔗 Ver publicación
      </a>`
    : `<button type="button" data-publicar="${id}"
        class="inline-flex items-center justify-center gap-1 px-2 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-base">
        📢 Publicar / Generar Anuncio
      </button>`;

  return `<div class="mt-auto flex flex-col gap-1.5">${accionPrincipal}${verDetalle}</div>`;
}

function cardVenta(obj: ObjetoDecision): string {
  // Las tarjetas PENDIENTES de publicar son el foco de la sección: borde y
  // sombra más fuertes para que el acceso directo se vea de un vistazo.
  const listoParaPublicar = !estaPublicado(obj) && !obj.despachado_en;
  return tarjetaObjetoHtml(obj, {
    pie: piePublicacionHtml(obj),
    acciones: accionesVentaHtml(obj),
    atributos: 'data-grupo="venta-destacada"',
    extraClases: listoParaPublicar
      ? 'ring-2 ring-emerald-400 shadow-md'
      : 'ring-1 ring-emerald-200',
  });
}

function render(resumen?: RespuestaVenta['resumen']): void {
  const grid = el('ventaDestacadaGrid');
  if (grid) grid.innerHTML = objetos.map(cardVenta).join('');

  const hay = objetos.length > 0;
  grid?.classList.toggle('hidden', !hay);
  mostrar('ventaDestacadaVacio', !hay);

  const contador = el('ventaDestacadaCount');
  if (contador) {
    contador.textContent = String(objetos.length);
    contador.classList.toggle('hidden', !hay);
  }

  const detalle = el('ventaDestacadaResumen');
  if (detalle) {
    const sinPublicar = resumen?.sin_publicar
      ?? objetos.filter((o) => !estaPublicado(o)).length;
    const publicados = resumen?.publicados ?? objetos.length - sinPublicar;
    const valor = resumen?.valor_total
      ?? objetos.reduce((total, o) => total + (parseFloat(o.valor_estimado || '0') || 0), 0);
    detalle.textContent = hay
      ? `${objetos.length} objeto(s) · 📢 ${sinPublicar} sin publicar · 🔗 ${publicados} publicados · Valor estimado ${formatUSD(String(valor))}`
      : '';
  }
}

// -----------------------------------------------------------------------------
// Acciones (clic delegado)
// -----------------------------------------------------------------------------

function onClickVenta(evento: Event): void {
  const objetivo = evento.target as HTMLElement | null;
  const publicar = objetivo?.closest<HTMLElement>('[data-publicar]');
  if (!publicar) return;
  const obj = objetos.find((o) => o.id === publicar.dataset.publicar);
  if (!obj) return;
  abrirPublicarObjeto({
    id: obj.id,
    nombre: obj.nombre,
    valor: obj.valor_estimado,
  });
}

// -----------------------------------------------------------------------------
// Arranque (idempotente)
// -----------------------------------------------------------------------------

/** Inicializa la sección destacada de objetos con decisión de venta. */
export function iniciarVentasDestacadas(): void {
  const host = el('ventaDestacada');
  if (!host || host.dataset.activo === 'true') return;
  host.dataset.activo = 'true';

  // Delegación del widget de ruta jerárquica (texto → minimapas), idempotente.
  initRutaGeograficaDespliegue();
  host.addEventListener('click', onClickVenta);
  el('btnRefrescarVenta')?.addEventListener('click', () => void refrescarVentasDestacadas());

  // Cambios de decisión desde la grilla de pendientes / el tablero y cambios de
  // publicación (Mercado Libre / Facebook) refrescan esta sección al instante.
  window.addEventListener(EVENTO_DECISION_CAMBIADA, () => void refrescarVentasDestacadas());
  window.addEventListener(EVENTO_PUBLICACION_ACTUALIZADA, () => void refrescarVentasDestacadas());

  void refrescarVentasDestacadas();
}
