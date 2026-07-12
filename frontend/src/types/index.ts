// =============================================================================
// TIPOS DE DATOS - Estok Inventory System
// Basados en los modelos de Django con herencia multi-tabla
// =============================================================================

// =============================================================================
// ENUMS
// =============================================================================

export type TipoObjeto = 'libro' | 'tecnologia' | 'mueble' | 'ropa' | 'objeto';

export type EstadoConservacion = 'excelente' | 'bueno' | 'regular' | 'malo' | 'muy_malo';

export type EstadoCarga = 'completo' | 'incompleto' | 'pendiente_ia';

export type OwnerAction = 'vender' | 'recuperar' | 'tirar' | null;

export type PlataformaPublicacion = 'facebook' | 'instagram' | 'mercadolibre';

// =============================================================================
// USUARIOS Y ROLES
// =============================================================================

export interface Role {
  id: string;
  name: string;
  description: string;
  can_read: boolean;
  can_write: boolean;
  can_edit: boolean;
  can_delete: boolean;
  created_at: string;
  updated_at: string;
}

export interface EstokInfo {
  id: string;
  nombre: string;
  role: string | null;
  role_id: string | null;
}

export interface User {
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  description: string;
  phone: string;
  is_active: boolean;
  date_joined: string;
  estoks: EstokInfo[];
  ultimo_estok_activo_id: string | null;
}

// =============================================================================
// ORGANIZACIÓN ESPACIAL
// =============================================================================

export interface Ubicacion {
  id: string;
  nombre: string;
  descripcion: string;
  objetos_count: number;
  created_at: string;
  updated_at: string;
}

export interface Contenedor {
  id: string;
  nombre: string;
  descripcion: string;
  ubicacion: string;
  ubicacion_nombre: string;
  qr_code_image: string | null;
  qr_code_url: string | null;
  objetos_count: number;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// OBJETOS - Modelo Base
// =============================================================================

export interface ObjetoBase {
  id: string;
  nombre: string;
  descripcion: string;
  ubicacion: string | null;
  ubicacion_nombre: string;
  contenedor: string | null;
  contenedor_nombre: string;
  estado_conservacion: EstadoConservacion;
  valor_estimado: number | null;
  color: string;
  dueno_original: string | null;
  dueno_original_nombre: string | null;
  beneficiario: string | null;
  beneficiario_nombre: string | null;
  estado_carga: EstadoCarga;
  campos_pendientes: string[];
  plataformas_publicadas: PlataformaPublicacion[];
  fecha_registro: string;
  updated_at: string;
  deleted_at: string | null;
}

// =============================================================================
// OBJETOS - Lista (vista ligera)
// =============================================================================

export interface ObjetoListItem {
  id: string;
  nombre: string;
  tipo: TipoObjeto;
  estado_conservacion: EstadoConservacion;
  valor_estimado: number | null;
  color: string;
  foto_principal: string | null;
  ubicacion_nombre: string;
  contenedor_nombre: string;
  estado_carga: EstadoCarga;
  fecha_registro: string;
  deleted_at: string | null;
  owner_action: OwnerAction;
}

// =============================================================================
// OBJETOS - Datos específicos por tipo (herencia multi-tabla)
// =============================================================================

export interface DatosLibroRevista {
  autor: string;
  edicion: string;
  anio: number | null;
  isbn_issn: string;
}

export interface DatosTecnologia {
  marca: string;
  modelo: string;
  numero_serie: string;
  peso: number | null;
  especificaciones: Record<string, unknown>;
}

export interface DatosMuebleArte {
  material: string;
  largo: number | null;
  ancho: number | null;
  alto: number | null;
  artista_fabricante: string;
}

export interface DatosRopa {
  tamano: string;
}

export type DatosEspecificos =
  | DatosLibroRevista
  | DatosTecnologia
  | DatosMuebleArte
  | DatosRopa
  | Record<string, never>;

// =============================================================================
// OBJETOS - Detalle completo
// =============================================================================

export interface FotoInfo {
  id: string;
  imagen: string;
  descripcion: string;
  es_principal: boolean;
  fecha_subida: string;
}

export interface HistorialPrecioInfo {
  valor_anterior: number | null;
  valor_nuevo: number;
  diferencia: number | null;
  porcentaje_cambio: number | null;
  motivo: string;
  fecha_cambio: string;
}

export interface ObjetoDetail extends ObjetoBase {
  tipo: TipoObjeto;
  fotos: FotoInfo[];
  datos_especificos: DatosEspecificos;
  historial_precios: HistorialPrecioInfo[];
  owner_action: OwnerAction;
}

// =============================================================================
// OBJETOS - Creación
// =============================================================================

export interface ObjetoCreatePayload {
  nombre: string;
  descripcion?: string;
  tipo: TipoObjeto;
  ubicacion?: string | null;
  contenedor?: string | null;
  estado_conservacion?: EstadoConservacion;
  valor_estimado?: number | null;
  color?: string;
  dueno_original?: string | null;
  beneficiario?: string | null;
  // LibroRevista
  autor?: string;
  edicion?: string;
  anio?: number | null;
  isbn_issn?: string;
  // Tecnologia
  marca?: string;
  modelo?: string;
  numero_serie?: string;
  peso?: number | null;
  especificaciones?: Record<string, unknown>;
  // MuebleArte
  material?: string;
  largo?: number | null;
  ancho?: number | null;
  alto?: number | null;
  artista_fabricante?: string;
  // Ropa
  tamano?: string;
}

// =============================================================================
// MULTIMEDIA
// =============================================================================

export interface FotoObjeto {
  id: string;
  objeto: string;
  imagen: string;
  descripcion: string;
  es_principal: boolean;
  fecha_subida: string;
}

// =============================================================================
// HISTORIAL DE PRECIOS
// =============================================================================

export interface HistorialPrecio {
  id: string;
  objeto: string;
  objeto_nombre: string;
  valor_anterior: number | null;
  valor_nuevo: number;
  diferencia: number | null;
  porcentaje_cambio: number | null;
  motivo: string;
  registrado_por: string | null;
  registrado_por_nombre: string | null;
  fecha_cambio: string;
}

// =============================================================================
// ALERTAS DE STOCK
// =============================================================================

export interface AlertaStock {
  id: string;
  objeto: string;
  objeto_nombre: string;
  nivel_minimo: number;
  cantidad_actual: number;
  activa: boolean;
  necesita_reposicion: boolean;
  ultima_verificacion: string;
  creada_por: string | null;
}

// =============================================================================
// RESPUESTAS DE API
// =============================================================================

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  mensaje?: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// =============================================================================
// QR
// =============================================================================

export interface QRInfo {
  contenedor_id: string;
  contenedor_nombre: string;
  qr_code_url: string | null;
  objetos_count: number;
}

export interface EscaneoQRResponse {
  contenedor: {
    id: string;
    nombre: string;
    ubicacion: string;
    qr_code_url: string | null;
  };
  objetos: ObjetoListItem[];
  total_objetos: number;
}

// =============================================================================
// CHAT INTERNO
// =============================================================================

export interface Mensaje {
  id: string;
  estok: string;
  remitente: string;
  remitente_nombre: string | null;
  remitente_username: string | null;
  contenido: string;
  leido: boolean;
  created_at: string;
}

// =============================================================================
// USUARIOS ONLINE
// =============================================================================

export interface OnlineUser {
  id: string;
  username: string;
  display_name: string;
  ultima_actividad: string;
}
