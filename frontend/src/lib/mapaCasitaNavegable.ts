// =============================================================================
// LIENZO NAVEGABLE «MAPA ESTOK» — ORQUESTADOR (Nivel Estok · casa ⇄ habitaciones)
// -----------------------------------------------------------------------------
// Reemplaza el mapa matricial con inputs numéricos por un lienzo puramente
// gráfico, táctil y EDITABLE IN-PLACE por niveles en cascada. Este archivo es
// sólo el ORQUESTADOR (estado + render + interacción + arranque); la física
// vive modularizada en ./mapaCasita/ (límite estricto < 400 líneas por archivo):
//   · estadoCasita.ts  → estado compartido (refs, divisiones, nivel activo…)
//   · dominioCasita.ts → derivaciones PURAS (plantas, habitaciones, nombres…)
//   · renderCasita.ts  → HTML de Nivel 1 (casa) y Nivel 2 (editor elástico)
//   · cargaCasita.ts   → fetch/POST/PATCH contra Ubicaciones (multi-tenant)
//
// NIVEL ESTOK INICIAL (Ignacio): la navegación NACE en el EDITOR de la planta
// activa — Panel Izquierdo = silueta perimetral de la casa con la planta
// seleccionada en NARANJA (minimapa) y Panel Derecho = Editor Elástico de
// Habitaciones (botonera + «➕ Habitación» + disyuntor «Espacio Único»).
// «⬅ Volver» regresa a la vista general de la casa (Nivel 1).
//
// Modo Planta Única (cantidad_pisos == 1): perímetro continuo SIN techo.
// =============================================================================

import { fetchEstokConfig } from './mapaJerarquico';
import { renderPlantaUnica } from './mapaPlantaUnica';
import { conectarPlantaUnica } from './plantaUnicaInteractivo';
import { adaptadorUbicaciones } from './lienzoElastico';
import { modoLienzoActual } from './modoLienzo';
// Fix de jitter visual: los refrescos asíncronos conservan la posición de scroll.
import { preservarScroll } from './scrollPreservado';
import { estado } from './mapaCasita/estadoCasita';
import {
  apartamentoDePlantaUnica,
  esPlantaUnica,
  habitacionesDePlanta,
  nombreDePlanta,
  primeraPlanta,
  roomsDePlantaUnica,
  totalPlantas,
} from './mapaCasita/dominioCasita';
import { renderCasaHtml, renderHabitacionesHtml } from './mapaCasita/renderCasita';
import {
  cargarDatos,
  crearApartamentoSiFalta,
  crearHabitacionEnPlanta,
  guardarEspacioUnicoDivision,
} from './mapaCasita/cargaCasita';

// =============================================================================
// RENDER
// =============================================================================

function render(): void {
  const { refs, estok, divisiones, habitaciones, filaActiva, nivelActual } = estado;
  if (!refs.mapa) return;

  // BIFURCACIÓN DEL MODELADOR: 1 planta → Planta Única (rectángulo perimetral
  // continuo SIN techo); más de 1 → Modo Casa (silueta con techo puntiagudo).
  if (esPlantaUnica(estok)) {
    refs.mapa.innerHTML = `<div class="casita-raiz">${renderPlantaUnica({
      apartamento: apartamentoDePlantaUnica(divisiones),
      rooms: roomsDePlantaUnica(divisiones, habitaciones),
      etiquetaCrear: 'Habitación',
    })}</div>`;
    if (refs.badge) refs.badge.textContent = `Planta Única · ${estok?.nombre || 'Departamento'}`;
    return;
  }

  const total = totalPlantas(estok, divisiones);
  const html =
    nivelActual === 1
      ? renderCasaHtml({ total, divisiones, habitaciones, filaActiva })
      : renderHabitacionesHtml({ fila: filaActiva || 1, total, divisiones, habitaciones });
  refs.mapa.innerHTML = `<div class="casita-raiz">${html}</div>`;
  if (refs.badge) {
    refs.badge.textContent =
      nivelActual === 1
        ? `Nivel 1 · ${estok?.nombre || 'Casa de Estok'}`
        : `Nivel 2 · ${nombreDePlanta(divisiones, filaActiva || 1)}`;
  }
}

/** Dispara el evento de planta seleccionada para filtrar la cascada en caliente. */
function notificarPlanta(): void {
  const { estok, divisiones, habitaciones, filaActiva } = estado;
  const div = divisiones.find((d) => d.parent_grid_row === filaActiva);
  window.dispatchEvent(
    new CustomEvent('estok:planta-seleccionada', {
      detail: {
        fila: filaActiva,
        nombre: filaActiva ? div?.nombre || nombreDePlanta(divisiones, filaActiva) : null,
        /** Total de plantas del inmueble (para la red de minimapas anidados). */
        total: totalPlantas(estok, divisiones),
        /**
         * Habitaciones REALES de la planta (geometría nativa ui_left/ui_top/
         * ui_width/ui_height): el minimapa anidado dibuja las proporciones
         * verdaderas de cada espacio, tanto en planta alta como en planta baja.
         */
        hermanas: habitacionesDePlanta(divisiones, habitaciones, filaActiva || 1),
      },
    }),
  );
}

// =============================================================================
// INTERACCIÓN (registro de estado activo + conmutación reactiva)
// =============================================================================

function enlazar(): void {
  const { refs } = estado;
  if (!refs.mapa) return;

  // Rama Planta Única: inyección libre, arrastre/resizing elástico y fusión en "L".
  if (esPlantaUnica(estado.estok)) {
    conectarPlantaUnica({
      scope: refs.mapa,
      rooms: () => roomsDePlantaUnica(estado.divisiones, estado.habitaciones),
      apartamentoId: () => apartamentoDePlantaUnica(estado.divisiones)?.id ?? null,
      asegurarApartamento: crearApartamentoSiFalta,
      notificarCambios: () => window.dispatchEvent(new CustomEvent('estok:espacios-cambiados')),
    });
    return;
  }

  // Nivel 1: clic en una planta → registra estado activo + conmuta al Nivel 2.
  refs.mapa.querySelectorAll<HTMLElement>('[data-casita-piso]').forEach((el) => {
    el.addEventListener('click', () => {
      const fila = Number(el.dataset.casitaPiso);
      if (!fila) return;
      estado.filaActiva = fila;
      estado.nivelActual = 2;
      render();
      enlazar();
      notificarPlanta();
    });
  });

  // Nivel 2: botón "⬅ Volver" → regresa a la vista general de la casa.
  refs.mapa.querySelectorAll<HTMLElement>('[data-casita-volver]').forEach((el) => {
    el.addEventListener('click', () => {
      estado.nivelActual = 1;
      render();
      enlazar();
      notificarPlanta();
    });
  });

  // Nivel 2: saltar a otra planta tocando el minimapa ultra-mini de la casita.
  refs.mapa.querySelectorAll<HTMLElement>('[data-mini-fila]').forEach((el) => {
    el.addEventListener('click', () => {
      const fila = Number(el.getAttribute('data-mini-fila'));
      if (!fila || fila === estado.filaActiva) return;
      estado.filaActiva = fila;
      render();
      enlazar();
      notificarPlanta();
    });
  });

  // Nivel 2: disyuntor canónico «Espacio Único» de la planta activa (cabecera).
  refs.mapa
    .querySelector<HTMLInputElement>('#casitaEspacioUnico')
    ?.addEventListener('change', async (e) => {
      const chk = e.currentTarget as HTMLInputElement;
      const div = estado.divisiones.find((d) => d.parent_grid_row === estado.filaActiva);
      if (!div) return;
      chk.disabled = true;
      const ok = await guardarEspacioUnicoDivision(div.id, chk.checked);
      chk.disabled = false;
      if (!ok) {
        chk.checked = !chk.checked;
        return;
      }
      div.espacio_unico = chk.checked;
      window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
    });

  // Nivel 2: clic en una habitación (rectángulo elástico) → alimenta el Visor.
  // En MODO EDICIÓN el clic edita in-place (arrastrar/estirar) y NO navega.
  // El evento viaja con las HERMANAS de la planta (geometría real ui_*) para que
  // los minimapas de orientación dibujen las proporciones verdaderas de cada una.
  refs.mapa
    .querySelectorAll<HTMLElement>('[data-lienzo-pu] .pu-celda, [data-lienzo-pu] .pu-grupo')
    .forEach((el) => {
      el.addEventListener('click', () => {
        if (modoLienzoActual() !== 'navegacion') return;
        const id = el.dataset.id;
        if (!id) return;
        const room = estado.habitaciones.find((h) => h.id === id);
        if (!room) return;
        window.dispatchEvent(
          new CustomEvent('estok:habitacion-seleccionada', {
            detail: {
              room,
              hermanas: habitacionesDePlanta(
                estado.divisiones,
                estado.habitaciones,
                estado.filaActiva || 1,
              ),
            },
          }),
        );
      });
    });

  // =========================================================================
  // MOTOR 2D ELÁSTICO UNIFICADO (plantaUnicaInteractivo.ts)
  // Mismo lienzo de rectángulos libres que las plantas: renombrar al clic,
  // arrastre/reacomodo, estiramiento por esquina y fusión en «L».
  // =========================================================================
  const div = estado.filaActiva
    ? estado.divisiones.find((d) => d.parent_grid_row === estado.filaActiva) ?? null
    : null;
  if (estado.nivelActual === 2 && div) {
    conectarPlantaUnica({
      scope: refs.mapa,
      rooms: () =>
        habitacionesDePlanta(estado.divisiones, estado.habitaciones, estado.filaActiva || 1),
      adaptador: adaptadorUbicaciones(),
      apartamentoId: () => div.id,
      crearItem: () => crearHabitacionEnPlanta(div),
      notificarCambios: () => window.dispatchEvent(new CustomEvent('estok:espacios-cambiados')),
    });
  }
}

// =============================================================================
// ENTRADA
// =============================================================================

export function initMapaCasita(opts: {
  mapa?: HTMLElement | null;
  badge?: HTMLElement | null;
}): void {
  estado.refs = { mapa: opts.mapa ?? null, badge: opts.badge ?? null };
  estado.primeraCarga = true;
  if (!estado.refs.mapa) return;

  // Estado inicial de arranque: la casa se pinta de forma SÍNCRONA (el lienzo
  // nunca queda vacío) y, al llegar los datos reales del Estok activo, el Nivel
  // Estok aterriza en el EDITOR de la planta activa (ver aterrizarNivelEstok).
  estado.filaActiva = null;
  estado.nivelActual = 1;
  pintarCasaInicial();

  // Carga asíncrona de las macro-divisiones del Estok activo. Si el fetch falla
  // de forma transitoria (p. ej. sesión restaurándose), se reintenta SIN que el
  // lienzo quede vacío: la casa ya quedó pintada por defecto.
  void cargarConReintentos();

  // Refresco en vivo ante mutaciones externas (edición in-place del lienzo,
  // movimientos/eliminaciones): se recarga SIN re-enlazar controles fijos.
  window.addEventListener('estok:espacios-cambiados', () => {
    void cargarYRefrescar();
  });
}

/** Pinta el Nivel 1 (casa) de forma síncrona e inmediata con los datos actuales. */
function pintarCasaInicial(): void {
  render();
  enlazar();
}

/**
 * Aterrizaje del Nivel Estok inicial: en Modo Casa, la PRIMERA carga con datos
 * reales deja al usuario en el EDITOR de la planta activa — panel izquierdo =
 * silueta de la casa con la planta seleccionada en NARANJA (minimapa) y panel
 * derecho = Editor Elástico de Habitaciones («➕ Habitación» + botonera +
 * disyuntor «Espacio Único»). En Modo Planta Única no aplica.
 */
function aterrizarNivelEstok(): void {
  if (esPlantaUnica(estado.estok) || estado.divisiones.length === 0) return;
  estado.filaActiva = primeraPlanta(estado.divisiones);
  estado.nivelActual = 2;
}

/** Carga config del Estok + divisiones/habitaciones y re-renderiza. */
async function cargarYRefrescar(): Promise<boolean> {
  const conf = await fetchEstokConfig();
  if (!conf) return false;
  estado.estok = conf;
  await cargarDatos();
  if (estado.primeraCarga) {
    estado.primeraCarga = false;
    aterrizarNivelEstok();
  }
  // El re-render del lienzo NO debe mover el scroll del navegador (fix de jitter
  // visual): se reafirma la posición vigente tras inyectar el marcado nuevo.
  preservarScroll(() => {
    render();
    enlazar();
  });
  notificarPlanta();
  return true;
}

/** Reintentos acotados ante fallos transitorios de la inicialización. */
async function cargarConReintentos(intentosMax = 6, esperaMs = 700): Promise<void> {
  for (let intento = 1; intento <= intentosMax; intento++) {
    if (await cargarYRefrescar()) return;
    await new Promise((resolve) => setTimeout(resolve, esperaMs));
  }
  if (estado.refs.badge) estado.refs.badge.textContent = 'Nivel 1 · Sin datos';
}
