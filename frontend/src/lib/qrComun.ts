// =============================================================================
// UTILIDADES COMPARTIDAS DEL ESCÁNER QR · FORMATO DEL CÓDIGO + ERRORES DE CÁMARA
// -----------------------------------------------------------------------------
// Fuente ÚNICA de las dos piezas que comparten las DOS caras del escáner:
//
//   · pages/escanear/index.astro  ─ lib/escanerQr.ts       (página completa)
//   · components/escaner/EscanerQrModal.astro ─ lib/escanerQrModal.ts (modal)
//
//  1. `extraerReferenciaQr()` entiende TODOS los formatos de QR del inventario:
//       · URL de la API que genera QRService:  …?contenedor=<uuid>
//       · URL de ficha:                        …/contenedores/<uuid> · …/objetos/<uuid>
//       · JSON: {"contenedor_id"|"objeto_id"|"id": "<uuid>"}
//       · UUID plano (compatibilidad con QR impresos antes de la URL de API)
//  2. `mensajeErrorCamara()` traduce el DOMException de getUserMedia a una
//     instrucción accionable por plataforma (nunca un "NotAllowedError" crudo).
//  3. `fetchQrConTimeout()` pide a la API con el JWT centralizado y un corte por
//     tiempo (`AbortSignal.timeout` no existe en iOS 15).
// =============================================================================

import { getAuthHeaders } from '../services/auth';

/** Entidad espacial a la que apunta un QR del inventario. */
export interface ReferenciaQr {
  tipo: 'contenedor' | 'objeto';
  id: string;
}

/** Extrae la referencia (tipo + id) de cualquier formato de QR soportado. */
export function extraerReferenciaQr(qrData: string): ReferenciaQr | null {
  const dato = (qrData || '').trim();
  if (!dato) return null;

  // 1) URL de la API: …?contenedor=<id> (formato exacto de QRService).
  const porQuery = dato.match(/[?&]contenedor=([a-f0-9-]+)/i);
  if (porQuery) return { tipo: 'contenedor', id: porQuery[1] };

  // 2) URL de ficha: …/contenedores/<id> o …/objetos/<id>.
  const porRuta = dato.match(/\/(contenedores|objetos)\/([a-f0-9-]{36})/i);
  if (porRuta) {
    return {
      tipo: porRuta[1].toLowerCase() === 'objetos' ? 'objeto' : 'contenedor',
      id: porRuta[2],
    };
  }

  // 3) JSON emitido por integraciones: contenedor_id / objeto_id / id.
  try {
    const parsed = JSON.parse(dato);
    if (parsed?.contenedor_id) return { tipo: 'contenedor', id: String(parsed.contenedor_id) };
    if (parsed?.objeto_id) return { tipo: 'objeto', id: String(parsed.objeto_id) };
    if (parsed?.id) return { tipo: 'contenedor', id: String(parsed.id) };
    return null;
  } catch {
    // 4) UUID plano: históricamente SIEMPRE fue un contenedor.
    return /^[0-9a-f-]{36}$/i.test(dato) ? { tipo: 'contenedor', id: dato } : null;
  }
}

/**
 * Id del contenedor de cualquier formato soportado (compatibilidad con la
 * página /escanear, que sólo resuelve contenedores).
 */
export function extraerContenedorId(qrData: string): string | null {
  const referencia = extraerReferenciaQr(qrData);
  return referencia && referencia.tipo === 'contenedor' ? referencia.id : null;
}

/** Traduce el DOMException de getUserMedia a una instrucción útil. */
export function mensajeErrorCamara(err: unknown): string {
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
      return 'No se pudo acceder a la cámara. Usá «Escanear desde una foto» o revisá los permisos del navegador.';
  }
}

/**
 * GET autenticado con corte por tiempo. El JWT viaja por `getAuthHeaders()`
 * (regla del proyecto: la autenticación NO se arma en cada módulo).
 */
export async function fetchQrConTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers: getAuthHeaders(), signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
