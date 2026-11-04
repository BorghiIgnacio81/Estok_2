// =============================================================================
// MODAL «ESCANEAR QR» · ORQUESTADOR (estados, apertura/cierre y resolución)
// -----------------------------------------------------------------------------
// Lo dispara el botón gráfico de la barra de acciones del Dashboard
// (`[data-abrir-escaner-qr]`) y lo pinta components/escaner/EscanerQrModal.astro.
//
//   lib/escanerQrCamara.ts    → getUserMedia + bucle jsQR (+ foto de respaldo)
//   lib/escanerQrContenido.ts → consultas: contenido de la caja y ruta completa
//   lib/escanerQrResultado.ts → render del panel de resultado
//   lib/qrComun.ts            → formato del QR y mensajes de error de cámara
//
// Este archivo sólo coordina: abrir/cerrar, estados visuales y decidir si el QR
// apunta a una caja o a un objeto. Los errores NUNCA se muestran crudos: el
// operador recibe una instrucción accionable.
// =============================================================================

import { refOpcional } from './dom';
import { extraerReferenciaQr } from './qrComun';
import { crearCamaraQr, type CamaraQr } from './escanerQrCamara';
import { resolverContenedor, resolverObjeto } from './escanerQrContenido';
import { pintarResultadoContenedor, pintarResultadoObjeto } from './escanerQrResultado';

/** Referencias del markup del modal (components/escaner/EscanerQrModal.astro). */
interface RefsModal {
  modal: HTMLElement;
  cerrar: HTMLButtonElement;
  camara: HTMLElement;
  video: HTMLVideoElement;
  estado: HTMLElement;
  error: HTMLElement;
  reintentar: HTMLButtonElement;
  resultado: HTMLElement;
  archivo: HTMLInputElement | null;
}

let ui: RefsModal | null = null;
let lector: CamaraQr | null = null;
let procesando = false;

// =============================================================================
// ESTADOS VISUALES
// =============================================================================

function fijarEstado(texto: string): void {
  if (ui) ui.estado.textContent = texto;
}

/** Limpia resultado + error (al abrir, al reintentar o al cerrar). */
function limpiarResultado(): void {
  if (!ui) return;
  ui.resultado.classList.add('hidden');
  ui.resultado.replaceChildren();
  ui.error.classList.add('hidden');
  ui.error.textContent = '';
  ui.reintentar.classList.add('hidden');
}

/** Aviso ámbar + botón «Reintentar cámara». */
function mostrarError(mensaje: string): void {
  if (!ui) return;
  lector?.detener();
  ui.camara.classList.add('hidden');
  ui.resultado.classList.add('hidden');
  ui.error.textContent = mensaje;
  ui.error.classList.remove('hidden');
  ui.reintentar.classList.remove('hidden');
  fijarEstado('No se pudo completar el escaneo');
}

/** Estado de espera dentro del panel de resultado (QR detectado → buscando). */
function mostrarCargando(mensaje: string): void {
  if (!ui) return;

  const caja = document.createElement('div');
  caja.className = 'flex items-center justify-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 text-sm font-medium text-gray-700';
  const spinner = document.createElement('span');
  spinner.className = 'inline-block h-5 w-5 rounded-full border-2 border-gray-300 border-t-blue-700 animate-spin';
  spinner.setAttribute('aria-hidden', 'true');
  const texto = document.createElement('span');
  texto.textContent = mensaje;
  caja.append(spinner, texto);

  ui.resultado.replaceChildren(caja);
  ui.resultado.classList.remove('hidden');
  fijarEstado(mensaje);
}

// =============================================================================
// CÁMARA
// =============================================================================

async function iniciarCamara(): Promise<void> {
  if (!ui || !lector) return;

  limpiarResultado();
  ui.camara.classList.remove('hidden');
  fijarEstado('Pidiendo permiso de cámara…');

  const resultado = await lector.iniciar();
  if (!resultado.ok) {
    mostrarError(resultado.mensaje);
    return;
  }

  ui.error.classList.add('hidden');
  ui.reintentar.classList.add('hidden');
  ui.camara.classList.remove('hidden');
  fijarEstado('Enfocá el QR de la caja, contenedor u objeto');
}

// =============================================================================
// RESOLUCIÓN DEL QR (contenedor ⇄ objeto)
// =============================================================================

async function mostrarContenedor(id: string): Promise<void> {
  if (!ui) return;
  const datos = await resolverContenedor(id);

  if (!datos) {
    // Compatibilidad: un id que no es contenedor puede ser una ficha de OBJETO.
    const objeto = await resolverObjeto(id);
    if (objeto) {
      const nombre = pintarResultadoObjeto(ui.resultado, objeto, () => void iniciarCamara());
      ui.camara.classList.add('hidden');
      fijarEstado(`✅ ${nombre}`);
      return;
    }
    mostrarError('El QR no corresponde a una caja, contenedor u objeto de este Estok.');
    return;
  }

  const nombre = pintarResultadoContenedor(ui.resultado, datos, () => void iniciarCamara());
  ui.camara.classList.add('hidden');
  fijarEstado(`✅ ${nombre}`);
}

async function mostrarObjeto(id: string): Promise<void> {
  if (!ui) return;
  const objeto = await resolverObjeto(id);

  if (!objeto) {
    await mostrarContenedor(id);
    return;
  }

  const nombre = pintarResultadoObjeto(ui.resultado, objeto, () => void iniciarCamara());
  ui.camara.classList.add('hidden');
  fijarEstado(`✅ ${nombre}`);
}

/** Punto único de entrada de un código ya decodificado (cámara o foto). */
async function procesarQr(qrData: string): Promise<void> {
  if (!ui || procesando) return;
  procesando = true;

  // Se libera la cámara mientras se consulta la API (batería + LED apagado).
  lector?.detener();
  ui.camara.classList.add('hidden');

  const referencia = extraerReferenciaQr(qrData);
  if (!referencia) {
    mostrarError('El código escaneado no es un QR de contenedor ni de objeto de Estok.');
    procesando = false;
    return;
  }

  mostrarCargando(
    referencia.tipo === 'objeto' ? 'QR detectado. Buscando el objeto…' : 'QR detectado. Buscando el contenedor…',
  );

  try {
    if (referencia.tipo === 'objeto') await mostrarObjeto(referencia.id);
    else await mostrarContenedor(referencia.id);
  } catch (err) {
    console.error('Error al procesar el QR:', err);
    mostrarError('No se pudo leer el contenido del QR. Revisá la conexión e intentá de nuevo.');
  } finally {
    procesando = false;
  }
}

// =============================================================================
// FALLBACK: ESCANEAR DESDE UNA FOTO (cámara o galería)
// =============================================================================

async function escanearArchivo(file: File): Promise<void> {
  if (!ui || !lector || procesando) return;

  ui.camara.classList.add('hidden');
  mostrarCargando('Leyendo la imagen…');

  const texto = await lector.escanearArchivo(file);
  if (!texto) {
    mostrarError('No se detectó un QR en la imagen. Probá con una foto más nítida y sin reflejos.');
    return;
  }
  await procesarQr(texto);
}

// =============================================================================
// APERTURA / CIERRE
// =============================================================================

function abrirModal(): void {
  if (!ui) return;
  ui.modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
  void iniciarCamara();
}

function cerrarModal(): void {
  if (!ui) return;
  lector?.detener();
  procesando = false;
  limpiarResultado();
  ui.modal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

/**
 * Engancha el modal y TODOS sus disparadores (`[data-abrir-escaner-qr]`).
 * Si la página no monta el markup, sale sin efectos secundarios.
 */
export function initEscanerQrModal(): void {
  const modal = refOpcional<HTMLElement>('escanerQrModal');
  const video = refOpcional<HTMLVideoElement>('escanerQrVideo');
  const cerrar = refOpcional<HTMLButtonElement>('escanerQrCerrar');
  const camara = refOpcional<HTMLElement>('escanerQrCamara');
  const estado = refOpcional<HTMLElement>('escanerQrEstado');
  const error = refOpcional<HTMLElement>('escanerQrError');
  const reintentar = refOpcional<HTMLButtonElement>('escanerQrReintentar');
  const resultado = refOpcional<HTMLElement>('escanerQrResultado');

  if (!modal || !video || !cerrar || !camara || !estado || !error || !reintentar || !resultado) {
    return;
  }

  const refs: RefsModal = {
    modal,
    cerrar,
    camara,
    video,
    estado,
    error,
    reintentar,
    resultado,
    archivo: refOpcional<HTMLInputElement>('escanerQrArchivo'),
  };
  ui = refs;
  lector = crearCamaraQr(video, (texto) => void procesarQr(texto));

  document.querySelectorAll<HTMLElement>('[data-abrir-escaner-qr]').forEach((boton) => {
    boton.addEventListener('click', (evento) => {
      evento.preventDefault();
      abrirModal();
    });
  });

  cerrar.addEventListener('click', cerrarModal);
  modal.addEventListener('click', (evento) => {
    if (evento.target === modal) cerrarModal();
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !modal.classList.contains('hidden')) cerrarModal();
  });
  reintentar.addEventListener('click', () => void iniciarCamara());

  refs.archivo?.addEventListener('change', (evento) => {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void escanearArchivo(file);
    input.value = '';
  });

  // iOS/Android cortan los tracks al pasar a segundo plano: al volver, si el
  // modal sigue abierto y no se está procesando, se reabre el feed.
  document.addEventListener('visibilitychange', () => {
    if (!ui || !lector || document.hidden || procesando) return;
    if (ui.modal.classList.contains('hidden') || ui.camara.classList.contains('hidden')) return;
    if (!lector.estaActiva()) void iniciarCamara();
  });

  // La cámara se libera SIEMPRE al salir de la página (pagehide es fiable en iOS).
  window.addEventListener('pagehide', () => lector?.detener());
}
