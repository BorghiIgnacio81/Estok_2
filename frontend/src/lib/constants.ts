/**
 * Constantes compartidas para el frontend.
 */

export const COLORS = {
  primary: '#2563eb',
  secondary: '#64748b',
  success: '#16a34a',
  danger: '#dc2626',
  warning: '#d97706',
  info: '#0891b2',
} as const;

export const ESTADO_CONSERVACION = [
  { value: 'excelente', label: 'Excelente', color: 'green' },
  { value: 'bueno', label: 'Bueno', color: 'blue' },
  { value: 'regular', label: 'Regular', color: 'yellow' },
  { value: 'malo', label: 'Malo', color: 'orange' },
  { value: 'deteriorado', label: 'Deteriorado', color: 'red' },
] as const;

export const ESTADO_CARGA = [
  { value: 'completo', label: 'Completo', color: 'green' },
  { value: 'incompleto', label: 'Incompleto', color: 'yellow' },
  { value: 'pendiente', label: 'Pendiente', color: 'red' },
] as const;

export const TIPOS_OBJETO = [
  { value: 'objeto', label: 'Objeto Genérico', icon: '📦' },
  { value: 'libro', label: 'Libro/Revista', icon: '📚' },
  { value: 'tecnologia', label: 'Tecnología', icon: '💻' },
  { value: 'mueble', label: 'Mueble/Arte', icon: '🪑' },
  { value: 'ropa', label: 'Ropa', icon: '👕' },
] as const;

export const PLATAFORMAS_PUBLICACION = [
  { value: 'facebook', label: 'Facebook', icon: '📘' },
  { value: 'instagram', label: 'Instagram', icon: '📸' },
  { value: 'mercadolibre', label: 'MercadoLibre', icon: '🛒' },
] as const;
