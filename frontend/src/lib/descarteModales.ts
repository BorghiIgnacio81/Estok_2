// =============================================================================
// MODALES DEL DESCARTE (pestaña "Decisiones")
// -----------------------------------------------------------------------------
// Dos modales, ambos alimentados por el núcleo lib/descarteGracia.ts (estado,
// cuenta regresiva y API):
//
//   1. SELECTOR DE TIEMPO DE GRACIA (botón 🗑️ Tirar del Bloque 1): obligatorio
//      cuando el Estok tiene más de un usuario activo (24 Horas / 3 Días /
//      1 Semana, opciones que envía el backend).
//   2. RECLAMO (Alerta Rojo del Bloque 2): detalla el propietario físico actual
//      de cada objeto en período de gracia y permite cancelar la orden mutando
//      el estado a 'Conservar' o 'Mudar'.
//
// El markup de ambos vive en components/ModalDescarteGracia.astro; acá solo la
// lógica (disciplina de modularidad del proyecto).
// =============================================================================

import {
  EVENTO_ABRIR_RECLAMO,
  cargarContextoDescarte,
  contextoActual,
  descartesConGracia,
  formatearRestante,
  milisegundosRestantes,
  notificarCambioDescarte,
  ordenarDescarteRemoto,
  quitarDescarteEnGracia,
  reclamarDescarte,
  refrescarContadoresDescarte,
  requiereTiempoGracia,
} from './descarteGracia';
import { escapar, tarjetaObjetoHtml } from './decisionesTarjeta';
import type { ObjetoDecision } from './decisionesTarjeta';

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

// -----------------------------------------------------------------------------
// MODAL 1 · ordenar el descarte eligiendo el tiempo de gracia
// -----------------------------------------------------------------------------

/** Callbacks del flujo de descarte que dispara la botonera de una tarjeta. */
export interface FlujoDescarte {
  /** El descarte ya quedó registrado en el backend. */
  alConfirmar: (mensaje: string) => void | Promise<void>;
  /** El usuario cerró el selector o la orden falló: se rehabilita la tarjeta. */
  alAbortar: (mensaje?: string) => void;
}

let objetoGracia: { id: string; nombre: string } | null = null;
let flujoPendiente: FlujoDescarte | null = null;
let tiempoSeleccionado = '';

/**
 * Punto de entrada del botón 🗑️ Tirar: si el Estok tiene más de un usuario
 * activo abre el selector de tiempo de gracia OBLIGATORIO; si no, ordena el
 * descarte directamente (nadie más podría reclamarlo).
 */
export async function solicitarDescarte(
  objeto: { id: string; nombre: string },
  flujo: FlujoDescarte,
): Promise<void> {
  await cargarContextoDescarte();
  // Si la primera carga del contexto falló (no hay opciones de gracia), se
  // reintenta ANTES de abrir el selector para no dejar el modal vacío.
  if (!contextoActual().tiempos_gracia.length) {
    await cargarContextoDescarte(true);
  }

  if (requiereTiempoGracia()) {
    abrirModalGracia(objeto, flujo);
    return;
  }

  try {
    const mensaje = await ordenarDescarteRemoto(objeto.id, null);
    notificarCambioDescarte();
    await flujo.alConfirmar(mensaje);
  } catch (error) {
    flujo.alAbortar(
      error instanceof Error ? error.message : 'No se pudo ordenar el descarte.',
    );
  }
}

function abrirModalGracia(
  objeto: { id: string; nombre: string },
  flujo: FlujoDescarte,
): void {
  objetoGracia = objeto;
  flujoPendiente = flujo;
  tiempoSeleccionado = '';

  const nombre = el('graciaObjetoNombre');
  if (nombre) nombre.textContent = objeto.nombre;

  const aviso = el('graciaAviso');
  if (aviso) {
    aviso.textContent = `Este Estok tiene ${contextoActual().total_usuarios_activos} usuarios activos: elegí cuánto tiempo podrán reclamar el objeto antes de que se tire.`;
  }

  mostrarErrorGracia('');
  renderOpcionesGracia();
  el('modalDescarteGracia')?.classList.remove('hidden');
}

function renderOpcionesGracia(): void {
  const host = el('graciaOpciones');
  if (!host) return;
  const tiempos = contextoActual().tiempos_gracia;
  if (!tiempos.length) {
    host.innerHTML = '';
    mostrarErrorGracia(
      'No se pudieron cargar los tiempos de gracia. Recargá la página para reintentar.',
    );
    return;
  }
  host.innerHTML = tiempos
    .map(
      (tiempo) => `
      <button type="button" data-tiempo-gracia="${escapar(tiempo.valor)}"
        class="px-3 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:border-red-400 hover:text-red-700 transition-base">
        ⏳ ${escapar(tiempo.etiqueta)}
      </button>`,
    )
    .join('');
}

function seleccionarTiempoGracia(valor: string): void {
  tiempoSeleccionado = valor;
  document.querySelectorAll<HTMLElement>('[data-tiempo-gracia]').forEach((boton) => {
    const activo = boton.dataset.tiempoGracia === valor;
    boton.classList.toggle('border-red-500', activo);
    boton.classList.toggle('bg-red-50', activo);
    boton.classList.toggle('text-red-700', activo);
  });
  mostrarErrorGracia('');
}

function mostrarErrorGracia(mensaje: string): void {
  const host = el('graciaError');
  if (!host) return;
  host.textContent = mensaje;
  host.classList.toggle('hidden', !mensaje);
}

async function confirmarModalGracia(): Promise<void> {
  if (!objetoGracia || !flujoPendiente) return;
  if (!tiempoSeleccionado) {
    mostrarErrorGracia('Elegí un tiempo de gracia antes de continuar.');
    return;
  }

  const boton = el<HTMLButtonElement>('btnConfirmarGracia');
  if (boton) boton.disabled = true;
  try {
    const mensaje = await ordenarDescarteRemoto(objetoGracia.id, tiempoSeleccionado);
    const flujo = flujoPendiente;
    cerrarModalGracia();
    notificarCambioDescarte();
    await flujo.alConfirmar(mensaje);
  } catch (error) {
    mostrarErrorGracia(
      error instanceof Error ? error.message : 'No se pudo ordenar el descarte.',
    );
  } finally {
    if (boton) boton.disabled = false;
  }
}

/** Cierra el modal SIN avisar al tarjetero (uso interno al confirmar). */
function cerrarModalGracia(): void {
  el('modalDescarteGracia')?.classList.add('hidden');
  objetoGracia = null;
  flujoPendiente = null;
  tiempoSeleccionado = '';
}

/** El usuario cerró el selector: se rehabilita la botonera de la tarjeta. */
function cancelarModalGracia(): void {
  const flujo = flujoPendiente;
  cerrarModalGracia();
  flujo?.alAbortar();
}

// -----------------------------------------------------------------------------
// MODAL 2 · reclamo desde el Alerta Rojo (Conservar / Mudar)
// -----------------------------------------------------------------------------

/** Detalle del propietario FÍSICO actual + cuenta regresiva de cada objeto. */
function pieReclamoHtml(objeto: ObjetoDecision): string {
  const ubicacion = [objeto.ubicacion_nombre, objeto.contenedor_nombre]
    .filter(Boolean)
    .join(' · ');
  const propietario = objeto.dueno_original_nombre
    || objeto.dueno_externo_nombre
    || objeto.beneficiario_nombre
    || 'Sin dueño registrado';
  return `
    <div class="bg-red-50 border border-red-200 rounded-lg p-2 text-[11px] text-gray-700 flex flex-col gap-0.5">
      <p><strong>Propietario físico actual:</strong> ${escapar(propietario)}</p>
      ${objeto.beneficiario_nombre ? `<p><strong>Beneficiario designado:</strong> ${escapar(objeto.beneficiario_nombre)}</p>` : ''}
      <p><strong>Ubicación física:</strong> ${ubicacion ? escapar(ubicacion) : 'sin ubicación asignada'}</p>
      <p class="text-red-700 font-bold">⏳ Se tira en: <span data-cuenta-descarte="${escapar(objeto.id)}">${
        formatearRestante(milisegundosRestantes(objeto.fecha_limite_descarte))
      }</span></p>
    </div>`;
}

function accionesReclamoHtml(objeto: ObjetoDecision): string {
  return `
    <div class="mt-auto flex items-stretch gap-1.5">
      <button type="button" data-reclamo-id="${escapar(objeto.id)}" data-reclamo-accion="conservar"
        class="flex-1 inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-base disabled:opacity-40">
        📦 Conservar
      </button>
      <button type="button" data-reclamo-id="${escapar(objeto.id)}" data-reclamo-accion="mudar"
        class="flex-1 inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-sm transition-base disabled:opacity-40">
        🔁 Mudar
      </button>
    </div>`;
}

/** Abre el modal que detalla cada objeto en período de gracia y permite reclamarlo. */
export function abrirModalReclamo(): void {
  if (!descartesConGracia().length) return;
  renderReclamos();
  mostrarAvisoReclamo('');
  el('modalReclamoDescarte')?.classList.remove('hidden');
  refrescarContadoresDescarte();
}

function cerrarModalReclamo(): void {
  el('modalReclamoDescarte')?.classList.add('hidden');
}

function renderReclamos(): void {
  const host = el('listaReclamos');
  if (!host) return;
  const descartes = descartesConGracia();
  if (!descartes.length) {
    host.innerHTML = '<p class="text-sm text-gray-500">Ya no quedan objetos en período de reclamo.</p>';
    return;
  }
  host.innerHTML = descartes
    .map((objeto) =>
      tarjetaObjetoHtml(objeto, {
        pie: pieReclamoHtml(objeto),
        acciones: accionesReclamoHtml(objeto),
        atributos: 'data-reclamo-card="true"',
        extraClases: 'ring-1 ring-red-200',
      }),
    )
    .join('');
}

function mostrarAvisoReclamo(mensaje: string, exito = true): void {
  const host = el('reclamoAviso');
  if (!host) return;
  host.textContent = mensaje;
  host.className = `px-4 pt-3 text-sm ${exito ? 'text-green-700' : 'text-red-700'}`;
  host.classList.toggle('hidden', !mensaje);
}

async function onReclamoClick(evento: Event): Promise<void> {
  const boton = (evento.target as HTMLElement | null)?.closest<HTMLButtonElement>(
    '[data-reclamo-id]',
  );
  if (!boton) return;

  const objetoId = boton.dataset.reclamoId || '';
  const accion = boton.dataset.reclamoAccion === 'mudar' ? 'mudar' : 'conservar';
  boton.disabled = true;
  try {
    const mensaje = await reclamarDescarte(objetoId, accion);
    quitarDescarteEnGracia(objetoId);
    renderReclamos();
    mostrarAvisoReclamo(mensaje, true);
    notificarCambioDescarte();
  } catch (error) {
    mostrarAvisoReclamo(
      error instanceof Error ? error.message : 'No se pudo reclamar el objeto.',
      false,
    );
    boton.disabled = false;
  }
}

// -----------------------------------------------------------------------------
// Arranque (idempotente)
// -----------------------------------------------------------------------------

/** Enlaza los dos modales del descarte y precarga el contexto del Estok. */
export function iniciarModalesDescarte(): void {
  void cargarContextoDescarte();

  const modalGracia = el('modalDescarteGracia');
  if (modalGracia && modalGracia.dataset.activo !== 'true') {
    modalGracia.dataset.activo = 'true';
    el('cerrarModalGraciaBtn')?.addEventListener('click', cancelarModalGracia);
    el('btnConfirmarGracia')?.addEventListener('click', () => void confirmarModalGracia());
    modalGracia.addEventListener('click', (evento) => {
      if (evento.target === modalGracia) cancelarModalGracia();
    });
    el('graciaOpciones')?.addEventListener('click', (evento) => {
      const boton = (evento.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-tiempo-gracia]',
      );
      if (boton?.dataset.tiempoGracia) seleccionarTiempoGracia(boton.dataset.tiempoGracia);
    });
  }

  const modalReclamo = el('modalReclamoDescarte');
  if (modalReclamo && modalReclamo.dataset.activo !== 'true') {
    modalReclamo.dataset.activo = 'true';
    el('cerrarModalReclamoBtn')?.addEventListener('click', cerrarModalReclamo);
    modalReclamo.addEventListener('click', (evento) => {
      if (evento.target === modalReclamo) cerrarModalReclamo();
    });
    el('listaReclamos')?.addEventListener('click', (evento) => void onReclamoClick(evento));
  }

  // El Alerta Rojo del Bloque 2 pide abrir el modal de reclamo por evento: así
  // el núcleo (descarteGracia.ts) no depende de este módulo de modales.
  window.addEventListener(EVENTO_ABRIR_RECLAMO, abrirModalReclamo);
}
