// =============================================================================
// ESCÁNER QR · Cámara en vivo para /escanear
// -----------------------------------------------------------------------------
// Extraído de pages/escanear/index.astro (la página ya estaba en el límite de
// 400 líneas). Responsabilidades:
//   · Pedir cámara trasera con getUserMedia (móvil iOS/Android) y explicar los
//     errores de permiso con mensajes accionables por plataforma.
//   · Decodificar con jsQR EMPAQUETADO (import) en lugar del CDN: funciona
//     offline, en TWA y dentro de un WebView sin acceso a CDNs externos.
//   · Re escalar cada frame a 640 px y limitar a ~8 lecturas/s: jsQR es O(n²)
//     en píxeles y con frames 1080p la cámara "se traba" en móviles modestos.
//   · Reanudar la cámara al volver del segundo plano (iOS corta los tracks).
//   · Fallback «escanear desde una foto»: si el navegador bloquea
//     getUserMedia (WebView in-app, contexto no seguro), se decodifica un
//     archivo de cámara/galería con el mismo jsQR.
// =============================================================================

import jsQR from 'jsqr';
import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { ref, refOpcional } from './dom';

/** Lado máximo del frame que se pasa a jsQR (más píxeles = menos fps). */
const DIMENSION_MAX_ESCANEO = 640;
/** Intervalo mínimo entre lecturas: ~8 fps, suficiente para un QR en pantalla. */
const INTERVALO_ESCANEO_MS = 120;

interface RefsEscaner {
  noCamera: HTMLElement;
  cameraErrorText: HTMLElement;
  retryCameraBtn: HTMLButtonElement;
  scanningState: HTMLElement;
  resultState: HTMLElement;
  resultText: HTMLElement;
  resultSpinner: HTMLElement;
  scanStatus: HTMLElement;
  stopBtn: HTMLButtonElement;
  stopText: HTMLElement;
  retryScanBtn: HTMLButtonElement;
  qrFileInput: HTMLInputElement | null;
  video: HTMLVideoElement;
}

let ui: RefsEscaner;
let stream: MediaStream | null = null;
let animationFrameId: number | null = null;
let scanning = false;
let procesando = false;
let ultimoEscaneo = 0;

// Un solo canvas reutilizado (crear uno por frame genera basura en móvil).
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// =============================================================================
// UI DE ERRORES / ESTADOS
// =============================================================================

function mostrarError(mensaje: string): void {
  ui.cameraErrorText.textContent = mensaje;
  ui.noCamera.classList.remove('hidden');
  ui.scanningState.classList.add('hidden');
  ui.resultState.classList.add('hidden');
}

function ocultarError(): void {
  ui.cameraErrorText.textContent = '';
  ui.noCamera.classList.add('hidden');
}

/** Traduce el DOMException de getUserMedia a una instrucción útil. */
function mensajeDeError(err: unknown): string {
  const nombre = err instanceof DOMException ? err.name : '';
  switch (nombre) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permiso de cámara bloqueado. En iPhone: Ajustes → Safari (o Estok) → Cámara → Permitir. En Android: Ajustes → Aplicaciones → Permisos → Cámara.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No se encontró una cámara compatible en este dispositivo.';
    case 'NotReadableError':
      return 'La cámara está siendo usada por otra aplicación. Cerrala e intentá de nuevo.';
    default:
      return 'No se pudo iniciar la cámara. Revisá los permisos o escaneá desde una foto.';
  }
}

// =============================================================================
// CÁMARA
// =============================================================================

async function pedirStream(): Promise<MediaStream> {
  // `ideal` (no exact): en escritorio sin cámara trasera no rompe el pedido.
  const preferido: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
  try {
    return await navigator.mediaDevices.getUserMedia(preferido);
  } catch (err) {
    // Algunos Android viejos no entienden width/height ideales: reintento simple.
    if (err instanceof DOMException && err.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
    throw err;
  }
}

async function iniciarCamara(): Promise<void> {
  if (!window.isSecureContext) {
    mostrarError('La cámara requiere HTTPS. Abrí Estok desde https://eeestok.duckdns.org o escaneá desde una foto.');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    mostrarError('Este navegador no expone la cámara. Usá «Escanear desde una foto».');
    return;
  }

  detenerCamara();
  ocultarError();

  try {
    stream = await pedirStream();
    ui.video.srcObject = stream;
    // iOS exige muted + playsinline (ya están en el markup) para reproducir
    // el feed dentro de la página en lugar de abrir el reproductor nativo.
    await ui.video.play();

    ui.scanningState.classList.remove('hidden');
    ui.resultState.classList.add('hidden');
    ui.stopText.textContent = '⏹ Detener escáner';
    ui.retryScanBtn.classList.add('hidden');
    ui.stopBtn.classList.remove('hidden');

    iniciarBucleEscaneo();
  } catch (err) {
    console.error('Error al acceder a la cámara:', err);
    mostrarError(mensajeDeError(err));
  }
}

function detenerCamara(): void {
  scanning = false;
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  ui.video.srcObject = null;
}


// =============================================================================
// BUCLE DE ESCANEO (frame reescalado + throttle)
// =============================================================================

function iniciarBucleEscaneo(): void {
  scanning = true;
  procesando = false;
  ultimoEscaneo = 0;
  ui.scanStatus.textContent = 'Buscando QR...';

  const tick = (): void => {
    if (!scanning) return;
    // rAF se pausa solo en segundo plano: no consume batería con la app oculta.
    animationFrameId = requestAnimationFrame(tick);

    if (!ctx || document.hidden || procesando) return;
    if (ui.video.readyState < 2 || !ui.video.videoWidth) return;

    const ahora = performance.now();
    if (ahora - ultimoEscaneo < INTERVALO_ESCANEO_MS) return;
    ultimoEscaneo = ahora;

    const anchoVideo = ui.video.videoWidth;
    const altoVideo = ui.video.videoHeight;
    const escala = Math.min(1, DIMENSION_MAX_ESCANEO / Math.max(anchoVideo, altoVideo));
    const ancho = Math.max(1, Math.round(anchoVideo * escala));
    const alto = Math.max(1, Math.round(altoVideo * escala));

    if (canvas.width !== ancho) canvas.width = ancho;
    if (canvas.height !== alto) canvas.height = alto;

    ctx.drawImage(ui.video, 0, 0, ancho, alto);
    const imagen = ctx.getImageData(0, 0, ancho, alto);
    const codigo = jsQR(imagen.data, ancho, alto, { inversionAttempts: 'dontInvert' });

    if (codigo?.data) {
      ui.scanStatus.textContent = '✅ QR detectado!';
      void procesarQR(codigo.data);
    }
  };

  animationFrameId = requestAnimationFrame(tick);
}

// =============================================================================
// CACHÉ DE CONTENEDORES (redirección instantánea del QR)
// =============================================================================

const contenedoresCache = new Map<string, boolean>();
let cacheLoaded = false;

async function precargarContenedores(): Promise<void> {
  if (cacheLoaded) return;
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/?limit=100`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return;
    const data = await res.json();
    const contenedores = data.results || data;
    contenedores.forEach((c: { id: string }) => contenedoresCache.set(c.id, true));
    cacheLoaded = true;
  } catch {
    // Sin caché: el escaneo sigue funcionando con la verificación online.
  }
}

// =============================================================================
// PROCESAR QR ESCANEADO
// =============================================================================

/** fetch con timeout manual (AbortSignal.timeout no existe en iOS 15). */
async function fetchConTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers: getAuthHeaders(), signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function mostrarNoEncontrado(mensaje: string): void {
  ui.resultSpinner.classList.add('hidden');
  ui.resultText.textContent = mensaje;
  ui.stopBtn.classList.add('hidden');
  ui.retryScanBtn.classList.remove('hidden');
}

/** Extrae el id del contenedor de cualquiera de los formatos de QR soportados. */
function extraerContenedorId(qrData: string): string | null {
  // 1) URL de contenedor: ...?contenedor=<id>
  const urlMatch = qrData.match(/[?&]contenedor=([a-f0-9-]+)/i);
  if (urlMatch) return urlMatch[1];

  // 2) JSON: {"contenedor_id": "..."} o {"id": "..."}
  try {
    const parsed = JSON.parse(qrData);
    if (parsed?.contenedor_id) return String(parsed.contenedor_id);
    if (parsed?.id) return String(parsed.id);
    return null;
  } catch {
    // 3) UUID plano
    return /^[0-9a-f-]{36}$/i.test(qrData) ? qrData : null;
  }
}

async function procesarQR(qrData: string): Promise<void> {
  if (procesando) return;
  procesando = true;

  // Se libera la cámara mientras se resuelve el contenedor (batería + LED).
  detenerCamara();
  ui.scanningState.classList.add('hidden');
  ui.resultState.classList.remove('hidden');
  ui.resultSpinner.classList.remove('hidden');
  ui.resultText.textContent = 'QR detectado. Buscando contenedor...';

  try {
    const contenedorId = extraerContenedorId(qrData);

    if (contenedorId) {
      if (contenedoresCache.has(contenedorId)) {
        ui.resultSpinner.classList.add('hidden');
        ui.resultText.textContent = '✅ Contenedor en caché. Redirigiendo...';
        window.location.href = `/contenedores/${contenedorId}`;
        return;
      }

      const res = await fetchConTimeout(`${API_BASE_URL}/contenedores/${contenedorId}/`, 3000);
      if (res.ok) {
        ui.resultSpinner.classList.add('hidden');
        ui.resultText.textContent = '✅ Contenedor encontrado. Redirigiendo...';
        window.location.href = `/contenedores/${contenedorId}`;
        return;
      }
    }

    // Compatibilidad con QR antiguos: resolver por el endpoint de escaneo.
    const res = await fetchConTimeout(
      `${API_BASE_URL}/contenedores/escanear/?qr_data=${encodeURIComponent(qrData)}`,
      5000,
    );
    if (res.ok) {
      const data = await res.json();
      if (data.contenedor?.id) {
        ui.resultSpinner.classList.add('hidden');
        ui.resultText.textContent = '✅ Contenedor encontrado. Redirigiendo...';
        window.location.href = `/contenedores/${data.contenedor.id}`;
        return;
      }
    }

    mostrarNoEncontrado('❌ No se encontró un contenedor con este código QR.');
  } catch (err) {
    console.error('Error al procesar QR:', err);
    mostrarNoEncontrado('❌ Error al procesar el código QR.');
  } finally {
    procesando = false;
  }
}

// =============================================================================
// FALLBACK: ESCANEAR DESDE UNA FOTO (cámara o galería)
// =============================================================================

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const imagen = new Image();
    imagen.onload = () => resolve(imagen);
    imagen.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
    imagen.src = src;
  });
}

async function escanearArchivo(file: File): Promise<void> {
  if (!file || procesando) return;

  detenerCamara();
  ui.scanningState.classList.add('hidden');
  ui.resultState.classList.remove('hidden');
  ui.resultSpinner.classList.remove('hidden');
  ui.resultText.textContent = 'Leyendo la imagen...';

  // objectURL en lugar de FileReader: no infla la memoria con base64 en móvil.
  const objectUrl = URL.createObjectURL(file);
  try {
    const imagen = await cargarImagen(objectUrl);
    if (!ctx) throw new Error('Canvas 2D no disponible');

    const escala = Math.min(
      1,
      DIMENSION_MAX_ESCANEO / Math.max(imagen.naturalWidth, imagen.naturalHeight),
    );
    canvas.width = Math.max(1, Math.round(imagen.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(imagen.naturalHeight * escala));
    ctx.drawImage(imagen, 0, 0, canvas.width, canvas.height);

    const datos = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // En fotos se prueban ambas inversiones (QR claro sobre fondo oscuro).
    const codigo = jsQR(datos.data, datos.width, datos.height, {
      inversionAttempts: 'attemptBoth',
    });

    if (codigo?.data) {
      await procesarQR(codigo.data);
      return;
    }
    mostrarNoEncontrado('❌ No se detectó un QR en la imagen. Probá con una foto más nítida y sin reflejos.');
  } catch (err) {
    console.error('Error al leer la imagen del QR:', err);
    mostrarNoEncontrado('❌ No se pudo leer la imagen seleccionada.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// =============================================================================
// ARRANQUE Y EVENTOS
// =============================================================================

export function initEscanerQr(): void {
  const video = refOpcional<HTMLVideoElement>('video');
  if (!video) return;

  ui = {
    noCamera: ref('noCamera'),
    cameraErrorText: ref('cameraErrorText'),
    retryCameraBtn: ref<HTMLButtonElement>('retryCameraBtn'),
    scanningState: ref('scanningState'),
    resultState: ref('resultState'),
    resultText: ref('resultText'),
    resultSpinner: ref('resultSpinner'),
    scanStatus: ref('scanStatus'),
    stopBtn: ref<HTMLButtonElement>('stopBtn'),
    stopText: ref('stopText'),
    retryScanBtn: ref<HTMLButtonElement>('retryScanBtn'),
    qrFileInput: refOpcional<HTMLInputElement>('qrFileInput'),
    video,
  };

  void precargarContenedores();

  ui.retryCameraBtn.addEventListener('click', () => void iniciarCamara());

  ui.stopBtn.addEventListener('click', () => {
    detenerCamara();
    ui.scanningState.classList.add('hidden');
    ui.resultState.classList.remove('hidden');
    ui.resultSpinner.classList.add('hidden');
    ui.resultText.textContent = '🔴 Escáner detenido.';
    ui.stopBtn.classList.add('hidden');
    ui.retryScanBtn.classList.remove('hidden');
  });

  ui.retryScanBtn.addEventListener('click', () => {
    procesando = false;
    ui.resultState.classList.add('hidden');
    ui.retryScanBtn.classList.add('hidden');
    ui.stopBtn.classList.remove('hidden');
    void iniciarCamara();
  });

  ui.qrFileInput?.addEventListener('change', (evento) => {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void escanearArchivo(file);
    input.value = '';
  });

  // iOS/Android cortan los tracks al pasar a segundo plano o al abrir la
  // cámara nativa desde el input file: al volver se reabre el feed.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || procesando || !scanning) return;
    const pistaMuerta = !stream || stream.getVideoTracks().every((t) => t.readyState === 'ended');
    if (pistaMuerta) {
      void iniciarCamara();
      return;
    }
    // El navegador pudo pausar el <video>: se reanuda sin pedir permiso de nuevo.
    if (ui.video.paused) void ui.video.play().catch(() => void iniciarCamara());
  });

  // Restauración desde bfcache (atrás/adelante en WebView).
  window.addEventListener('pageshow', (evento) => {
    if (evento.persisted) void iniciarCamara();
  });

  // Liberar la cámara SIEMPRE al salir (pagehide es fiable en iOS; beforeunload no).
  window.addEventListener('pagehide', detenerCamara);
  window.addEventListener('beforeunload', detenerCamara);

  // iniciarCamara() valida HTTPS y soporte, y muestra el error correspondiente.
  void iniciarCamara();
}
