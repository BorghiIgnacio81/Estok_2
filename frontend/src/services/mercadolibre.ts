import { API_BASE_URL, getAuthHeaders, getToken } from './auth';

export interface PublicarMLParams {
  objetoId: number | string;
  titulo: string;
  precio: number;
  descripcion: string;
  /**
   * Foto elegida en el modal. Debe ser una URL pública absoluta
   * (https://eeestok.duckdns.org/media/...): Mercado Libre descarga la imagen.
   * Si se omite, el backend usa las fotos guardadas del objeto.
   */
  fotoUrl?: string;
}

export interface DiagnosticoPublicacionML {
  /** Respuesta cruda de Mercado Libre (status 400/422). */
  error_ml: unknown;
  /** JSON exacto que el backend envió a POST /items. */
  payload_enviado: unknown;
  /** Atributos que el backend detectó en la categoría (required/catalog/identidad). */
  atributos_detectados_categoria: unknown;
  categoria_ml?: string;
  intentos_ml?: number;
}

/**
 * Error de publicación con el diagnóstico completo adjunto.
 *
 * La UI puede leer `diagnostico` para mostrar el payload exacto y la respuesta
 * de Mercado Libre sin perder información al convertir el error a string.
 */
export class MercadoLibreError extends Error {
  diagnostico: DiagnosticoPublicacionML;

  constructor(message: string, diagnostico: DiagnosticoPublicacionML) {
    super(message);
    this.name = 'MercadoLibreError';
    this.diagnostico = diagnostico;
  }
}

/**
 * Publica un objeto en Mercado Libre.
 *
 * La CATEGORÍA NO se resuelve acá: el backend es la única autoridad y usa el
 * mapeo real `Categoria.mercadolibre_category_id` (prediciendo con el NOMBRE de
 * la categoría si falta y persistiéndolo). Antes se predecía en el navegador con
 * el TÍTULO del anuncio, lo que desviaba publicaciones a categorías absurdas.
 */
export async function publicarEnMercadoLibre(params: PublicarMLParams) {
  const token = getToken();
  if (!token) throw new Error("No hay sesión activa.");

  const body = {
    objeto_id: params.objetoId,
    title: params.titulo,
    price: params.precio,
    description: params.descripcion,
    currency_id: 'ARS',
    ...(params.fotoUrl && { foto_url: params.fotoUrl }),
  };

  const response = await fetch(`${API_BASE_URL}/mercadolibre/publicar_item/`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    // Detalle específico devuelto por el backend a partir de la respuesta de
    // Mercado Libre: `causes` (arreglo `cause` crudo de ML), `campos_invalidos`
    // y `campos_faltantes`.
    const causas: string[] = Array.isArray(result.causes)
      ? result.causes
          .map((c: any) => {
            const mensaje = String(c?.message ?? '').trim();
            const codigo = String(c?.code ?? '').trim();
            return mensaje ? (codigo ? `${codigo}: ${mensaje}` : mensaje) : codigo;
          })
          .filter((texto: string) => texto.length > 0)
      : [];
    const campos: string[] = [
      ...(result.campos_invalidos ?? []),
      ...(result.campos_faltantes ?? []),
    ];
    const detalle = campos.length
      ? ` [${campos.join(', ')}]`
      : causas.length
        ? ` (${causas.join('; ')})`
        : Array.isArray(result.detalles) && result.detalles.length
          ? ` (${result.detalles.join('; ')})`
          : '';
    const base = result.error || result.detail || result.ml_response?.message
      || `Error (${response.status})`;
    // Diagnóstico TRANSPARENTE: el backend devuelve el payload exacto enviado a
    // ML, la respuesta cruda y los atributos detectados de la categoría.
    const diagnostico: DiagnosticoPublicacionML = {
      error_ml: result.error_ml ?? result.ml_response ?? null,
      payload_enviado: result.payload_enviado ?? null,
      atributos_detectados_categoria:
        result.atributos_detectados_categoria ?? [],
      categoria_ml: result.categoria_ml,
      intentos_ml: result.intentos_ml,
    };
    // Queda entero en la consola del navegador (F12), sin truncar.
    console.error(
      '[Mercado Libre] Publicación rechazada. Diagnóstico completo:',
      JSON.parse(JSON.stringify(diagnostico)),
    );
    throw new MercadoLibreError(`${base}${detalle}`, diagnostico);
  }

  return result;
}

// =============================================================================
// CONTROL DE VINCULACIÓN OMNICANAL (Mercado Libre)
// Estado de conexión, URL de OAuth y desconexión.
// Todas las llamadas usan getAuthHeaders(): inyecta JWT + X-Estok-Id del
// inquilinato activo para mantener el aislamiento multi-tenant estricto.
// =============================================================================

export interface EstadoMercadoLibre {
  conectado: boolean;
  ml_user_id?: string | number;
  nickname?: string;
  nombre?: string;
  apellido?: string;
  email?: string;
  error?: string;
}

/** GET /api/mercadolibre/status/ → estado de la cuenta ML vinculada. */
export async function obtenerEstadoML(): Promise<EstadoMercadoLibre> {
  const response = await fetch(`${API_BASE_URL}/mercadolibre/status/`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

/** GET /api/mercadolibre/auth-url/ → URL de OAuth para conectar la cuenta. */
export async function obtenerAuthUrlML(): Promise<{ auth_url: string }> {
  const response = await fetch(`${API_BASE_URL}/mercadolibre/auth-url/`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

/** DELETE /api/mercadolibre/disconnect/ → desvincula la cuenta ML del usuario. */
export async function desconectarCuentaML(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/mercadolibre/disconnect/`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

// =============================================================================
// ESTADO REAL DE LAS PUBLICACIONES (sentido Mercado Libre → Estok)
// -----------------------------------------------------------------------------
// GET /items/{id} en el backend y persistencia del status real: si la
// publicación fue pausada, finalizada o eliminada desde la web de Mercado
// Libre, Estok deja de mostrarla como «Publicado listo para vender».
// =============================================================================

/** Estado canónico de una publicación (contrato del backend). */
export interface EstadoPublicacionML {
  item_id: string;
  /** Status NATIVO de Mercado Libre: 'active' | 'paused' | 'closed'. */
  status: string;
  /** Estado canónico de la UI. */
  estado: 'publicado' | 'pausada' | 'finalizada' | 'sin_publicar';
  /** Etiqueta legible ('Publicado' / 'Pausada' / 'Finalizada' / 'Sin publicar'). */
  label: string;
  /** True sólo si existe publicación y NO está finalizada. */
  publicado: boolean;
  /** True sólo si Mercado Libre la reporta 'active'. */
  activa: boolean;
  /** Enlace externo vigente (null si ya no está activo). */
  url: string | null;
  permalink: string;
  /** Advertencia lista para mostrar ('' cuando la publicación está OK). */
  aviso: string;
  verificado_en: string | null;
  /** True si esta verificación cambió el estado guardado. */
  cambiado?: boolean;
  /** Objeto al que pertenece la publicación (sincronización en lote). */
  objeto_id?: string;
}

export interface SincronizacionEstadosML {
  verificados: number;
  actualizados: number;
  items: EstadoPublicacionML[];
  /** Sólo en la verificación de un objeto puntual. */
  estado?: EstadoPublicacionML;
  /**
   * Resumen de la pasada por los ítems REALES del vendedor
   * (GET /users/{user_id}/items/search + multi-get /items). Es la que asocia
   * las publicaciones de catálogo (UP) con su permalink vigente.
   */
  vendedor?: ResumenItemsVendedor;
}

/** Ítems del vendedor leídos en Mercado Libre y publicaciones actualizadas. */
export interface ResumenItemsVendedor {
  vendedores: number;
  items_vendedor: number;
  /** Permalinks guardadas/actualizadas (la URL que abre «Ver publicación»). */
  permalinks_actualizados: number;
  estados_actualizados: number;
  items: Array<{
    objeto_id: string;
    item_id: string;
    permalink: string;
    status: string;
    permalink_actualizada: boolean;
    estado_actualizado: boolean;
  }>;
}

export interface OpcionesSincronizacionML {
  /** Verifica SOLO este objeto (ficha del objeto). */
  objetoId?: number | string;
  /** Ignora la ventana de 5 minutos entre consultas. */
  forzar?: boolean;
}

/**
 * POST /api/mercadolibre/sincronizar_estados/
 *
 * Sin `objetoId` verifica en lote las publicaciones del Estok activo (tope de
 * 12 por llamada); con `objetoId` verifica sólo esa publicación.
 */
export async function sincronizarEstadosML(
  opciones: OpcionesSincronizacionML = {},
): Promise<SincronizacionEstadosML> {
  const body: Record<string, unknown> = {};
  if (opciones.objetoId !== undefined && opciones.objetoId !== null) {
    body.objeto_id = opciones.objetoId;
  }
  if (opciones.forzar) body.forzar = true;

  const response = await fetch(`${API_BASE_URL}/mercadolibre/sincronizar_estados/`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

// =============================================================================
// PAUSAR / REACTIVAR UNA PUBLICACIÓN (sentido Estok → Mercado Libre)
// =============================================================================

/** Estado NATIVO de Mercado Libre que fija el botón de acción rápida. */
export type EstadoNativoPublicacionML = 'paused' | 'active';

export interface RespuestaCambioEstadoML {
  success: boolean;
  estado: EstadoPublicacionML;
  mensaje?: string;
  error?: string;
}

/**
 * POST /api/mercadolibre/cambiar_estado/
 *
 * El backend ejecuta la llamada real a Mercado Libre
 * (PUT /items/{item_id} {"status": "paused" | "active"}), persiste el estado
 * que devuelve la API y responde con el MISMO contrato de `EstadoPublicacionML`
 * que usa el resto del tablero: la insignia de la tarjeta y el bloque de la
 * ficha se repintan sin recargar la página.
 *
 * Lanza un Error con el mensaje del backend si Mercado Libre rechaza la
 * operación (publicación finalizada, cuenta desconectada, ítem inexistente…),
 * para que la UI pueda avisar sin inventar el motivo.
 */
export async function cambiarEstadoPublicacionML(
  objetoId: number | string,
  estado: EstadoNativoPublicacionML,
): Promise<EstadoPublicacionML> {
  const response = await fetch(`${API_BASE_URL}/mercadolibre/cambiar_estado/`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ objeto_id: objetoId, estado }),
  });

  const datos: Partial<RespuestaCambioEstadoML> = await response
    .json()
    .catch(() => ({}));

  if (!response.ok || !datos?.success || !datos.estado) {
    throw new Error(
      String(
        datos?.error
          || datos?.mensaje
          || `No se pudo cambiar el estado de la publicación (HTTP ${response.status}).`,
      ),
    );
  }
  return datos.estado;
}

