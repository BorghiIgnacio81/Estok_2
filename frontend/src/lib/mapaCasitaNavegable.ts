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
// NIVEL ESTOK INICIAL (Ignacio · fuelle asimétrico): la navegación NACE en el
// PLANO GENERAL — Panel Izquierdo = silueta perimetral de la casa con la planta
// seleccionada en NARANJA (ancla RÍGIDA: nunca desciende) y Panel Derecho =
// EDITOR ELÁSTICO de Habitaciones (botonera + «➕ Habitación» + disyuntor
// «Espacio Único» + arrastre/fusión). «⬅ Volver» suelta la planta y la derecha
// regresa al estado de espera.
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
// Host DOM EXCLUSIVO del Panel Derecho (fuente única de los ids de panel).
import { HOSTS } from './mapa/portales/panelesPortales';
import {
  apartamentoDePlantaUnica,
  esPlantaUnica,
  habitacionesDePlanta,
  nombreDePlanta,
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
  const { refs, estok, divisiones, habitaciones, filaActiva } = estado;
  if (!refs.mapa) return;

  // PANEL IZQUIERDO — ANCLA RÍGIDA: SIEMPRE el plano general del Estok.
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
  // El plano general NO cambia al elegir planta: sólo se resalta la planta activa
  // en NARANJA (`casita-piso-activo`). El editor de habitaciones viaja SIEMPRE al
  // Panel Derecho → el espejo de raíz es estructuralmente imposible.
  refs.mapa.innerHTML = `<div class="casita-raiz">${renderCasaHtml({
    total,
    divisiones,
    habitaciones,
    filaActiva,
  })}</div>`;
  if (refs.badge) {
    refs.badge.textContent = filaActiva
      ? `Nivel 2 · ${nombreDePlanta(divisiones, filaActiva)}`
      : `Nivel 1 · ${estok?.nombre || 'Casa de Estok'}`;
  }

  // PANEL DERECHO — EDITOR ELÁSTICO DE HABITACIONES de la planta activa.
  if (filaActiva) montarEditorHabitacionesDerecha();
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
// PANEL DERECHO · EDITOR ELÁSTICO DE HABITACIONES (fuelle asimétrico)
// =============================================================================

/**
 * MONTA EL EDITOR DE HABITACIONES EN EL PANEL DERECHO (host `listaHabitacionesPanel`).
 *
 * Con una planta activa, la IZQUIERDA queda RÍGIDA en el plano general y acá vive
 * la interfaz completa de creación: «➕ Habitación», arrastre libre, resizing
 * elástico, fusión en «L», disyuntor «Espacio Único» y salto de planta desde el
 * minimapa. Reutiliza el MISMO motor 2D de las plantas (`conectarPlantaUnica`).
 * Idempotente: cada refresco re-inyecta el marcado y re-enlaza sus controles.
 */
function montarEditorHabitacionesDerecha(): void {
  const host = document.getElementById(HOSTS.habitacionesEnEspera);
  const fila = estado.filaActiva;
  const div = fila ? estado.divisiones.find((d) => d.parent_grid_row === fila) ?? null : null;
  if (!host || !div || fila === null) return;

  host.innerHTML = renderHabitacionesHtml({
    fila,
    total: totalPlantas(estado.estok, estado.divisiones),
    divisiones: estado.divisiones,
    habitaciones: estado.habitaciones,
  });

  // «⬅ Volver»: suelta la planta activa → la derecha vuelve al estado de espera.
  host.querySelectorAll<HTMLElement>('[data-casita-volver]').forEach((el) => {
    el.addEventListener('click', () => {
      estado.filaActiva = null;
      render();
      enlazar();
      notificarPlanta();
    });
  });

  // Salto de planta desde el minimapa ultra-mini de la casita.
  host.querySelectorAll<HTMLElement>('[data-mini-fila]').forEach((el) => {
    el.addEventListener('click', () => {
      const filaDestino = Number(el.getAttribute('data-mini-fila'));
      if (!filaDestino || filaDestino === estado.filaActiva) return;
      estado.filaActiva = filaDestino;
      render();
      enlazar();
      notificarPlanta();
    });
  });

  // Disyuntor canónico «Espacio Único» de la planta activa (cabecera).
  host
    .querySelector<HTMLInputElement>('#casitaEspacioUnico')
    ?.addEventListener('change', async (e) => {
      const chk = e.currentTarget as HTMLInputElement;
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

  // Clic en una habitación (modo NAVEGACIÓN) → abre su interior en la cascada.
  // En MODO EDICIÓN el clic edita in-place (arrastrar/estirar) y NO navega.
  host
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

  // MOTOR 2D ELÁSTICO UNIFICADO: renombrar al clic, arrastre/reacomodo, estirado
  // por esquina y fusión en «L» sobre el adaptador real de Ubicaciones.
  conectarPlantaUnica({
    scope: host,
    rooms: () =>
      habitacionesDePlanta(estado.divisiones, estado.habitaciones, estado.filaActiva || 1),
    adaptador: adaptadorUbicaciones(),
    apartamentoId: () => div.id,
    crearItem: () => crearHabitacionEnPlanta(div),
    notificarCambios: () => window.dispatchEvent(new CustomEvent('estok:espacios-cambiados')),
  });
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

  // Nivel 1: clic en una planta → sólo registra el estado activo y publica el
  // evento. ASIMETRÍA RÍGIDA (fuelle): la columna izquierda NO desciende —queda
  // clavada en el PLANO GENERAL con la planta elegida en NARANJA
  // (`casita-piso-activo`)—; la cascada de portales despliega las habitaciones en
  // la DERECHA (`listaHabitacionesPanel`). Así se rompe el espejo de raíz.
  refs.mapa.querySelectorAll<HTMLElement>('[data-casita-piso]').forEach((el) => {
    el.addEventListener('click', () => {
      const fila = Number(el.dataset.casitaPiso);
      if (!fila) return;
      estado.filaActiva = fila;
      render();
      enlazar();
      notificarPlanta();
    });
  });

  // Modo Casa: la IZQUIERDA sólo SELECCIONA plantas (ancla rígida en el plano
  // general, planta elegida en NARANJA). El editor de habitaciones vive en la
  // DERECHA y lo monta `montarEditorHabitacionesDerecha` desde `render()`.
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

  // SELECCIÓN DE PLANTA DESDE EL PANEL DERECHO (estado de espera): la tarjeta de
  // planta fija la planta activa (NARANJA en el plano general de la izquierda) y
  // notifica a la cascada de portales, que despliega las habitaciones a la DERECHA.
  window.addEventListener('estok:planta-elegida', (e) => {
    const fila = Number((e as CustomEvent<{ fila?: number }>).detail?.fila) || 0;
    if (!fila) return;
    estado.filaActiva = fila;
    // La izquierda queda RÍGIDA en el plano general: el despliegue de las
    // habitaciones ocurre SIEMPRE en el panel derecho (fuelle asimétrico).
    preservarScroll(() => {
      render();
      enlazar();
    });
    notificarPlanta();
  });

  // Estado inicial de arranque: la casa se pinta de forma SÍNCRONA (el lienzo
  // nunca queda vacío) en la vista general del Estok (Nivel 1). Los datos
  // reales completan la silueta de las DOS plantas y la derecha arma los
  // minimapas independientes, SIN descenso automático (ver cargarYRefrescar).
  estado.filaActiva = null;
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

/** Carga config del Estok + divisiones/habitaciones y re-renderiza. */
async function cargarYRefrescar(): Promise<boolean> {
  const conf = await fetchEstokConfig();
  if (!conf) return false;
  estado.estok = conf;
  await cargarDatos();
  if (estado.primeraCarga) {
    // ESTADO DE ESPERA INICIAL (Nivel Estok puro): SIN descenso automático.
    // La navegación NACE en la vista general del Estok:
    //   · Panel Izquierdo → silueta general de las DOS plantas (Nivel 1).
    //   · Panel Derecho   → minimapas INDEPENDIENTES de cada planta.
    // La planta sólo se fija (y la derecha desciende) cuando el operador la
    // elige, ya sea desde la silueta izquierda o desde su tarjeta derecha.
    estado.primeraCarga = false;
    estado.filaActiva = null;
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
