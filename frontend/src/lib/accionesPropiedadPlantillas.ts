// =============================================================================
// ACCIONES PRINCIPALES DE LA PROPIEDAD (cabecera de /almacenamiento)
// -----------------------------------------------------------------------------
// La cabecera del Panel Derecho y la del Panel Izquierdo («🏠 Mapa Estok»)
// declaran DOS acciones donde antes vivía un único botón «✏️ Editar»:
//
//   [data-usar-plantilla] → «⚡ Usar plantilla»: abre el Generador Visual
//                           Espacial 2D del Nivel 1 (conteo de ambientes ➔ 4
//                           maquetas ➔ alta real de las habitaciones en la
//                           planta y repintado del lienzo).
//   [data-modo-editar]    → «🛠️ Crear desde cero»: editor manual en blanco
//                           (modo edición in-place). NO se enlaza acá: lo
//                           atiende la DELEGACIÓN de lib/modoLienzo.ts, que
//                           también conmuta «💾 Guardar» a cualquier profundidad.
//
// Si la cascada está dentro de una habitación/mueble/caja, «Usar plantilla»
// vuelve primero a la raíz (propiedad) para que la inserción y el lienzo que ve
// el operador sean el mismo nivel.
// =============================================================================

import { abrirPlantillasPropiedad } from './mapaCasita/plantillasPropiedad';
import { profundidad } from './mapa/portales/estadoPortales';
import { volverARaiz } from './portalesAlmacenamiento';
import { showToast } from './toast';

const SEL_USAR_PLANTILLA = '[data-usar-plantilla]';

/** Apertura del asistente con guardia de doble clic mientras se resuelve. */
async function usarPlantilla(boton: HTMLButtonElement): Promise<void> {
  if (boton.dataset.ocupado === '1') return;
  boton.dataset.ocupado = '1';
  boton.disabled = true;
  try {
    if (profundidad() > 0) await volverARaiz();
    if (!abrirPlantillasPropiedad()) {
      showToast('🌱 Creá o elegí una planta del Estok antes de usar una plantilla.', 'error');
    }
  } finally {
    boton.disabled = false;
    delete boton.dataset.ocupado;
  }
}

/**
 * Enlaza la acción «⚡ Usar plantilla» de las barras de comandos de la propiedad
 * (panel izquierdo «🏠 Mapa Estok» y encabezado derecho). Idempotente: no
 * duplica listeners si se vuelve a invocar.
 */
export function initAccionesPropiedad(): void {
  document.querySelectorAll<HTMLButtonElement>(SEL_USAR_PLANTILLA).forEach((boton) => {
    if (boton.dataset.enlazado === '1') return;
    boton.dataset.enlazado = '1';
    boton.addEventListener('click', () => {
      void usarPlantilla(boton);
    });
  });
}
