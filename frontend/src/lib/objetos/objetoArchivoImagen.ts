// =============================================================================
// PREPARACIÓN DE UNA FOTO DESDE UN ARCHIVO (cámara o galería del móvil)
// -----------------------------------------------------------------------------
// Único punto para convertir `File` → base64 comprimido. Lo usan el alta de
// objetos (/objetos/nuevo) y la edición (/objetos/[id]/editar).
//
// Por qué existe:
//   · iOS/Android entregan fotos de 8-25 MB; se validan ANTES de leerlas para
//     no bloquear el hilo con archivos que el backend va a rechazar.
//   · `accept="image/*"` puede devolver HEIC (iPhone). Si el canvas no puede
//     recomprimir ese formato en el navegador actual, se conserva la imagen
//     original en lugar de romper el flujo de captura (comportamiento previo).
// =============================================================================

import { comprimirImagenBase64, fileToDataURL } from '../../services/image';

/** Tope de seguridad: una foto de cámara móvil normal no supera los ~15 MB. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Valida y comprime un archivo de imagen elegido por el usuario.
 * @returns dataURL JPEG comprimido (o el original si el canvas no pudo leerlo)
 * @throws Error con mensaje listo para mostrar en un toast
 */
export async function prepararFotoDesdeArchivo(
  file: File,
  maxDimension = 1024,
  quality = 0.7,
): Promise<string> {
  if (!file) throw new Error('No se seleccionó ninguna foto.');
  if (!file.type.startsWith('image/')) {
    throw new Error('El archivo no es una imagen compatible. Usá JPG, PNG o WEBP.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('La foto es demasiado grande (máximo 25 MB).');
  }

  const dataUrl = await fileToDataURL(file);
  try {
    return await comprimirImagenBase64(dataUrl, maxDimension, quality);
  } catch (err) {
    // HEIC de iPhone: el <img> lo muestra pero algunos navegadores no lo
    // recomprimen. Se mantiene el original para no perder la captura.
    if (dataUrl.startsWith('data:image/')) {
      console.warn('No se pudo recomprimir la foto, se usa el original:', err);
      return dataUrl;
    }
    throw new Error('No se pudo procesar la imagen en este dispositivo.');
  }
}
