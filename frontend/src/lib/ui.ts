/**
 * Helpers de UI compartidos (loading, error, empty states).
 */

export type LoadingState = 'loading' | 'error' | 'empty' | 'success';

export interface AsyncState<T> {
  status: LoadingState;
  data: T | null;
  error: string | null;
}

export function createInitialState<T>(): AsyncState<T> {
  return { status: 'loading', data: null, error: null };
}

export function handleApiError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Error desconocido';
}

/**
 * Renderiza un indicador de carga.
 */
export function renderLoading(container: HTMLElement, message = 'Cargando...') {
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center py-12">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
      <p class="text-gray-500">${message}</p>
    </div>
  `;
}

/**
 * Renderiza un estado de error.
 */
export function renderError(container: HTMLElement, message: string, onRetry?: () => void) {
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center py-12">
      <div class="text-red-500 text-5xl mb-4">⚠️</div>
      <p class="text-red-600 font-medium mb-2">Error</p>
      <p class="text-gray-500 text-sm mb-4">${message}</p>
      ${onRetry ? '<button class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700" id="retry-btn">Reintentar</button>' : ''}
    </div>
  `;
  if (onRetry) {
    container.querySelector('#retry-btn')?.addEventListener('click', onRetry);
  }
}

/**
 * Renderiza un estado vacío.
 */
export function renderEmpty(container: HTMLElement, message = 'No hay elementos para mostrar') {
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center py-12">
      <div class="text-gray-300 text-5xl mb-4">📭</div>
      <p class="text-gray-500">${message}</p>
    </div>
  `;
}
