/**
 * Sistema de notificaciones Toast compartido.
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: number;
  type: ToastType;
  message: string;
}

let toastIdCounter = 0;
let toastListeners: Array<(toasts: ToastMessage[]) => void> = [];
let activeToasts: ToastMessage[] = [];

export function subscribeToasts(listener: (toasts: ToastMessage[]) => void) {
  toastListeners.push(listener);
  return () => {
    toastListeners = toastListeners.filter(l => l !== listener);
  };
}

function notifyListeners() {
  toastListeners.forEach(l => l([...activeToasts]));
}

export function showToast(type: ToastType, message: string, duration: number = 4000) {
  const id = ++toastIdCounter;
  const toast: ToastMessage = { id, type, message };
  activeToasts = [...activeToasts, toast];
  notifyListeners();

  setTimeout(() => {
    activeToasts = activeToasts.filter(t => t.id !== id);
    notifyListeners();
  }, duration);
}

export function removeToast(id: number) {
  activeToasts = activeToasts.filter(t => t.id !== id);
  notifyListeners();
}
