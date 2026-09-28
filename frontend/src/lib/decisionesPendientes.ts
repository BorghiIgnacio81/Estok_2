// =============================================================================
// BLOQUE 1 · OBJETOS PENDIENTES DE DECISIÓN (pestaña "Decisiones" del Estok)
// -----------------------------------------------------------------------------
// Grilla simétrica con los objetos del Estok activo que TODAVÍA no tienen
// decisión (`owner_action` nulo) y NO están en votación democrática: cada
// tarjeta muestra foto, título, ubicación actual (mini-guía analítica del mismo
// motor que alimenta el componente global components/MinimapaRuta.astro) y la
// botonera in-place 💰 Vender / 📦 Conservar / 🗑️ Tirar.
//
// El markup de la tarjeta NO se define acá: vive en lib/decisionesTarjeta.ts y
// lo comparten todos los bloques de la pestaña.
//
// Cómo se fija la decisión en el backend:
//   - 💰 Vender / 📦 Conservar:
//       · `es_decision_propia` (el usuario es el dueño original o el
//         beneficiario) → POST /api/objetos/{id}/owner_action/ {action}
//       · cualquier otro miembro con permiso de edición → PUT del objeto
//   - 🗑️ Tirar: POST /api/objetos/{id}/ordenar_descarte/ (lib/descarteModales.ts),
//     que abre el período de gracia obligatorio cuando el Estok tiene más de un
//     usuario activo. El objeto pasa al Bloque 4 (lib/decisionesGrupos.ts).
//
// Datos: GET /api/objetos/pendientes_decision/ (DecisionesActionsMixin), que ya
// excluye los objetos en votación: esos se resuelven votando en "Votaciones
// pendientes del Estok" (components/VotacionesPendientes.astro).
// Auth centralizada: getAuthHeaders (JWT + X-Estok-Id del tenant activo).
// =============================================================================

import { getAuthHeaders, API_BASE_URL, normalizarUrlApi } from '../services/auth';
import { cargarContextoRutaCaja } from './rutaCajaMinimapas';
import { abrirPublicarObjeto } from './publicarObjeto';
import { tarjetaObjetoHtml } from './decisionesTarjeta';
import type { ObjetoDecision } from './decisionesTarjeta';
import { solicitarDescarte } from './descarteModales';

// -----------------------------------------------------------------------------
// Tipos
// -----------------------------------------------------------------------------

/** Objeto pendiente de decisión (mismo payload del tablero de Decisiones). */
export type ObjetoPendiente = ObjetoDecision;

interface EstadoPendientes {
  objetos: ObjetoPendiente[];
  cargando: boolean;
  error: string | null;
}

const estado: EstadoPendientes = { objetos: [], cargando: true, error: null };

// -----------------------------------------------------------------------------
// Helpers puros
// -----------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Paginación robusta reutilizando la normalización anti Mixed Content. */
async function fetchTodos(url: string): Promise<ObjetoPendiente[]> {
  const todos: ObjetoPendiente[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return todos;
    }
    if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
    const data = await res.json();
    todos.push(...(data.results || data));
    nextUrl = normalizarUrlApi(data.next);
  }
  return todos;
}

// -----------------------------------------------------------------------------
// Carga
// -----------------------------------------------------------------------------

async function cargar(): Promise<void> {
  estado.cargando = true;
  estado.error = null;
  render();
  try {
    estado.objetos = await fetchTodos(
      `${API_BASE_URL}/objetos/pendientes_decision/?page_size=1000`,
    );
    // Contexto geográfico (ubicaciones + contenedores + grilla del Estok) que
    // alimenta la mini-guía analítica de cada tarjeta. Idempotente.
    await cargarContextoRutaCaja();
  } catch (err) {
    estado.objetos = [];
    estado.error = err instanceof Error
      ? err.message
      : 'No se pudieron cargar los objetos pendientes.';
  } finally {
    estado.cargando = false;
    render();
  }
}

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

/** Botonera in-place de una tarjeta sin decidir (3 acciones de ESTOK). */
function botoneraHtml(obj: ObjetoPendiente): string {
  const boton = (accion: string, etiqueta: string, icono: string, clase: string): string => `
    <button type="button" data-objeto-id="${obj.id}" data-decision="${accion}" title="${etiqueta}"
      class="flex-1 inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white rounded-lg shadow-sm transition-base disabled:opacity-40 disabled:cursor-not-allowed ${clase}">
      <span aria-hidden="true">${icono}</span>${etiqueta}
    </button>`;

  return `
    <div class="mt-auto flex items-stretch gap-1.5" data-botones-decision>
      ${boton('vender', 'Vender', '💰', 'bg-green-600 hover:bg-green-700')}
      ${boton('conservar', 'Conservar', '📦', 'bg-blue-600 hover:bg-blue-700')}
      ${boton('tirar', 'Tirar', '🗑️', 'bg-red-600 hover:bg-red-700')}
    </div>`;
}

/** Veredicto que reemplaza la botonera una vez fijada la decisión. */
function decididoHtml(obj: ObjetoPendiente, accion: string): string {
  if (accion === 'vender') {
    const publicadoML = obj.plataformas_publicadas.includes('mercadolibre');
    return `
      <div class="mt-auto flex flex-col gap-1.5" data-botones-decision>
        <span class="inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-green-100 text-green-800 text-xs font-bold">
          💰 Para vender
        </span>
        <button type="button" data-publicar="${obj.id}"
          class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-base">
          📢 ${publicadoML ? 'Ver / republicar anuncio' : 'Publicar en ML o Facebook'}
        </button>
      </div>`;
  }
  return `
    <div class="mt-auto flex flex-col gap-1.5" data-botones-decision>
      <span class="inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-blue-100 text-blue-800 text-xs font-bold">
        📦 Se conserva en el Estok
      </span>
    </div>`;
}

function tarjetaHtml(obj: ObjetoPendiente): string {
  return tarjetaObjetoHtml(obj, {
    acciones: botoneraHtml(obj),
    atributos: 'data-bloque="pendientes"',
  });
}

function actualizarContador(): void {
  const contador = el('pendientesCount');
  if (!contador) return;
  contador.textContent = String(estado.objetos.length);
  contador.classList.toggle('hidden', estado.objetos.length === 0);
}

function render(): void {
  const host = el('pendientesGrid');
  if (!host) return;

  const visibles = estado.objetos.length;
  const ocupado = estado.cargando || Boolean(estado.error);

  el('loadingState')?.classList.toggle('hidden', !estado.cargando);
  el('errorState')?.classList.toggle('hidden', !estado.error);
  el('emptyState')?.classList.toggle('hidden', ocupado || visibles > 0);
  host.classList.toggle('hidden', ocupado || visibles === 0);

  const mensajeError = el('errorMessage');
  if (mensajeError && estado.error) mensajeError.textContent = estado.error;

  actualizarContador();

  if (ocupado) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = estado.objetos.map(tarjetaHtml).join('');
}

function mostrarAviso(mensaje: string, exito = true): void {
  const host = el('pendientesAviso');
  if (!host) return;
  host.classList.remove('hidden');
  host.className = `mb-3 px-4 py-2 rounded-lg text-sm ${
    exito ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
  }`;
  host.textContent = mensaje;
}

// -----------------------------------------------------------------------------
// Acciones in-place (💰 Vender / 📦 Conservar / 🗑️ Tirar)
// -----------------------------------------------------------------------------

/**
 * Fija la decisión en PostgreSQL. Si el objeto espera a ESTE usuario (dueño
 * original o beneficiario) se usa el endpoint dedicado `owner_action`, que es
 * el que aplica la regla de negocio "solo el dueño original decide"; en
 * cualquier otro caso se fija por el CRUD (PUT del objeto con `owner_action`).
 */
async function guardarDecision(obj: ObjetoPendiente, accion: string): Promise<void> {
  const url = obj.es_decision_propia
    ? `${API_BASE_URL}/objetos/${obj.id}/owner_action/`
    : `${API_BASE_URL}/objetos/${obj.id}/`;

  const res = await fetch(url, {
    method: obj.es_decision_propia ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(
      obj.es_decision_propia ? { action: accion } : { owner_action: accion },
    ),
  });

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sesión expirada.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      data.error || data.detail || `Error ${res.status} al fijar la decisión.`,
    );
  }
}

function bloquearBotones(id: string, bloquear: boolean): void {
  document
    .querySelectorAll<HTMLButtonElement>(`[data-objeto-card="${id}"] [data-decision]`)
    .forEach((boton) => {
      boton.disabled = bloquear;
    });
}

/** Reemplaza la botonera por el veredicto y resalta la tarjeta. */
function marcarTarjetaDecidida(obj: ObjetoPendiente, accion: string): void {
  const card = document.querySelector<HTMLElement>(`[data-objeto-card="${obj.id}"]`);
  if (!card) return;
  card.dataset.decisionTomada = accion;
  card.classList.add('ring-2', 'ring-green-400');
  const botones = card.querySelector('[data-botones-decision]');
  if (botones) botones.outerHTML = decididoHtml(obj, accion);
}

/** Remueve la tarjeta con una animación suave y la quita del estado. */
async function tirarTarjeta(obj: ObjetoPendiente): Promise<void> {
  const card = document.querySelector<HTMLElement>(`[data-objeto-card="${obj.id}"]`);
  estado.objetos = estado.objetos.filter((o) => o.id !== obj.id);
  actualizarContador();
  if (!card) return;
  card.classList.add('decision-card-saliendo');
  await new Promise((resolver) => {
    window.setTimeout(resolver, 320);
  });
  card.remove();
}

async function decidir(obj: ObjetoPendiente, accion: string): Promise<void> {
  bloquearBotones(obj.id, true);

  // 🗑️ Tirar: no se fija como las otras decisiones. Si el Estok tiene más de un
  // usuario activo se abre el selector OBLIGATORIO de tiempo de gracia
  // (lib/descarteModales.ts) y el objeto pasa al Bloque 4 con su plazo de
  // reclamo; si no, el descarte queda listo para la ejecución física.
  if (accion === 'tirar') {
    await solicitarDescarte(
      { id: obj.id, nombre: obj.nombre },
      {
        alConfirmar: async (mensaje) => {
          await tirarTarjeta(obj);
          mostrarAviso(mensaje);
        },
        alAbortar: (mensaje) => {
          bloquearBotones(obj.id, false);
          if (mensaje) mostrarAviso(mensaje, false);
        },
      },
    );
    return;
  }

  try {
    await guardarDecision(obj, accion);
    marcarTarjetaDecidida(obj, accion);

    if (accion === 'vender') {
      mostrarAviso(`💰 "${obj.nombre}" marcado para vender. Revisá la vista previa de publicación.`);
      // Despliega el bloque de previsualización (ML / Facebook Marketplace).
      abrirPublicarObjeto({ id: obj.id, nombre: obj.nombre, valor: obj.valor_estimado });
    } else {
      mostrarAviso(`📦 "${obj.nombre}" se conserva en el Estok.`);
    }
  } catch (err) {
    bloquearBotones(obj.id, false);
    mostrarAviso(
      err instanceof Error ? err.message : 'No se pudo fijar la decisión.',
      false,
    );
  }
}

function onClickTarjeta(evento: Event): void {
  const objetivo = evento.target as HTMLElement | null;

  const publicar = objetivo?.closest<HTMLElement>('[data-publicar]');
  if (publicar) {
    const obj = estado.objetos.find((o) => o.id === publicar.dataset.publicar);
    if (obj) abrirPublicarObjeto({ id: obj.id, nombre: obj.nombre, valor: obj.valor_estimado });
    return;
  }

  const boton = objetivo?.closest<HTMLElement>('[data-decision]');
  if (!boton) return;
  const obj = estado.objetos.find((o) => o.id === boton.dataset.objetoId);
  const accion = boton.dataset.decision || '';
  if (obj && accion) void decidir(obj, accion);
}

// -----------------------------------------------------------------------------
// API pública
// -----------------------------------------------------------------------------

/** Inicializa la grilla de objetos pendientes (idempotente). */
export function iniciarDecisionesPendientes(): void {
  const host = el('pendientesGrid');
  if (!host || host.dataset.activo === 'true') return;
  host.dataset.activo = 'true';

  host.addEventListener('click', onClickTarjeta);
  el('btnRefrescarPendientes')?.addEventListener('click', () => void cargar());
  // Botón "Reintentar" del estado de error (components/ErrorState.astro).
  el('retryBtn')?.addEventListener('click', () => void cargar());

  void cargar();
}
