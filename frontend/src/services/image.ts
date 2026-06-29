/**
 * Servicio de utilidades para procesamiento de imágenes en el frontend.
 * Centraliza funciones de compresión, conversión y manipulación de imágenes.
 */

/**
 * Comprime una imagen en base64 reduciendo su resolución y calidad.
 * @param base64 - Cadena base64 de la imagen (con o sin prefijo data:image/...)
 * @param maxDimension - Dimensión máxima en píxeles (ancho o alto, el que sea mayor)
 * @param quality - Calidad JPEG (0.0 a 1.0)
 * @returns Promise con la imagen comprimida en base64 (con prefijo data:image/jpeg;base64,...)
 */
export function comprimirImagenBase64(
  base64: string,
  maxDimension = 1024,
  quality = 0.7
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Calcular nuevas dimensiones manteniendo aspect ratio
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      // Renderizar en canvas con las nuevas dimensiones
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);

      // Exportar como JPEG comprimido
      const compressed = canvas.toDataURL('image/jpeg', quality);

      // Log de tamaño para diagnóstico
      const originalBytes = Math.round((base64.length * 3) / 4);
      const compressedBytes = Math.round((compressed.length * 3) / 4);
      console.log(
        `[comprimirImagen] ${originalBytes > 1024 ? Math.round(originalBytes / 1024) + 'KB' : originalBytes + 'B'} → ${compressedBytes > 1024 ? Math.round(compressedBytes / 1024) + 'KB' : compressedBytes + 'B'} (${width}x${height} @${Math.round(quality * 100)}%)`
      );

      resolve(compressed);
    };
    img.onerror = () => reject(new Error('Error al cargar la imagen para compresión'));
    img.src = base64;
  });
}

/**
 * Convierte un File a DataURL (base64).
 * @param file - Archivo a convertir
 * @returns Promise con la cadena base64
 */
export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Error al leer el archivo'));
    reader.readAsDataURL(file);
  });
}

/**
 * Convierte una cadena base64 a un Blob.
 * @param base64 - Cadena base64 (con o sin prefijo data:)
 * @param mimeType - Tipo MIME del blob resultante
 * @returns Blob con los datos de la imagen
 */
export function base64ToBlob(base64: string, mimeType: string = 'image/jpeg'): Blob {
  // Extraer solo la parte base64 si tiene prefijo data:
  const base64Data = base64.includes('base64,')
    ? base64.split('base64,')[1]
    : base64;

  const byteChars = atob(base64Data);
  const byteArrays: BlobPart[] = [];

  for (let offset = 0; offset < byteChars.length; offset += 512) {
    const slice = byteChars.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }

  return new Blob(byteArrays, { type: mimeType });
}
