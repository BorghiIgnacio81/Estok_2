// =============================================================================
// CÁMARA DEL ESCÁNER QR · getUserMedia + bucle de decodificación jsQR
// -----------------------------------------------------------------------------
// Módulo REUTILIZABLE (no conoce el dominio ni el modal): recibe un <video> y un
// callback, y entrega el TEXTO del primer QR que logre decodificar.
//
//   · Cámara trasera con `facingMode: ideal` (en escritorio sin cámara trasera
//     no rompe el pedido) y reintento simple para Android antiguos.
//   · jsQR EMPAQUETADO (import, no CDN): funciona offline y en la PWA/TWA.
//   · Cada frame se reescala a 640 px y se limita a ~8 lecturas/s: jsQR es O(n²)
//     en píxeles y con frames 1080p la cámara "se traba" en móviles modestos.
//   · Al decodificar se LIBERA la cámara antes del callback (batería + LED).
//   · `escanearArchivo()` decodifica una foto de cámara/galería con el mismo
//     jsQR: fallback cuando el navegador/WebView bloquea getUserMedia.
// =============================================================================

import jsQR from 'jsqr';
import { mensajeErrorCamara } from './qrComun';

/** Lado máximo del frame que se pasa a jsQR (más píxeles = menos fps). */
const DIMENSION_MAX_ESCANEO = 640;
/** Intervalo mínimo entre lecturas: ~8 fps, suficiente para un QR en pantalla. */
const INTERVALO_ESCANEO_MS = 120;

/** Resultado de intentar abrir la cámara (nunca lanza: el modal muestra el aviso). */
export type ResultadoCamara = { ok: true } | { ok: false; mensaje: string };

/** Cara pública de la cámara del escáner. */
export interface CamaraQr {
  /** Pide permiso, abre el feed y arranca el bucle de decodificación. */
  iniciar(): Promise<ResultadoCamara>;
  /** Corta el bucle y libera los tracks (idempotente). */
  detener(): void;
  /** ¿Sigue escaneando en vivo? */
  estaActiva(): boolean;
  /** Decodifica un QR desde un archivo de imagen (cámara o galería). */
  escanearArchivo(file: File): Promise<string | null>;
}

/** Imagen ya cargada desde un objectURL. */
function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const imagen = new Image();
    imagen.onload = () => resolve(imagen);
    imagen.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
    imagen.src = src;
  });
}

/**
 * Crea la cámara asociada a un `<video>`.
 *
 * @param video         Elemento donde se pinta el feed en vivo.
 * @param alDecodificar Callback con el texto del QR (la cámara ya está cerrada).
 */
export function crearCamaraQr(
  video: HTMLVideoElement,
  alDecodificar: (texto: string) => void,
): CamaraQr {
  let stream: MediaStream | null = null;
  let frameId: number | null = null;
  let activa = false;
  let ultimoEscaneo = 0;

  // Un solo canvas reutilizado (crear uno por frame genera basura en móvil).
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  async function pedirStream(): Promise<MediaStream> {
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

  function detener(): void {
    activa = false;
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    video.srcObject = null;
  }

  function bucle(): void {
    activa = true;
    ultimoEscaneo = 0;

    const tick = (): void => {
      if (!activa) return;
      // rAF se pausa solo en segundo plano: no consume batería con la app oculta.
      frameId = requestAnimationFrame(tick);

      if (!ctx || document.hidden) return;
      if (video.readyState < 2 || !video.videoWidth) return;

      const ahora = performance.now();
      if (ahora - ultimoEscaneo < INTERVALO_ESCANEO_MS) return;
      ultimoEscaneo = ahora;

      const escala = Math.min(
        1,
        DIMENSION_MAX_ESCANEO / Math.max(video.videoWidth, video.videoHeight),
      );
      const ancho = Math.max(1, Math.round(video.videoWidth * escala));
      const alto = Math.max(1, Math.round(video.videoHeight * escala));

      if (canvas.width !== ancho) canvas.width = ancho;
      if (canvas.height !== alto) canvas.height = alto;

      ctx.drawImage(video, 0, 0, ancho, alto);
      const datos = ctx.getImageData(0, 0, ancho, alto);
      // attemptBoth: tolera QR invertidos (claro sobre fondo oscuro).
      const codigo = jsQR(datos.data, datos.width, datos.height, {
        inversionAttempts: 'attemptBoth',
      });

      if (codigo?.data) {
        detener(); // libera la cámara ANTES de procesar (batería + LED apagado)
        alDecodificar(codigo.data);
      }
    };

    frameId = requestAnimationFrame(tick);
  }

  async function iniciar(): Promise<ResultadoCamara> {
    detener();

    if (!window.isSecureContext) {
      return {
        ok: false,
        mensaje: 'La cámara requiere HTTPS. Abrí Estok desde https://eeestok.duckdns.org o escaneá desde una foto.',
      };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, mensaje: 'Este navegador no expone la cámara. Usá «Escanear desde una foto».' };
    }

    try {
      stream = await pedirStream();
      video.srcObject = stream;
      // iOS exige muted + playsinline (ya están en el markup) para reproducir el
      // feed DENTRO del modal en lugar de abrir el reproductor nativo.
      await video.play();
      bucle();
      return { ok: true };
    } catch (err) {
      detener();
      return { ok: false, mensaje: mensajeErrorCamara(err) };
    }
  }

  async function escanearArchivo(file: File): Promise<string | null> {
    detener();
    if (!ctx) return null;

    // objectURL en lugar de FileReader: no infla la memoria con base64 en móvil.
    const objectUrl = URL.createObjectURL(file);
    try {
      const imagen = await cargarImagen(objectUrl);
      const escala = Math.min(
        1,
        DIMENSION_MAX_ESCANEO / Math.max(imagen.naturalWidth, imagen.naturalHeight),
      );
      canvas.width = Math.max(1, Math.round(imagen.naturalWidth * escala));
      canvas.height = Math.max(1, Math.round(imagen.naturalHeight * escala));
      ctx.drawImage(imagen, 0, 0, canvas.width, canvas.height);

      const datos = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const codigo = jsQR(datos.data, datos.width, datos.height, {
        inversionAttempts: 'attemptBoth',
      });
      return codigo?.data ?? null;
    } catch (err) {
      console.error('Error al leer la imagen del QR:', err);
      return null;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return { iniciar, detener, estaActiva: () => activa, escanearArchivo };
}
