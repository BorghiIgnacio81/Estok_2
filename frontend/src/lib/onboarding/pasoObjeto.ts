// =============================================================================
// PASO 4 DEL ASISTENTE — ORQUESTADOR DEL FORMULARIO COMPLETO DE OBJETO
// -----------------------------------------------------------------------------
// Prende el VERDADERO formulario modular de /objetos/nuevo (components/objetos)
// inicializando los MISMOS módulos que pages/objetos/nuevo.astro, en el orden del
// ciclo de vida del DOM:
//   · objetoCamara           → cámara/galería/drag&drop + galería multi-foto.
//   · objetoAutocompletarIa   → botón IA (Gemini) + health-check + mapeo de campos.
//   · objetoIaSegundaFoto     → segunda foto (ISBN de libros).
//   · objetoMercadoLibre      → cotización de referencia en pesos (Mercado Libre AR).
//   · objetoCatalogos         → catálogos + alta rápida de espacios.
//   · objetoFormCore          → persistencia, validación y envío (multipart).
//
// TOOLTIPS EDUCATIVOS: al ser una sección tutorial, se inyectan burbujas .tooltip
// (CSS en components/onboarding/ObjetoFormTutorial.astro, acotadas a
// html[data-estok-onboarding]) en los elementos clave de la Fase 4: el botón de
// Gemini IA, la búsqueda de precio en Mercado Libre, los minimapas y el legado
// (dueño original).
//
// Idempotente: todos los módulos se inicializan UNA sola vez por sesión.
// =============================================================================

import { initObjetoCamara } from '../objetos/objetoCamara';
import { initObjetoAutocompletarIa } from '../objetos/objetoAutocompletarIa';
import { initObjetoIaSegundaFoto } from '../objetos/objetoIaSegundaFoto';
import { initObjetoMercadoLibre } from '../objetos/objetoMercadoLibre';
import { initObjetoCatalogos } from '../objetos/objetoCatalogos';
import { initObjetoFormCore } from '../objetos/objetoFormCore';

/** Tooltip educativo: dónde engancharlo y qué texto muestra al hover/toque. */
interface TooltipTutorial {
  /** Selector del control canónico dentro del formulario real. */
  selector: string;
  /** Texto de la burbuja (atributo data-tip). */
  texto: string;
  /** Ancla la burbuja a la tarjeta contenedora en vez del control (selects). */
  anclarTarjeta?: boolean;
}

const TOOLTIPS_TUTORIAL: TooltipTutorial[] = [
  {
    selector: '[data-ia-boton="fotos"]',
    texto:
      '✨ Gemini analizará tu foto para rellenar el nombre, descripción y estado automáticamente.',
  },
  {
    selector: '#estimarPrecioBtn',
    texto:
      '🇦🇷 Cotiza el valor real de referencia en Mercado Libre Argentina adaptado al estado del ítem.',
  },
  {
    selector: '#minimapaSelectorRaiz',
    texto:
      '🗺️ Toca la ruta para visualizar de forma interactiva dónde guardarás físicamente el objeto.',
  },
  {
    selector: '#dueno_original',
    texto:
      '🗳️ Si el dueño no usa la app o falleció, se abrirá una votación democrática (Alerta FOMO) en el inquilinato.',
    anclarTarjeta: true,
  },
];

/** Inyecta la clase .tooltip + data-tip en los elementos clave de la Fase 4. */
function inyectarTooltipsTutorial(): void {
  for (const { selector, texto, anclarTarjeta } of TOOLTIPS_TUTORIAL) {
    const control = document.querySelector<HTMLElement>(selector);
    if (!control) continue;
    // Los <select> no admiten pseudoelementos ::after: se ancla a su tarjeta.
    const objetivo =
      anclarTarjeta ? control.closest<HTMLElement>('.bg-white') ?? control : control;
    if (objetivo.classList.contains('tooltip')) continue;
    objetivo.classList.add('tooltip');
    objetivo.dataset.tip = texto;
    // Móvil: al tocar, la burbuja queda visible unos segundos (los controles no
    // siempre reciben foco táctil; así se garantiza el gesto de descubrimiento).
    objetivo.addEventListener('click', () => {
      objetivo.classList.add('tooltip-visible');
      window.setTimeout(() => objetivo.classList.remove('tooltip-visible'), 3500);
    });
  }
}

let iniciado = false;

/**
 * Prende el Paso 4 completo (formulario modular real de /objetos/nuevo).
 * Idempotente: los módulos se inicializan UNA sola vez por sesión del asistente.
 */
export function iniciarPaso4Tutorial(): void {
  if (iniciado) return;
  iniciado = true;
  initObjetoCamara();
  initObjetoAutocompletarIa();
  initObjetoIaSegundaFoto();
  initObjetoMercadoLibre();
  initObjetoCatalogos();
  initObjetoFormCore();
  inyectarTooltipsTutorial();
}
