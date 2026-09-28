// =============================================================================
// BLOQUES 3, 4 y 5 DEL TABLERO DE DECISIONES (objetos YA decididos)
// -----------------------------------------------------------------------------
// Endpoint único: GET /api/objetos/panel_decisiones/ (inventario/api/viewsets/
// objetos/decisiones_actions.py), que devuelve los objetos agrupados por bloque:
//
//   BLOQUE 3 · Vender  → arriba los SIN publicar (con el botón para armar el
//                        formulario de Mercado Libre) y abajo los YA PUBLICADOS
//                        (con su link 🔗 a la publicación).
//   BLOQUE 4 · Tirar   → en espera de la ejecución física o del fin del tiempo
//                        de reclamo (contador del período de gracia).
//   BLOQUE 5 · Conservar → lista de protección (incluye los reclamados "Mudar").
//
// El botón de confirmación del descarte físico y el de despacho de envíos
// vendidos solo se dibujan si el usuario logueado es Administrador Físico; el
// backend vuelve a validarlo en cada endpoint (403 si no corresponde).
// =============================================================================
import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { escapar, tarjetaObjetoHtml } from './decisionesTarjeta';
import type { ObjetoDecision } from './decisionesTarjeta';
import {
  EVENTO_CAMBIO_DESCARTE,
  actualizarDescartesEnGracia,
  cargarContextoDescarte,
  confirmarDescarteFinal,
  despacharEnvio,
  formatearRestante,
  milisegundosRestantes,
  notificarCambioDescarte,
  puedeAdministrarFisico,
} from './descarteGracia';
import type { TiempoGracia } from './descarteGracia';
import { abrirPublicarObjeto } from './publicarObjeto';
import { cargarContextoRutaCaja } from './rutaCajaMinimapas';

/** Respuesta completa del tablero de la pestaña Decisiones. */
interface PanelDecisiones {
  vender_sin_publicar: ObjetoDecision[];
  vender_publicados: ObjetoDecision[];
  tirar: ObjetoDecision[];
  conservar: ObjetoDecision[];
  en_mudanza: ObjetoDecision[];
  descartes_en_gracia: ObjetoDecision[];
  resumen: Record<string, number>;
  permisos: { puede_administrar_fisico: boolean };
  tiempos_gracia: TiempoGracia[];
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

// -----------------------------------------------------------------------------
// Carga del tablero
// -----------------------------------------------------------------------------

let cargando = false;

async function traerPanel(): Promise<PanelDecisiones> {
  const res = await fetch(`${API_BASE_URL}/objetos/panel_decisiones/`, {
    headers: getAuthHeaders(),
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sesión expirada.');
  }
  if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
  return res.json();
}

/** Recarga el tablero (Bloques 3, 4 y 5) y el Alerta Rojo del Bloque 2. */
export async function refrescarPanelDecisiones(): Promise<void> {
  if (cargando) return;
  cargando = true;
  try {
    const panel = await traerPanel();
    // El contexto de descarte define los permisos FÍSICOS (quién ve los botones
    // de confirmar descarte y despachar envío): se resuelve ANTES de renderizar
    // para no pintar los bloques sin las acciones del Administrador Físico.
    await cargarContextoDescarte();
    // La mini-guía analítica de cada tarjeta necesita el contexto geográfico del
    // Estok activo (mismo motor que MinimapaRuta.astro). Idempotente.
    await cargarContextoRutaCaja();
    renderPanel(panel);
    avisoPanel('');
  } catch (error) {
    mostrarEstado('panelDecisionesError', true);
    avisoPanel(
      error instanceof Error ? error.message : 'No se pudo cargar el tablero.',
      false,
    );
  } finally {
    cargando = false;
  }
}

function renderPanel(panel: PanelDecisiones): void {
  actualizarDescartesEnGracia(panel.descartes_en_gracia || []);
  objetosPanel = [
    ...(panel.vender_sin_publicar || []),
    ...(panel.vender_publicados || []),
    ...(panel.tirar || []),
    ...(panel.conservar || []),
    ...(panel.en_mudanza || []),
  ];

  renderVender(panel);
  renderTirar(panel);
  renderConservar(panel);

  const total = (panel.vender_sin_publicar?.length || 0)
    + (panel.vender_publicados?.length || 0)
    + (panel.tirar?.length || 0)
    + (panel.conservar?.length || 0)
    + (panel.en_mudanza?.length || 0);

  mostrarEstado('panelDecisionesError', false);
  el('seccionDecisionesTomadas')?.classList.toggle('hidden', total === 0);
  el('panelDecisionesCargando')?.classList.add('hidden');

  actualizarContador('venderCount', (panel.vender_sin_publicar?.length || 0)
    + (panel.vender_publicados?.length || 0));
  actualizarContador('tirarCount', panel.tirar?.length || 0);
  actualizarContador('conservarCount', (panel.conservar?.length || 0)
    + (panel.en_mudanza?.length || 0));
}

function actualizarContador(id: string, valor: number): void {
  const nodo = el(id);
  if (!nodo) return;
  nodo.textContent = String(valor);
  nodo.classList.toggle('hidden', valor === 0);
}

function mostrarEstado(id: string, visible: boolean): void {
  el(id)?.classList.toggle('hidden', !visible);
}

/** Aviso superior del tablero (éxito o error de las acciones). */
export function avisoPanel(mensaje: string, exito = true): void {
  const host = el('panelDecisionesAviso');
  if (!host) return;
  host.textContent = mensaje;
  host.className = `mb-3 px-4 py-2 rounded-lg text-sm ${
    exito ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
  }`;
  host.classList.toggle('hidden', !mensaje);
}

// -----------------------------------------------------------------------------
// BLOQUE 3 · Con decisión de Vender (sin publicar / ya publicados)
// -----------------------------------------------------------------------------

function renderVender(panel: PanelDecisiones): void {
  const sinPublicar = panel.vender_sin_publicar || [];
  const publicados = panel.vender_publicados || [];

  const gridSinPublicar = el('venderSinPublicarGrid');
  if (gridSinPublicar) gridSinPublicar.innerHTML = sinPublicar.map(cardVender).join('');
  const gridPublicados = el('venderPublicadosGrid');
  if (gridPublicados) gridPublicados.innerHTML = publicados.map(cardVender).join('');

  el('venderSinPublicarBloque')?.classList.toggle('hidden', sinPublicar.length === 0);
  el('venderPublicadosBloque')?.classList.toggle('hidden', publicados.length === 0);
}

function cardVender(obj: ObjetoDecision): string {
  const publicado = obj.plataformas_publicadas.length > 0;
  return tarjetaObjetoHtml(obj, {
    pie: pieDespachoHtml(obj),
    acciones: publicado ? accionesPublicadoHtml(obj) : accionesSinPublicarHtml(obj),
    atributos: 'data-grupo="vender"',
  });
}

/** Botón para armar el formulario de publicación (objeto decidido sin publicar). */
function accionesSinPublicarHtml(obj: ObjetoDecision): string {
  return `
    <div class="mt-auto flex flex-col gap-1.5">
      <span class="inline-flex items-center justify-center px-2 py-1 rounded-lg bg-green-100 text-green-800 text-xs font-bold">
        💰 Para vender · sin publicar
      </span>
      <button type="button" data-publicar="${escapar(obj.id)}"
        class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-base">
        📢 Armar formulario de Mercado Libre
      </button>
    </div>`;
}

/** Veredicto + link 🔗 de un objeto ya publicado (y despacho si corresponde). */
function accionesPublicadoHtml(obj: ObjetoDecision): string {
  const url = obj.url_publicacion || `/objetos/${obj.id}`;
  const externo = obj.url_publicacion ? ' target="_blank" rel="noopener"' : '';
  return `
    <div class="mt-auto flex flex-col gap-1.5">
      <span class="inline-flex items-center justify-center px-2 py-1 rounded-lg bg-green-100 text-green-800 text-xs font-bold">
        💰 Publicado para vender
      </span>
      <a href="${escapar(url)}"${externo}
        class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-base">
        🔗 Ver publicación
      </a>
      ${botonDespachoHtml(obj)}
    </div>`;
}

/**
 * Despacho del envío: solo visible para el Administrador Físico del Estok
 * (el backend responde 403 a cualquier otro usuario).
 */
function botonDespachoHtml(obj: ObjetoDecision): string {
  if (obj.despachado_en) {
    const por = obj.despachado_por_nombre ? ` por ${escapar(obj.despachado_por_nombre)}` : '';
    return `
      <span class="inline-flex items-center justify-center px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-semibold">
        📦 Envío despachado${por}
      </span>`;
  }
  if (!puedeAdministrarFisico()) return '';
  return `
    <button type="button" data-despachar-envio="${escapar(obj.id)}"
      class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white bg-slate-700 hover:bg-slate-800 rounded-lg shadow-sm transition-base">
      📦 Despachar envío (Admin. Físico)
    </button>`;
}

/** Chip de despacho en la tarjeta (pie) para los objetos vendidos. */
function pieDespachoHtml(obj: ObjetoDecision): string {
  if (!obj.despachado_en) return '';
  const por = obj.despachado_por_nombre ? ` · ${escapar(obj.despachado_por_nombre)}` : '';
  return `
    <div class="bg-slate-50 border border-slate-200 rounded-lg p-2 text-[11px] text-slate-600">
      📦 Despachado el ${new Date(obj.despachado_en).toLocaleDateString('es-AR')}${por}
    </div>`;
}

// -----------------------------------------------------------------------------
// BLOQUE 4 · Con decisión de Tirar
// -----------------------------------------------------------------------------

function renderTirar(panel: PanelDecisiones): void {
  const tirar = panel.tirar || [];
  const grid = el('tirarGrid');
  if (grid) grid.innerHTML = tirar.map(cardTirar).join('');
  el('tirarVacio')?.classList.toggle('hidden', tirar.length > 0);
}

function cardTirar(obj: ObjetoDecision): string {
  return tarjetaObjetoHtml(obj, {
    pie: pieDescarteHtml(obj),
    acciones: accionesDescarteHtml(obj),
    atributos: 'data-grupo="tirar"',
    extraClases: obj.en_periodo_gracia ? 'ring-1 ring-red-200' : '',
  });
}

/** Estado del descarte: período de reclamo vigente o plazo vencido. */
function pieDescarteHtml(obj: ObjetoDecision): string {
  if (obj.en_periodo_gracia) {
    const restante = formatearRestante(milisegundosRestantes(obj.fecha_limite_descarte));
    return `
      <div class="bg-red-50 border border-red-200 rounded-lg p-2 text-[11px] text-red-700 font-semibold">
        🚨 En período de reclamo · se tira en
        <span data-cuenta-descarte="${escapar(obj.id)}">${restante}</span>
      </div>`;
  }
  if (obj.descarte_listo_para_ejecutar) {
    return `
      <div class="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[11px] text-amber-800 font-semibold">
        ⏰ Plazo de reclamo vencido · listo para el descarte físico
      </div>`;
  }
  return '';
}

/** Confirmación del descarte FÍSICO: exclusiva del Administrador Físico. */
function accionesDescarteHtml(obj: ObjetoDecision): string {
  if (!puedeAdministrarFisico()) return '';
  if (!obj.descarte_listo_para_ejecutar) {
    return `
      <button type="button" disabled title="Se habilita cuando vence el período de reclamo"
        class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-gray-500 bg-gray-100 rounded-lg cursor-not-allowed">
        ⏳ Esperando el fin del reclamo
      </button>`;
  }
  return `
    <button type="button" data-confirmar-descarte="${escapar(obj.id)}"
      class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm transition-base">
      ✔️ Confirmar descarte físico
    </button>`;
}

// -----------------------------------------------------------------------------
// BLOQUE 5 · Con decisión de Conservar (lista de protección)
// -----------------------------------------------------------------------------

function renderConservar(panel: PanelDecisiones): void {
  const objetos = [...(panel.conservar || []), ...(panel.en_mudanza || [])];
  const grid = el('conservarGrid');
  if (grid) grid.innerHTML = objetos.map(cardConservar).join('');
  el('conservarVacio')?.classList.toggle('hidden', objetos.length > 0);
}

function cardConservar(obj: ObjetoDecision): string {
  const enMudanza = obj.owner_action === 'mudar';
  const pie = `
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-2 text-[11px] text-blue-800 font-semibold">
      ${enMudanza ? '🔁 Reclamado para mudanza (sale del descarte)' : '📦 Protegido en el Estok'}
    </div>`;
  return tarjetaObjetoHtml(obj, { pie, atributos: 'data-grupo="conservar"' });
}

// -----------------------------------------------------------------------------
// Acciones del tablero (click delegado)
// -----------------------------------------------------------------------------

let objetosPanel: ObjetoDecision[] = [];

function objetoDe(id: string | undefined): ObjetoDecision | undefined {
  return objetosPanel.find((objeto) => objeto.id === id);
}

/** Ejecuta una acción del Administrador Físico y refresca el tablero. */
async function ejecutarAccion(
  boton: HTMLButtonElement | null,
  accion: () => Promise<string>,
): Promise<void> {
  if (boton) boton.disabled = true;
  try {
    const mensaje = await accion();
    avisoPanel(mensaje, true);
    // Vuelve a cargar los bloques y el Alerta Rojo con el estado real.
    notificarCambioDescarte();
  } catch (error) {
    avisoPanel(
      error instanceof Error ? error.message : 'No se pudo completar la acción.',
      false,
    );
    if (boton) boton.disabled = false;
  }
}

async function onPanelClick(evento: Event): Promise<void> {
  const objetivo = evento.target as HTMLElement | null;

  const publicar = objetivo?.closest<HTMLElement>('[data-publicar]');
  if (publicar) {
    const objeto = objetoDe(publicar.dataset.publicar);
    if (objeto) {
      abrirPublicarObjeto({
        id: objeto.id,
        nombre: objeto.nombre,
        valor: objeto.valor_estimado,
      });
    }
    return;
  }

  const confirmar = objetivo?.closest<HTMLButtonElement>('[data-confirmar-descarte]');
  if (confirmar) {
    const objeto = objetoDe(confirmar.dataset.confirmarDescarte);
    if (!objeto) return;
    const aviso = window.confirm(
      `¿Confirmar el descarte FÍSICO definitivo de "${objeto.nombre}"? Se dará de baja del inventario.`,
    );
    if (!aviso) return;
    await ejecutarAccion(confirmar, () => confirmarDescarteFinal(objeto.id));
    return;
  }

  const despachar = objetivo?.closest<HTMLButtonElement>('[data-despachar-envio]');
  if (despachar) {
    const objeto = objetoDe(despachar.dataset.despacharEnvio);
    if (!objeto) return;
    await ejecutarAccion(despachar, () => despacharEnvio(objeto.id));
  }
}

// -----------------------------------------------------------------------------
// Arranque (idempotente)
// -----------------------------------------------------------------------------

/** Inicializa el tablero de decisiones tomadas (Bloques 3, 4 y 5). */
export function iniciarPanelDecisiones(): void {
  const host = el('panelDecisiones');
  if (!host || host.dataset.activo === 'true') return;
  host.dataset.activo = 'true';

  host.addEventListener('click', (evento) => void onPanelClick(evento));
  el('btnRefrescarPanel')?.addEventListener('click', () => void refrescarPanelDecisiones());
  // Cualquier cambio de descarte (reclamo, vencimiento, confirmación o despacho)
  // vuelve a traer los bloques desde el backend.
  window.addEventListener(EVENTO_CAMBIO_DESCARTE, () => void refrescarPanelDecisiones());

  void refrescarPanelDecisiones();
}
