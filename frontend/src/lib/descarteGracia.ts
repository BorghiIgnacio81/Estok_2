// =============================================================================
// PERÍODO DE GRACIA DEL DESCARTE + ALERTA ROJO (pestaña "Decisiones")
// -----------------------------------------------------------------------------
// Regla de negocio (inventario/services/descarte_service.py): cuando el Estok
// tiene MÁS DE UN usuario activo, tirar un objeto NO lo borra: abre un período
// de gracia (24 Horas / 3 Días / 1 Semana) durante el cual el objeto sigue
// visible en el Bloque 4 y cualquier miembro puede RECLAMARLO (Conservar /
// Mudar) desde el Alerta Rojo del Bloque 2, que muestra el contador regresivo
// Días:Horas:Minutos.
//
// Endpoints (inventario/api/viewsets/objetos/descarte_actions.py):
//   GET  /api/objetos/contexto_descarte/         → tiempos + permisos + padrón
//   POST /api/objetos/{id}/ordenar_descarte/     → { tiempo_gracia }
//   POST /api/objetos/{id}/cancelar_descarte/    → { accion: conservar | mudar }
//   POST /api/objetos/{id}/confirmar_descarte/   → solo Administrador Físico
//   POST /api/objetos/{id}/despachar_envio/      → solo Administrador Físico
//
// Auth 100% centralizada (getAuthHeaders): este módulo JAMÁS arma el header
// Authorization a mano ni lee tokens de localStorage.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import type { ObjetoDecision } from './decisionesTarjeta';

/** Opción de tiempo de gracia ofrecida por el backend (no se hardcodea acá). */
export interface TiempoGracia {
  valor: string;
  etiqueta: string;
  horas: number;
}

/** Contexto de descarte del Estok activo + permisos del usuario logueado. */
export interface ContextoDescarte {
  tiempos_gracia: TiempoGracia[];
  total_usuarios_activos: number;
  requiere_tiempo_gracia: boolean;
  puede_administrar_fisico: boolean;
}

const CONTEXTO_INICIAL: ContextoDescarte = {
  tiempos_gracia: [],
  total_usuarios_activos: 1,
  requiere_tiempo_gracia: false,
  puede_administrar_fisico: false,
};

/** Evento que avisa al resto de la pestaña que el descarte cambió de estado. */
export const EVENTO_CAMBIO_DESCARTE = 'estok:descarte-cambio';

/** Evento con el que el Alerta Rojo pide abrir el modal de reclamo. */
export const EVENTO_ABRIR_RECLAMO = 'estok:descarte-abrir-reclamo';

let contexto: ContextoDescarte = { ...CONTEXTO_INICIAL };
let contextoEnCurso: Promise<ContextoDescarte> | null = null;
let descartesEnGracia: ObjetoDecision[] = [];
let temporizador: number | null = null;

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

// -----------------------------------------------------------------------------
// Contexto (tiempos de gracia, padrón y permisos físicos)
// -----------------------------------------------------------------------------

/** Carga (y cachea) el contexto de descarte del Estok activo. */
export async function cargarContextoDescarte(forzar = false): Promise<ContextoDescarte> {
  if (!forzar && contextoEnCurso) return contextoEnCurso;
  if (!forzar && contexto.tiempos_gracia.length) return contexto;

  contextoEnCurso = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/objetos/contexto_descarte/`, {
        headers: getAuthHeaders(),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return contexto;
      }
      if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
      contexto = { ...CONTEXTO_INICIAL, ...(await res.json()) };
    } catch {
      // Fallo silencioso: la UI sigue con los valores por defecto (sin gracia
      // obligatoria) y el backend valida igual al ordenar el descarte.
      contexto = { ...CONTEXTO_INICIAL };
    }
    return contexto;
  })();

  return contextoEnCurso;
}

export function contextoActual(): ContextoDescarte {
  return contexto;
}

/** True si el usuario logueado es Administrador Físico del Estok activo. */
export function puedeAdministrarFisico(): boolean {
  return contexto.puede_administrar_fisico;
}

/** True si el Estok tiene más de un usuario activo (gracia obligatoria). */
export function requiereTiempoGracia(): boolean {
  return contexto.requiere_tiempo_gracia;
}

// -----------------------------------------------------------------------------
// Cuenta regresiva (pura y reutilizable por el Alerta Rojo y el Bloque 4)
// -----------------------------------------------------------------------------

/** Milisegundos restantes hasta la fecha límite (0 si no hay plazo o venció). */
export function milisegundosRestantes(fechaLimite: string | null): number {
  if (!fechaLimite) return 0;
  const objetivo = new Date(fechaLimite).getTime();
  if (Number.isNaN(objetivo)) return 0;
  return Math.max(0, objetivo - Date.now());
}

/** Formatea un saldo de milisegundos como Días:Horas:Minutos (o "Vencido"). */
export function formatearRestante(ms: number): string {
  if (ms <= 0) return '⏰ Vencido';
  const totalMinutos = Math.floor(ms / 60000);
  const dias = Math.floor(totalMinutos / 1440);
  const horas = Math.floor((totalMinutos % 1440) / 60);
  const minutos = totalMinutos % 60;
  return `${dias}d ${String(horas).padStart(2, '0')}h ${String(minutos).padStart(2, '0')}m`;
}

/** Cuenta regresiva más urgente del listado (la que muestra el Alerta Rojo). */
export function restanteMasUrgente(): number {
  if (!descartesEnGracia.length) return 0;
  return descartesEnGracia.reduce((minimo, objeto) => {
    const ms = milisegundosRestantes(objeto.fecha_limite_descarte);
    return minimo === 0 ? ms : Math.min(minimo, ms);
  }, 0);
}

/** Avisa al resto de la pestaña que el descarte cambió (Bloques 3, 4 y 5). */
export function notificarCambioDescarte(): void {
  window.dispatchEvent(new Event(EVENTO_CAMBIO_DESCARTE));
}

/** Descartes con gracia vigente (los reclama el Alerta Rojo). */
export function descartesConGracia(): ObjetoDecision[] {
  return descartesEnGracia;
}

// -----------------------------------------------------------------------------
// ALERTA ROJO · "Hay X objetos que serán tirados a la basura en: ..."
// -----------------------------------------------------------------------------

/**
 * Sincroniza el Alerta Rojo del cabezal del Bloque 2 con los descartes que
 * siguen dentro de su período de gracia.
 */
export function actualizarDescartesEnGracia(lista: ObjetoDecision[]): void {
  descartesEnGracia = lista || [];
  renderAlerta();
  programarTick();
}

function renderAlerta(): void {
  const host = el('alertaDescarte');
  if (!host) return;

  if (!descartesEnGracia.length) {
    host.classList.add('hidden');
    host.innerHTML = '';
    return;
  }

  host.classList.remove('hidden');
  host.innerHTML = `
    <span id="alertaDescarteTexto" class="font-bold text-red-600"></span>
    <button type="button" id="alertaDescarteLink"
      class="ml-1 underline font-bold text-red-700 hover:text-red-800">ingresá aquí</button>`;
  actualizarTextoAlerta();
  el('alertaDescarteLink')?.addEventListener('click', () => {
    window.dispatchEvent(new Event(EVENTO_ABRIR_RECLAMO));
  });
}

function actualizarTextoAlerta(): void {
  const texto = el('alertaDescarteTexto');
  if (!texto) return;
  const cantidad = descartesEnGracia.length;
  const restante = formatearRestante(restanteMasUrgente());
  texto.textContent = `🚨 Hay ${cantidad} ${
    cantidad === 1 ? 'objeto' : 'objetos'
  } que serán tirados a la basura en: ${restante}. Si querés reclamarlo`;
}

/** Refresca el contador cada segundo y avisa cuando un plazo vence. */
function programarTick(): void {
  if (temporizador !== null) {
    window.clearInterval(temporizador);
    temporizador = null;
  }
  if (!descartesEnGracia.length) return;

  temporizador = window.setInterval(() => {
    if (restanteMasUrgente() <= 0) {
      // Al vencer el plazo el objeto deja de ser reclamable: sale del Alerta
      // Rojo y el Bloque 4 habilita el descarte físico (Admin. Físico).
      descartesEnGracia = descartesEnGracia.map((objeto) => ({
        ...objeto,
        en_periodo_gracia: false,
        descarte_listo_para_ejecutar: true,
      }));
      renderAlerta();
      notificarCambioDescarte();
      return;
    }
    actualizarTextoAlerta();
    actualizarContadoresTarjetas();
  }, 1000);
}

// -----------------------------------------------------------------------------
// Los MODALES del descarte (selector de tiempo de gracia + reclamo del Alerta
// Rojo) viven en lib/descarteModales.ts: este archivo es el núcleo de estado,
// cuenta regresiva y API, sin markup de modales (disciplina de modularidad).
// -----------------------------------------------------------------------------

/** Actualiza los contadores regresivos visibles (alerta + tarjetas del modal). */
function actualizarContadoresTarjetas(): void {
  document.querySelectorAll<HTMLElement>('[data-cuenta-descarte]').forEach((nodo) => {
    const objeto = descartesEnGracia.find((o) => o.id === nodo.dataset.cuentaDescarte);
    if (!objeto) return;
    nodo.textContent = formatearRestante(
      milisegundosRestantes(objeto.fecha_limite_descarte),
    );
  });
}

/** Fuerza el refresco inmediato de los contadores regresivos visibles. */
export function refrescarContadoresDescarte(): void {
  actualizarContadoresTarjetas();
}

/** Quita un objeto del Alerta Rojo (ya fue reclamado por Conservar o Mudar). */
export function quitarDescarteEnGracia(objetoId: string): void {
  descartesEnGracia = descartesEnGracia.filter((objeto) => objeto.id !== objetoId);
  renderAlerta();
  programarTick();
}

// -----------------------------------------------------------------------------
// API del descarte (la comparten el tarjetero y el panel de Bloques 3, 4 y 5)
// -----------------------------------------------------------------------------

/** POST autenticado del módulo: devuelve el mensaje legible del backend. */
async function peticionDescarte(
  url: string,
  cuerpo: Record<string, unknown> = {},
): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(cuerpo),
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sesión expirada.');
  }
  const data = (await res.json().catch(() => ({}))) as {
    mensaje?: string;
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(
      data.error || data.detail || `Error ${res.status} al procesar el descarte.`,
    );
  }
  return data.mensaje || 'Listo.';
}

/** Registra la orden de descarte (con tiempo de gracia si el Estok lo exige). */
export function ordenarDescarteRemoto(
  objetoId: string,
  tiempoGracia: string | null,
): Promise<string> {
  return peticionDescarte(
    `${API_BASE_URL}/objetos/${objetoId}/ordenar_descarte/`,
    tiempoGracia ? { tiempo_gracia: tiempoGracia } : {},
  );
}

/** Reclama el objeto antes del vencimiento (Conservar / Mudar). */
export function reclamarDescarte(
  objetoId: string,
  accion: 'conservar' | 'mudar',
): Promise<string> {
  return peticionDescarte(
    `${API_BASE_URL}/objetos/${objetoId}/cancelar_descarte/`,
    { accion },
  );
}

/** Confirma el descarte FÍSICO final (solo Administrador Físico). */
export function confirmarDescarteFinal(objetoId: string): Promise<string> {
  return peticionDescarte(`${API_BASE_URL}/objetos/${objetoId}/confirmar_descarte/`);
}

/** Despacha el envío de un objeto vendido (solo Administrador Físico). */
export function despacharEnvio(objetoId: string): Promise<string> {
  return peticionDescarte(`${API_BASE_URL}/objetos/${objetoId}/despachar_envio/`);
}
