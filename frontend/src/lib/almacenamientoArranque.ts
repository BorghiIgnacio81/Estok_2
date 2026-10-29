// =============================================================================
// ARRANQUE DE LA PANTALLA DE ALMACENAMIENTO (orquestación de módulos)
// -----------------------------------------------------------------------------
// El <script> de pages/almacenamiento.astro sólo importa y llama a esta función.
// Acá vive la secuencia EXACTA de arranque (misma que tenía la página) para
// sostener el límite de 400 líneas del archivo de UI y dejar el orden de
// inicialización en un único lugar documentado.
//
// Orden (no alterar sin verificar):
//   1. AlmacenamientoBoard  → tablero clásico (modal editar, drag&drop de stock).
//   2. initOffsetHeaderBandeja → canasta lateral anclada BAJO el header.
//   3. Canastas            → bandeja inferior/flotante y carga fina.
//   4. Mapa Estok          → lienzo de la casa (Nivel 1).
//   5. Visores             → habitación y contenedor grande.
//   6. Modo lienzo         → ✏️ Editar / 💾 Guardar.
//   7. Portales            → máquina de niveles recursiva (al final: monta los
//                            paneles del nivel raíz sobre los hosts ya listos).
// =============================================================================

import { AlmacenamientoBoard } from './almacenamientoBoard';
import { initMapaCasita } from './mapaCasitaNavegable';
import { initVisor } from './visorHabitacion';
import { initVisorContenedorGrande } from './visorContenedorGrande';
import { initBandeja } from './bandejaSinUbicar';
import { initBandejaCargaFina } from './bandejaCargaFina';
import { iniciarPortalesAlmacenamiento } from './portalesAlmacenamiento';
import { iniciarModoLienzo } from './modoLienzo';
import { initCajaDetalle } from './cajaDetalle';
import { initOffsetHeaderBandeja } from './layout/offsetHeaderBandeja';
import { initNuevaCajaModal } from './nuevaCajaModal';

/**
 * ARRANQUE CON GARANTÍA DE DOM LISTO: el render del lienzo «Mapa Estok» se
 * enlaza dentro de DOMContentLoaded para que la silueta dibuje de inmediato el
 * Nivel 1 (divisiones raíz del Estok activo). Si el script ya corre con el DOM
 * listo (módulo deferred), se ejecuta sin esperar.
 */
function alCargarDom(accion: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => accion());
  } else {
    accion();
  }
}

export function iniciarAlmacenamiento(): void {
  alCargarDom(() => {
    const tablero = new AlmacenamientoBoard();
    void tablero.init();
    // La canasta lateral flotante arranca SIEMPRE debajo de la barra de nav.
    initOffsetHeaderBandeja();

    initBandeja({
      contenedor: document.getElementById('bandejaContenido'),
      // Responsive dual: el MISMO módulo alimenta la barra horizontal del pie.
      contenedorMovil: document.getElementById('bandejaContenidoMovil'),
      // Y también el cuadrante derecho del visor cuando el nodo activo es un
      // «Espacio Único» (ambiente sin muebles internos).
      contenedorCuadrante: document.getElementById('canastaCuadranteContenido'),
    });
    initVisorContenedorGrande({ contenedor: document.getElementById('visorContenedorGrande') });
    initMapaCasita({
      mapa: document.getElementById('mapaEstokPanel'),
      badge: document.getElementById('mapaJerarquicoBadge'),
    });
    initVisor();
    initBandejaCargaFina({ contenedor: document.getElementById('cargaFinaPanel') });
    initCajaDetalle({
      canvas: document.getElementById('cajaCanvas'),
      lista: document.getElementById('cajaObjetos'),
    });
    // Alta directa de contenedores: botón «+ Nueva Caja / Contenedor».
    initNuevaCajaModal();
    // Modo ✏️ Editar ⇄ 💾 Guardar de los planos + navegación por PORTALES.
    iniciarModoLienzo();
    iniciarPortalesAlmacenamiento();
  });
}
