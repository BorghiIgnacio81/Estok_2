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
// Cómo se fija la decisión en el backend (regla de PROPIEDAD del objeto):
//   - 💰 Vender / 📦 Conservar / 🗑️ Tirar / Donar (Caso A · el objeto es del
//     usuario): los 3 botones individuales se persisten con
//     POST /api/objetos/{id}/tomar_decision/ (blindado: 403 si el objeto es de
//     otro usuario). Tirar sigue abriendo el período de gracia
//     (lib/descarteModales.ts → POST /api/objetos/{id}/ordenar_descarte/).
//   - 🗳️ Iniciar votación (Caso B · objeto SIN propietario): no hay a quién
//     pertenecer la decisión, así que se PROPONE al grupo familiar con
//     POST /api/objetos/{id}/iniciar_votacion/ y el objeto pasa a «Votaciones
//     pendientes del Estok».
//   - 📩 Avisar al propietario (Caso C · objeto de OTRO usuario): no se puede
//     decidir por él; se envía el aviso interno (lib/notificacionDueno.ts).
// Qué botón corresponde lo decide lib/decisionesPropiedad.ts (fuente ÚNICA).
//
// Datos: GET /api/objetos/pendientes_decision/ (DecisionesActionsMixin), que ya
// excluye los objetos en votación: esos se resuelven votando en "Votaciones
// pendientes del Estok" (components/VotacionesPendientes.astro).
// Auth centralizada: getAuthHeaders (JWT + X-Estok-Id del tenant activo).
// =============================================================================

import { getAuthHeaders, API_BASE_URL, normalizarUrlApi } from '../services/auth';
import { cargarContextoRutaCaja } from './rutaCajaMinimapas';
import { initRutaGeograficaDespliegue } from './rutaGeograficaDespliegue';
import { abrirPublicarObjeto } from './publicarObjeto';
import { tarjetaObjetoHtml } from './decisionesTarjeta';
import type { ObjetoDecision } from './decisionesTarjeta';
// MARKUP Y ESTADO DE LA TARJETA (botonera de los 3 casos de propiedad).
import {
  bloquearBotones,
  botoneraHtml,
  marcarTarjetaDecidida,
} from './decisionesBotonera';
import { solicitarDescarte } from './descarteModales';
import { esErrorPermisoAjeno, ofrecerNotificarDueno } from './notificacionDueno';
// Aviso "en caliente" para que la sección destacada de venta y el tablero de
// decisiones tomadas se recarguen sin esperar a un refresh manual.
import { notificarDecisionCambiada } from './eventosDecisiones';
// Lote 31 · punto 1: los objetos todavía SIN decisión se leen arriba; los ya
// decididos (si el endpoint devolviera alguno) caen al fondo de la grilla.
import { ordenarPendientesDecision } from './decisionesOrden';

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
    estado.objetos = ordenarPendientesDecision(
      await fetchTodos(`${API_BASE_URL}/objetos/pendientes_decision/?page_size=1000`),
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
 * Fija la decisión INDIVIDUAL del propietario (Caso A).
 *
 * Endpoint ÚNICO y blindado: POST /api/objetos/{id}/tomar_decision/. El backend
 * responde 403 si el objeto tiene dueño y no es el usuario autenticado
 * («No tienes permisos para decidir sobre un objeto propiedad de otro
 * usuario») y 202 cuando el dueño es externo/fallecido (la decisión se deriva
 * a la votación del Estok).
 */
async function guardarDecision(obj: ObjetoPendiente, accion: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/objetos/${obj.id}/tomar_decision/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ action: accion }),
  });

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sesión expirada.');
  }
  if (res.status === 202) {
    // Dueño externo/fallecido: la decisión NO se aplica en el acto; el objeto
    // pasó a la VOTACIÓN del inquilinato (período FOMO).
    const data = await res.json().catch(() => ({}));
    throw new Error(
      data.mensaje
        || 'La decisión quedó derivada a la votación del inquilinato.',
    );
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      data.error || data.detail || `Error ${res.status} al fijar la decisión.`,
    );
  }
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
    // La decisión ya está persistida: refresca la sección destacada de venta
    // (objetos marcados para vender) y los bloques de decisiones tomadas.
    notificarDecisionCambiada();

    if (accion === 'vender') {
      mostrarAviso(`💰 "${obj.nombre}" marcado para vender. Revisá la vista previa de publicación.`);
      // Despliega el bloque de previsualización (ML / Facebook Marketplace).
      abrirPublicarObjeto({ id: obj.id, nombre: obj.nombre, valor: obj.valor_estimado });
    } else {
      mostrarAviso(`📦 "${obj.nombre}" se conserva en el Estok.`);
    }
  } catch (err) {
    bloquearBotones(obj.id, false);
    const mensaje = err instanceof Error
      ? err.message
      : 'No se pudo fijar la decisión.';

    // 403 patrimonial: el objeto pertenece a OTRO usuario del sistema. En vez de
    // un error seco, se ofrece avisarle (puente del 403). La tarjeta queda
    // intacta (estado anterior).
    if (esErrorPermisoAjeno(mensaje)) {
      ofrecerNotificarDueno(obj.id, obj.nombre);
      return;
    }

    mostrarAviso(mensaje, false);
  }
}

// -----------------------------------------------------------------------------
// Caso B · Iniciar votación (objeto SIN propietario asignado)
// -----------------------------------------------------------------------------

/**
 * Propone la decisión COMPARTIDA al grupo familiar.
 *
 * El objeto sin dueño no admite decisión individual: el Estok vota. Al abrirse
 * la votación el objeto sale de esta grilla (el backend lo excluye de
 * `pendientes_decision`) y aparece en «Votaciones pendientes del Estok».
 */
async function iniciarVotacion(obj: ObjetoPendiente): Promise<void> {
  const boton = document.querySelector<HTMLButtonElement>(
    `[data-iniciar-votacion="${obj.id}"]`,
  );
  if (boton) boton.disabled = true;

  try {
    const res = await fetch(`${API_BASE_URL}/objetos/${obj.id}/iniciar_votacion/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    });

    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.detail || `Error ${res.status} al abrir la votación.`);
    }

    const data = await res.json().catch(() => ({}));
    mostrarAviso(
      data.mensaje || `🗳️ Se abrió la votación de "${obj.nombre}" para todo el Estok.`,
    );
    // El panel de votaciones (arriba) se recarga con el aviso en caliente.
    notificarDecisionCambiada();
    await tirarTarjeta(obj);
  } catch (err) {
    if (boton) boton.disabled = false;
    mostrarAviso(
      err instanceof Error ? err.message : 'No se pudo iniciar la votación.',
      false,
    );
  }
}

// -----------------------------------------------------------------------------
// Caso C · Avisar al propietario (objeto de OTRO usuario)
// -----------------------------------------------------------------------------

/** Abre el modal de confirmación del aviso interno al propietario. */
function avisarPropietario(obj: ObjetoPendiente): void {
  ofrecerNotificarDueno(obj.id, obj.nombre);
}

function onClickTarjeta(evento: Event): void {
  const objetivo = evento.target as HTMLElement | null;

  const publicar = objetivo?.closest<HTMLElement>('[data-publicar]');
  if (publicar) {
    const obj = estado.objetos.find((o) => o.id === publicar.dataset.publicar);
    if (obj) abrirPublicarObjeto({ id: obj.id, nombre: obj.nombre, valor: obj.valor_estimado });
    return;
  }

  // Caso B · «Iniciar votación»
  const votacion = objetivo?.closest<HTMLElement>('[data-iniciar-votacion]');
  if (votacion) {
    const obj = estado.objetos.find((o) => o.id === votacion.dataset.iniciarVotacion);
    if (obj) void iniciarVotacion(obj);
    return;
  }

  // Caso C · «Avisar al propietario»
  const avisar = objetivo?.closest<HTMLElement>('[data-avisar-propietario]');
  if (avisar) {
    const obj = estado.objetos.find((o) => o.id === avisar.dataset.avisarPropietario);
    if (obj) avisarPropietario(obj);
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

  // Delegación de clic de la ruta jerárquica interactiva (texto → minimapas).
  initRutaGeograficaDespliegue();

  host.addEventListener('click', onClickTarjeta);
  el('btnRefrescarPendientes')?.addEventListener('click', () => void cargar());
  // Botón "Reintentar" del estado de error (components/ErrorState.astro).
  el('retryBtn')?.addEventListener('click', () => void cargar());

  void cargar();
}
