// =============================================================================
// SECCIÓN 5 · 📜 HISTÓRICO: OBJETOS VENDIDOS Y TIRADOS (/alertas-stock)
// -----------------------------------------------------------------------------
// Objetos que COMPLETARON su ciclo patrimonial:
//
//   💰 VENDIDOS → precio final de venta, fecha, canal y la ETIQUETA del usuario
//                 que concretó la venta («Vendido por …»). Fuente única: el
//                 asiento `VentaObjeto` creado por «✅ Marcar como Vendido».
//   🗑️ TIRADOS / DONADOS → fecha del descarte/donación definitivos (baja lógica
//                 del objeto con la decisión `tirar` conservada).
//
// Datos: GET /api/objetos/historico/ (inventario/api/viewsets/objetos/
// cierre_actions.py → services/cierre_service.py).
//
// El objeto se MUEVE solo a esta sección: al cerrar el ciclo desde «Decisiones
// tomadas» (lib/decisionesCierre.ts) se emite EVENTO_DECISION_CAMBIADA y, en el
// descarte físico, EVENTO_CAMBIO_DESCARTE: ambos recargan el histórico sin
// esperar a un refresh manual.
//
// Las filas se marcan con `atributosFiltroObjeto()` para que la barra de
// filtros de la página (lib/filtrosDecisiones.ts) funcione igual que sobre las
// tarjetas del tablero.
//
// Auth 100% centralizada en services/auth (getAuthHeaders).
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { ASSET_MUEBLE } from './assetsUi';
import { escapeHtml as escapar } from './escapeHtml';
import { formatearMoneda } from './formatoMoneda';
import { EVENTO_DECISION_CAMBIADA } from './eventosDecisiones';
import { EVENTO_CAMBIO_DESCARTE } from './descarteGracia';
import { atributosFiltroObjeto } from './filtrosDecisiones';

/** Asiento de venta que ya cerró el ciclo del objeto. */
interface VentaHistorico {
  id: string;
  objeto_id: string | null;
  nombre: string;
  foto_principal: string | null;
  precio_venta: string | null;
  moneda: string;
  canal: string;
  canal_label: string | null;
  usuario_vendedor_id: string | null;
  usuario_vendedor_nombre: string | null;
  vendido_en: string | null;
  marca: string | null;
  categoria_nombre: string | null;
  dueno_id: string | null;
  dueno_nombre: string | null;
}

/** Objeto descartado / donado (baja lógica definitiva). */
interface TiradoHistorico {
  id: string;
  nombre: string;
  foto_principal: string | null;
  descarte_en: string | null;
  marca: string | null;
  categoria_nombre: string | null;
  dueno_id: string | null;
  dueno_nombre: string | null;
}

/** Respuesta de GET /api/objetos/historico/. */
interface RespuestaHistorico {
  count: number;
  vendidos: VentaHistorico[];
  tirados: TiradoHistorico[];
  resumen?: {
    vendidos?: number;
    tirados?: number;
    total?: number;
    recaudado?: string;
  };
}

let datos: RespuestaHistorico | null = null;
let cargando = false;

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function mostrar(id: string, visible: boolean): void {
  el(id)?.classList.toggle('hidden', !visible);
}

/** Fecha corta es-AR (dd/mm/aaaa) de un ISO 8601 del backend. */
function formatearFecha(iso: string | null): string {
  if (!iso) return '—';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Foto de la fila (placeholder de mueble cuando el objeto no tiene fotos). */
function fotoHtml(url: string | null): string {
  return `<img src="${url ? escapar(url) : ASSET_MUEBLE}" alt="" loading="lazy"
    class="h-12 w-12 shrink-0 rounded-lg object-cover bg-slate-100" />`;
}

/** Línea de contexto común: categoría y propietario del objeto. */
function contextoHtml(nombre: string | null, dueno: string | null): string {
  const partes = [
    nombre ? `🏷️ ${escapar(nombre)}` : '',
    dueno ? `👤 ${escapar(dueno)}` : '',
  ].filter(Boolean);
  if (!partes.length) return '';
  return `<p class="text-[11px] text-gray-500 truncate">${partes.join(' · ')}</p>`;
}


// -----------------------------------------------------------------------------
// Filas del histórico (marcadas para la barra de filtros)
// -----------------------------------------------------------------------------

/** Fila de un objeto VENDIDO: precio final, fecha y usuario que vendió. */
function filaVentaHtml(venta: VentaHistorico): string {
  const filtro = atributosFiltroObjeto({
    nombre: venta.nombre,
    marca: venta.marca,
    categoria: venta.categoria_nombre,
    duenoId: venta.dueno_id,
  });
  const canal = venta.canal_label ? ` · 🏦 ${escapar(venta.canal_label)}` : '';
  // ETIQUETA DEL USUARIO QUE CONCRETÓ LA VENTA (contabilidad del Estok).
  const vendedor = venta.usuario_vendedor_nombre
    ? `<span class="inline-flex max-w-full truncate items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">👤 Vendido por ${escapar(venta.usuario_vendedor_nombre)}</span>`
    : '<span class="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-500">👤 Vendedor sin registrar</span>';

  return `
    <article class="flex items-start gap-3 bg-white rounded-xl border border-emerald-200 shadow-sm p-2.5" ${filtro}>
      ${fotoHtml(venta.foto_principal)}
      <div class="min-w-0 flex-1 flex flex-col gap-0.5">
        <p class="text-sm font-semibold text-gray-900 truncate" title="${escapar(venta.nombre)}">${escapar(venta.nombre)}</p>
        ${contextoHtml(venta.categoria_nombre, venta.dueno_nombre)}
        <p class="text-[11px] text-gray-500 truncate">📅 ${formatearFecha(venta.vendido_en)}${canal}</p>
        <div class="mt-0.5">${vendedor}</div>
      </div>
      <div class="shrink-0 text-right">
        <p class="text-sm font-bold text-emerald-700">${formatearMoneda(venta.precio_venta)}</p>
        <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400">${escapar(venta.moneda || 'USD')}</p>
      </div>
    </article>`;
}

/** Fila de un objeto TIRADO / DONADO: fecha del descarte definitivo. */
function filaTiradoHtml(objeto: TiradoHistorico): string {
  const filtro = atributosFiltroObjeto({
    nombre: objeto.nombre,
    marca: objeto.marca,
    categoria: objeto.categoria_nombre,
    duenoId: objeto.dueno_id,
  });
  return `
    <article class="flex items-start gap-3 bg-white rounded-xl border border-red-200 shadow-sm p-2.5" ${filtro}>
      ${fotoHtml(objeto.foto_principal)}
      <div class="min-w-0 flex-1 flex flex-col gap-0.5">
        <p class="text-sm font-semibold text-gray-900 truncate" title="${escapar(objeto.nombre)}">${escapar(objeto.nombre)}</p>
        ${contextoHtml(objeto.categoria_nombre, objeto.dueno_nombre)}
        <p class="text-[11px] text-gray-500 truncate">📅 Descartado / donado el ${formatearFecha(objeto.descarte_en)}</p>
      </div>
      <span class="shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-800">🗑️ Tirado / Donado</span>
    </article>`;
}

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

function render(): void {
  const vendidos = datos?.vendidos ?? [];
  const tirados = datos?.tirados ?? [];
  const total = vendidos.length + tirados.length;
  const recaudado = formatearMoneda(datos?.resumen?.recaudado ?? null);

  // Badge del acordeón + resumen del encabezado.
  const contador = el('historicoCount');
  if (contador) {
    contador.textContent = String(total);
    contador.classList.toggle('hidden', total === 0);
  }
  const detalle = el('historicoResumen');
  if (detalle) {
    detalle.textContent = total
      ? `${vendidos.length} vendido(s) · ${tirados.length} tirado(s)/donado(s) · Recaudado ${recaudado}`
      : '';
  }

  // Empty state global (sólo si no hay NINGÚN objeto en el histórico).
  mostrar('historicoVacio', total === 0);

  // 💰 Vendidos
  const badgeVendidos = el('historicoVendidosCount');
  if (badgeVendidos) {
    badgeVendidos.textContent = String(vendidos.length);
    badgeVendidos.classList.toggle('hidden', vendidos.length === 0);
  }
  const gridVendidos = el('historicoVendidosGrid');
  if (gridVendidos) gridVendidos.innerHTML = vendidos.map(filaVentaHtml).join('');
  mostrar('historicoVendidosBloque', vendidos.length > 0);

  // 🗑️ Tirados / Donados
  const badgeTirados = el('historicoTiradosCount');
  if (badgeTirados) {
    badgeTirados.textContent = String(tirados.length);
    badgeTirados.classList.toggle('hidden', tirados.length === 0);
  }
  const gridTirados = el('historicoTiradosGrid');
  if (gridTirados) gridTirados.innerHTML = tirados.map(filaTiradoHtml).join('');
  mostrar('historicoTiradosBloque', tirados.length > 0);
}

// -----------------------------------------------------------------------------
// Carga
// -----------------------------------------------------------------------------

async function traerHistorico(): Promise<RespuestaHistorico> {
  const res = await fetch(`${API_BASE_URL}/objetos/historico/`, {
    headers: getAuthHeaders(),
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sesión expirada.');
  }
  if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
  return res.json();
}

/** Recarga la sección «📜 Histórico» (también disparada por otras islas). */
async function refrescarHistorico(): Promise<void> {
  if (cargando) return;
  cargando = true;
  mostrar('historicoLoading', true);
  mostrar('historicoError', false);
  try {
    datos = await traerHistorico();
    render();
  } catch (error) {
    datos = null;
    render();
    // El error y el «sin datos» son estados EXCLUYENTES.
    mostrar('historicoVacio', false);
    const detalle = el('historicoError');
    if (detalle) {
      detalle.textContent = error instanceof Error
        ? `⚠️ No se pudo cargar el histórico: ${error.message}`
        : '⚠️ No se pudo cargar el histórico.';
    }
    mostrar('historicoError', true);
  } finally {
    cargando = false;
    mostrar('historicoLoading', false);
  }
}

// -----------------------------------------------------------------------------
// Arranque (idempotente)
// -----------------------------------------------------------------------------

/** Inicializa la sección «📜 Histórico: Objetos Vendidos y Tirados». */
export function iniciarHistoricoDecisiones(): void {
  const host = el('seccionHistorico');
  if (!host || host.dataset.activo === 'true') return;
  host.dataset.activo = 'true';

  el('btnRefrescarHistorico')?.addEventListener('click', () => void refrescarHistorico());
  // CIERRE DEL CICLO: «Marcar como Vendido» / «Marcar como Tirado/Donado» y el
  // descarte físico confirmado emiten estos eventos; el objeto aparece acá al
  // instante, sin esperar a que el usuario refresque la página.
  window.addEventListener(EVENTO_DECISION_CAMBIADA, () => void refrescarHistorico());
  window.addEventListener(EVENTO_CAMBIO_DESCARTE, () => void refrescarHistorico());

  void refrescarHistorico();
}

