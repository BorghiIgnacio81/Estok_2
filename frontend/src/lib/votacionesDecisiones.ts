// =============================================================================
// VOTACIONES PENDIENTES DEL ESTOK (pestaña "Decisiones")
// -----------------------------------------------------------------------------
// Lista las votaciones que el backend abrió automáticamente al detectar un
// objeto con DUEÑO ORIGINAL y SIN BENEFICIARIO (ver
// inventario/services/decisiones_service.py) y permite votar en ellas.
//
// Regla democrática: 1 usuario = 1 voto (volver a votar lo actualiza). Cuando
// votó TODO el padrón del Estok y hay ganador claro, el backend resuelve la
// votación y aplica el resultado al objeto (beneficiario u owner_action).
//
// Endpoints (inventario/api/viewsets/decisiones.py):
//   GET  /api/decisiones/pendientes/
//   POST /api/decisiones/{id}/votar/   { opcion, beneficiario, comentario }
//
// Auth 100% centralizada: getAuthHeaders() (JWT + X-Estok-Id). Sin duplicar.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';

// =============================================================================
// TIPOS
// =============================================================================

interface VotoResumen {
  usuario: string;
  usuario_nombre: string | null;
  opcion: string;
  opcion_label: string;
  /** ID del beneficiario propuesto (solo con la opción 'asignar_beneficiario'). */
  beneficiario: string | null;
  beneficiario_nombre: string | null;
}

interface Votacion {
  id: string;
  estado: string;
  motivo_label: string;
  objeto_id: string | null;
  objeto_nombre: string | null;
  objeto_dueno: string | null;
  objeto_beneficiario: string | null;
  conteo: Record<string, number>;
  total_votos: number;
  total_votantes: number;
  votos_faltantes: number;
  opcion_ganadora: string | null;
  votos: VotoResumen[];
  mi_voto: VotoResumen | null;
  created_at: string | null;
}

interface UsuarioEstok {
  id: string;
  username: string;
  full_name?: string | null;
  email?: string | null;
}

const OPCIONES: Array<{ valor: string; etiqueta: string; icono: string }> = [
  { valor: 'asignar_beneficiario', etiqueta: 'Asignar beneficiario', icono: '👤' },
  { valor: 'vender', etiqueta: 'Vender', icono: '💰' },
  { valor: 'conservar', etiqueta: 'Conservar', icono: '📦' },
  { valor: 'tirar', etiqueta: 'Tirar', icono: '🗑️' },
];

/** Estado en memoria de la pestaña (una votación abierta por vez por tarjeta). */
interface EstadoVotaciones {
  votaciones: Votacion[];
  usuarios: UsuarioEstok[];
  seleccion: Record<string, { opcion: string; beneficiario: string }>;
  cargando: boolean;
  error: string | null;
}

const estado: EstadoVotaciones = {
  votaciones: [],
  usuarios: [],
  seleccion: {},
  cargando: true,
  error: null,
};

// =============================================================================
// HELPERS
// =============================================================================

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function escapar(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nombreUsuario(usuario: UsuarioEstok): string {
  return usuario.full_name || usuario.username || usuario.email || 'Usuario';
}

async function pedir<T>(ruta: string): Promise<T> {
  const respuesta = await fetch(`${API_BASE_URL}${ruta}`, { headers: getAuthHeaders() });
  if (!respuesta.ok) throw new Error(`Error ${respuesta.status} al consultar ${ruta}`);
  return (await respuesta.json()) as T;
}

// =============================================================================
// CARGA
// =============================================================================

async function cargarDatos(): Promise<void> {
  estado.cargando = true;
  estado.error = null;
  try {
    const [pendientes, usuarios] = await Promise.all([
      pedir<{ results: Votacion[] }>('/decisiones/pendientes/'),
      pedir<{ results?: UsuarioEstok[] } | UsuarioEstok[]>('/usuarios/'),
    ]);

    estado.votaciones = pendientes.results || [];
    estado.usuarios = Array.isArray(usuarios) ? usuarios : usuarios.results || [];

    // Preselección: el voto propio ya emitido o la opción por defecto.
    estado.votaciones.forEach((votacion) => {
      estado.seleccion[votacion.id] = {
        opcion: votacion.mi_voto?.opcion || 'asignar_beneficiario',
        beneficiario: votacion.mi_voto?.beneficiario || '',
      };
    });
  } catch (err) {
    estado.error = err instanceof Error ? err.message : 'No se pudieron cargar las votaciones.';
    estado.votaciones = [];
  } finally {
    estado.cargando = false;
  }
}


// =============================================================================
// RENDER
// =============================================================================

function barraConteoHtml(votacion: Votacion): string {
  return OPCIONES.map((opcion) => {
    const votos = votacion.conteo[opcion.valor] || 0;
    const gana = votacion.opcion_ganadora === opcion.valor;
    return `
      <div class="flex items-center justify-between gap-2 text-xs ${
        gana ? 'font-semibold text-orange-700' : 'text-gray-600'
      }">
        <span>${opcion.icono} ${escapar(opcion.etiqueta)}</span>
        <span>${votos}</span>
      </div>`;
  }).join('');
}

function panelVotoHtml(votacion: Votacion): string {
  const seleccion = estado.seleccion[votacion.id] || { opcion: '', beneficiario: '' };
  const opciones = OPCIONES.map(
    (opcion) => `
      <button type="button" data-voto-opcion="${opcion.valor}" data-votacion="${votacion.id}"
        class="px-2.5 py-1.5 text-xs font-medium rounded-lg border-2 transition-base ${
          seleccion.opcion === opcion.valor
            ? 'border-orange-500 bg-orange-50 text-orange-800'
            : 'border-gray-200 bg-white text-gray-600 hover:border-orange-300'
        }">
        ${opcion.icono} ${escapar(opcion.etiqueta)}
      </button>`,
  ).join('');

  const beneficiarios = estado.usuarios
    .map((usuario) => {
      const elegido = seleccion.beneficiario === usuario.id ? ' selected' : '';
      return `<option value="${escapar(usuario.id)}"${elegido}>${escapar(nombreUsuario(usuario))}</option>`;
    })
    .join('');

  const mostrarBeneficiario = seleccion.opcion === 'asignar_beneficiario';

  return `
    <div class="mt-3 pt-3 border-t border-gray-100">
      <p class="text-xs font-semibold text-gray-500 mb-2">
        ${
          votacion.mi_voto
            ? `Tu voto actual: ${escapar(votacion.mi_voto.opcion_label)}`
            : 'Tu voto está pendiente'
        }
      </p>
      <div class="flex flex-wrap gap-2">${opciones}</div>
      <div class="mt-2 flex flex-col sm:flex-row gap-2"
        ${mostrarBeneficiario ? '' : 'hidden'}>
        <select data-voto-beneficiario="${votacion.id}"
          class="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-orange-400">
          <option value="">Elegir beneficiario...</option>
          ${beneficiarios}
        </select>
      </div>
      <button type="button" data-voto-enviar="${votacion.id}"
        class="mt-3 w-full sm:w-auto px-4 py-2 text-sm font-semibold text-white bg-orange-600 rounded-lg hover:bg-orange-700 transition-base">
        🗳️ Emitir mi voto
      </button>
      <p data-voto-aviso="${votacion.id}" class="mt-2 text-xs hidden"></p>
    </div>`;
}

function tarjetaHtml(votacion: Votacion): string {
  const progreso = `${votacion.total_votos}/${votacion.total_votantes || '?'}`;
  return `
    <article class="bg-white rounded-xl shadow-sm border border-gray-200 p-4" data-votacion-card="${votacion.id}">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="font-semibold text-gray-900 truncate">${escapar(votacion.objeto_nombre || 'Objeto sin nombre')}</h3>
          <p class="text-xs text-gray-500 mt-0.5">
            Dueño: ${escapar(votacion.objeto_dueno || '—')} · ${escapar(votacion.motivo_label)}
          </p>
        </div>
        <span class="shrink-0 px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold">
          🗳️ ${progreso} votos
        </span>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">${barraConteoHtml(votacion)}</div>
      <p class="mt-2 text-[11px] text-gray-500">
        ${
          votacion.votos_faltantes > 0
            ? `Faltan ${votacion.votos_faltantes} voto(s) para resolver la decisión.`
            : 'Votó todo el Estok: se resuelve al desempatar.'
        }
      </p>
      ${panelVotoHtml(votacion)}
    </article>`;
}

function render(): void {
  const host = el('votacionesPendientes');
  const contador = el('votacionesCount');
  if (!host) return;

  if (contador) {
    contador.textContent = String(estado.votaciones.length);
    contador.classList.toggle('hidden', estado.votaciones.length === 0);
  }

  if (estado.cargando) {
    host.innerHTML = '<p class="text-sm text-gray-400 py-3">Cargando votaciones pendientes…</p>';
    return;
  }
  if (estado.error) {
    host.innerHTML = `<p class="text-sm text-red-600 py-3">⚠️ ${escapar(estado.error)}</p>`;
    return;
  }
  if (!estado.votaciones.length) {
    host.innerHTML = `
      <p class="text-sm text-gray-500 py-3">
        No hay votaciones pendientes. Se abren automáticamente cuando un objeto queda
        con Dueño original y sin Beneficiario.
      </p>`;
    return;
  }
  host.innerHTML = estado.votaciones.map(tarjetaHtml).join('');
}


// =============================================================================
// INTERACCIÓN
// =============================================================================

function aplicarSeleccion(evento: Event): boolean {
  const objetivo = evento.target as HTMLElement | null;
  const botonOpcion = objetivo?.closest<HTMLElement>('[data-voto-opcion]');
  if (botonOpcion) {
    const votacionId = botonOpcion.dataset.votacion || '';
    const opcion = botonOpcion.dataset.votoOpcion || '';
    estado.seleccion[votacionId] = {
      opcion,
      beneficiario: estado.seleccion[votacionId]?.beneficiario || '',
    };
    render();
    return true;
  }

  const selector = objetivo?.closest<HTMLSelectElement>('[data-voto-beneficiario]');
  if (selector) {
    // El <select> nativo del navegador muta su valor sin re-render: se guarda
    // para que el envío use la elección real.
    const votacionId = selector.dataset.votoBeneficiario || '';
    estado.seleccion[votacionId] = {
      opcion: estado.seleccion[votacionId]?.opcion || 'asignar_beneficiario',
      beneficiario: selector.value,
    };
    return true;
  }

  return false;
}

function mostrarAviso(votacionId: string, mensaje: string, exito: boolean): void {
  const aviso = document.querySelector<HTMLElement>(`[data-voto-aviso="${votacionId}"]`);
  if (!aviso) return;
  aviso.textContent = mensaje;
  aviso.className = `mt-2 text-xs ${exito ? 'text-green-700' : 'text-amber-700'}`;
}

async function enviarVoto(votacionId: string): Promise<void> {
  const seleccion = estado.seleccion[votacionId] || { opcion: '', beneficiario: '' };
  if (!seleccion.opcion) {
    mostrarAviso(votacionId, 'Elegí una opción antes de votar.', false);
    return;
  }
  if (seleccion.opcion === 'asignar_beneficiario' && !seleccion.beneficiario) {
    mostrarAviso(votacionId, 'Elegí el beneficiario que proponés.', false);
    return;
  }

  const boton = document.querySelector<HTMLButtonElement>(`[data-voto-enviar="${votacionId}"]`);
  if (boton) boton.disabled = true;

  try {
    const respuesta = await fetch(`${API_BASE_URL}/decisiones/${votacionId}/votar/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        opcion: seleccion.opcion,
        beneficiario: seleccion.beneficiario || null,
      }),
    });

    const data = (await respuesta.json().catch(() => ({}))) as { mensaje?: string; error?: string };
    if (!respuesta.ok) {
      throw new Error(data.error || `Error ${respuesta.status} al registrar el voto.`);
    }

    await cargarDatos();
    render();

    const esAviso = Boolean(data.mensaje && !data.mensaje.toLowerCase().includes('registrado'));
    const aviso = document.querySelector<HTMLElement>(`[data-voto-aviso="${votacionId}"]`);
    if (aviso) {
      aviso.textContent = data.mensaje || 'Voto registrado.';
      aviso.className = `mt-2 text-xs ${esAviso ? 'text-amber-700' : 'text-green-700'}`;
    } else {
      // La tarjeta se re-renderizó (votación resuelta): se avisa arriba.
      const host = el('votacionesPendientes');
      host?.insertAdjacentHTML(
        'afterbegin',
        `<p class="mb-3 text-sm ${esAviso ? 'text-amber-700' : 'text-green-700'}">${
          esAviso ? '⚠️' : '✅'
        } ${escapar(data.mensaje || 'Voto registrado.')}</p>`,
      );
    }
  } catch (err) {
    mostrarAviso(votacionId, err instanceof Error ? err.message : 'No se pudo votar.', false);
  } finally {
    const btn = document.querySelector<HTMLButtonElement>(`[data-voto-enviar="${votacionId}"]`);
    if (btn) btn.disabled = false;
  }
}

// =============================================================================
// API PÚBLICA
// =============================================================================

/** Inicializa el panel de votaciones pendientes (idempotente). */
export function iniciarVotacionesPendientes(): void {
  const host = el('votacionesPendientes');
  if (!host || host.dataset.activo === 'true') return;
  host.dataset.activo = 'true';

  host.addEventListener('click', (evento) => {
    if (aplicarSeleccion(evento)) return;
    const objetivo = evento.target as HTMLElement | null;
    const enviar = objetivo?.closest<HTMLElement>('[data-voto-enviar]');
    if (!enviar) return;
    const votacionId = enviar.dataset.votoEnviar || '';
    if (votacionId) void enviarVoto(votacionId);
  });

  host.addEventListener('change', (evento) => {
    aplicarSeleccion(evento);
  });

  void cargarDatos().then(render);
}

/** Recarga las votaciones (por ejemplo tras crear un objeto con votación). */
export async function refrescarVotacionesPendientes(): Promise<void> {
  await cargarDatos();
  render();
}

