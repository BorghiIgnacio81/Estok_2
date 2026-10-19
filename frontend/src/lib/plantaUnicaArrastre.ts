// =============================================================================
// PLANTA ÚNICA - ARRASTRE Y RESIZING LIBRES (la física se posterga al Guardar)
// -----------------------------------------------------------------------------
// El puntero mueve y estira las tarjetas del lienzo (espacios sueltos y bloques
// fusionados) con LIBERTAD TOTAL dentro del recuadro amarillo mientras está
// activo el Modo Edición: NO hay bloqueo, rebote ni imán en tiempo real, así el
// usuario acomoda el plano como quiere en cualquier coordenada.
//
// El algoritmo de colisiones y auto-ajuste del plano corre EXCLUSIVAMENTE al
// presionar «💾 Guardar» → ver plantaGuardado.ts + compactacionPlanta.ts.
//
// Cada gesto persiste su resultado para no perder trabajo:
//   - espacio suelto   → PUT de ui_left/ui_top (mover) o ui_width/ui_height (estirar).
//   - bloque fusionado → UN ÚNICO PUT atómico con TODAS sus partes.
// El rebote sobrevive SOLO como rollback visual ante un fallo de red del PUT.
// =============================================================================

import { toast } from './mapaJerarquico';
import { LADO_MIN, type Caja } from './compactacionPlanta';
import { partesTrasEscalar, partesTrasMover } from './plantaUnicaGrupo';
import {
  acotar,
  aplicarCaja,
  aplicarDesplazamientoVisual,
  esGrupo,
  leerCaja,
  limpiarDesplazamientoVisual,
  pct,
} from './lienzoCajas';
import { adaptadorUbicaciones, type AdaptadorEspacios, type ItemElastico } from './lienzoElastico';
import { crearNotificadorDebounced, guardadoEditor } from './debounceGuardado';
import { iniciarBloqueoResize } from './bloqueoScrollGesto';
import { preservarScrollAsync } from './scrollPreservado';
import {
  blindarTiradorTactil,
  contenerGestoTactil,
  crearPintorFrame,
  hayGestoActivo,
  hayInteraccionReciente,
  marcarInteraccionEditor,
} from './pintorFrame';

// =============================================================================
// CONTRATO COMPARTIDO CON EL ORQUESTADOR (plantaUnicaInteractivo.ts)
// =============================================================================

export interface OpcionesPlantaUnica {
  scope: ParentNode;
  rooms: () => ItemElastico[];
  /** Id del contenedor padre (Planta Única). Opcional para visores de Nivel 2/3/4. */
  apartamentoId?: () => string | null;
  /** Garantiza el contenedor padre antes de crear (Planta Única). Opcional. */
  asegurarApartamento?: () => Promise<string | null>;
  notificarCambios: () => void;
  /** Persistencia del recurso espacial (por defecto: Ubicación, Nivel 1/2). */
  adaptador?: AdaptadorEspacios;
  /** Crea un nuevo rectángulo en el lienzo. Por defecto: Ubicación de Planta Única. */
  crearItem?: () => Promise<boolean>;
}

/** Adaptador de persistencia efectivo (Ubicación por defecto). */
export function adaptadorDe(opts: OpcionesPlantaUnica): AdaptadorEspacios {
  return opts.adaptador ?? adaptadorUbicaciones();
}

/** Controles que NO inician un arrastre (checkbox de fusión, tiradores y 🗑️). */
const CONTROLES =
  '[data-fusion-check],[data-inplace-renombrar],[data-libre-resize],[data-grupo-resize],[data-eliminar-grupo],[data-eliminar-item]';

// =============================================================================
// HELPERS DE GESTO
// =============================================================================

/** Lienzo al que pertenece una tarjeta (dueño del sistema de coordenadas %). */
function lienzoDe(card: HTMLElement): HTMLElement | null {
  return card.closest<HTMLElement>('[data-lienzo-pu]');
}

/**
 * Sigue el gesto en `window`: el arrastre funciona aunque la tarjeta del bloque
 * fusionado no capture el puntero (su marco transparente deja pasar el clic a
 * los ambientes vecinos) y aunque el puntero salga del lienzo.
 * Al soltar se entrega el evento: el motor puede volcar la posición EXACTA del
 * `pointerup` antes del único PUT (el `pointercancel` reutiliza la última).
 */
function seguirPuntero(
  alMover: (m: PointerEvent) => void,
  alSoltar: (ev: PointerEvent) => void,
): void {
  const soltar = (ev: PointerEvent): void => {
    window.removeEventListener('pointermove', alMover);
    window.removeEventListener('pointerup', soltar);
    window.removeEventListener('pointercancel', soltar);
    alSoltar(ev);
  };
  window.addEventListener('pointermove', alMover);
  window.addEventListener('pointerup', soltar);
  window.addEventListener('pointercancel', soltar);
}

/** Rebote: rollback a la geometría válida anterior cuando falla el PUT. */
function rebotar(card: HTMLElement, cajaValida: Caja): void {
  card.classList.add('pu-rebote');
  aplicarCaja(card, cajaValida);
  window.setTimeout(() => card.classList.remove('pu-rebote'), 300);
}

/**
 * NOTIFICACIÓN DE CAMBIOS DEBOUNCED (500 ms): el re-render pesado de la cascada
 * —releer el padrón, repintar los dos paneles y re-enlazar TODOS los controles— es
 * el verdadero cuello de botella, no el PUT. Agrupando ráfagas, varios gestos
 * encadenados (mover + estirar + mover) recargan la pantalla UNA sola vez.
 */
const notificarDebounced = crearNotificadorDebounced();

/**
 * Avisa del cambio al consumidor agrupando ráfagas de gestos.
 *
 * OPTIMISTIC UI: la geometría ya está aplicada en el DOM y en el estado en
 * memoria (`opts.rooms()`), así que este aviso NO es urgente. Se difiere hasta
 * que se cumplan las TRES condiciones:
 *   1. no hay un gesto activo (dedo en pantalla),
 *   2. no quedan guardados diferidos esperando su debounce,
 *   3. pasó la ventana de calma desde la última interacción.
 * Recién ahí se permite el fetch completo del estado del espacio. Si el operador
 * vuelve a tocar algo antes, el refresco se reprograma (nunca se pierde).
 */
export function avisarCambios(opts: OpcionesPlantaUnica): void {
  const avisar = (): void => {
    if (hayGestoActivo() || guardadoEditor.pendiente() || hayInteraccionReciente()) {
      notificarDebounced(avisar);
      return;
    }
    opts.notificarCambios();
  };
  notificarDebounced(avisar);
}

/** Agenda el PUT del gesto en el reloj ÚNICO del editor (900 ms). */
function programarGuardado(id: string, ejecutar: () => Promise<void>): void {
  if (!id) return;
  guardadoEditor.programar(id, ejecutar);
}

// =============================================================================
// ARRASTRE LIBRE (espacios sueltos + bloques fusionados)
// =============================================================================

export function conectarArrastreLibre(opts: OpcionesPlantaUnica): void {
  opts.scope.querySelectorAll<HTMLElement>('[data-libre-drag]').forEach((card) => {
    card.addEventListener('pointerdown', (evDown) => {
      const e = evDown as PointerEvent;
      if (e.button !== 0) return;
      const objetivo = e.target as HTMLElement | null;
      if (objetivo?.closest(CONTROLES)) return;
      const lienzo = lienzoDe(card);
      if (!lienzo) return;
      // iOS Safari: frena scroll/rebote/selección desde el primer contacto, no
      // recién cuando el dedo ya se movió (ahí el navegador ya tomó el gesto).
      contenerGestoTactil(e);
      const rect = lienzo.getBoundingClientRect();
      const x0 = e.clientX;
      const y0 = e.clientY;
      const base = leerCaja(card);
      const id = card.dataset.id ?? '';
      let movido = false;
      // Referencias LOCALES del gesto: la geometría se calcula acá y el DOM sólo
      // recibe un `translate3d` por frame (compositor, CERO re-layout). NINGUNA
      // petición HTTP se dispara mientras el dedo está en pantalla.
      let dL = 0;
      let dT = 0;
      // Un gesto nuevo reinicia la espera del guardado anterior: si el operador
      // vuelve a mover algo antes de los 900 ms, el PUT se reprograma.
      marcarInteraccionEditor();
      guardadoEditor.posponer();
      card.classList.add('pu-arrastrando');

      const cajaActual = (): Caja => ({
        // Libertad total: solo se respetan los muros del recuadro amarillo.
        left: acotar(base.left + dL, 0, Math.max(0, 100 - base.width)),
        top: acotar(base.top + dT, 0, Math.max(0, 100 - base.height)),
        width: base.width,
        height: base.height,
      });

      // Pintado del GESTO: sólo transform visual (ni left/top ni PUT).
      const pintarGesto = (): void => {
        const caja = cajaActual();
        aplicarDesplazamientoVisual(
          card,
          ((caja.left - base.left) / 100) * rect.width,
          ((caja.top - base.top) / 100) * rect.height,
        );
      };
      const pintor = crearPintorFrame(pintarGesto);

      const enMovimiento = (m: PointerEvent): void => {
        contenerGestoTactil(m);
        dL = ((m.clientX - x0) / Math.max(1, rect.width)) * 100;
        dT = ((m.clientY - y0) / Math.max(1, rect.height)) * 100;
        if (!movido && Math.abs(dL) < 0.1 && Math.abs(dT) < 0.1) return; // clic simple
        movido = true;
        pintor.programar();
      };

      seguirPuntero(enMovimiento, (ev) => {
        pintor.cancelar();
        card.classList.remove('pu-arrastrando');
        if (movido && ev.type === 'pointerup') {
          // Posición EXACTA del levantamiento del dedo (no la del último frame).
          dL = ((ev.clientX - x0) / Math.max(1, rect.width)) * 100;
          dT = ((ev.clientY - y0) / Math.max(1, rect.height)) * 100;
        }
        marcarInteraccionEditor();
        if (!movido) return;
        // CONSOLIDACIÓN LOCAL (una sola escritura): el transform del gesto se
        // convierte en la posición definitiva left/top. Esto es todo lo que ve
        // el operador; el backend recibe el valor 900 ms después de soltar.
        limpiarDesplazamientoVisual(card);
        aplicarCaja(card, cajaActual());
        programarGuardado(id, () => persistirMovimiento(card, base, opts));
      });
    });
  });
}

/**
 * PUT de la nueva POSICIÓN: recurso suelto o bloque fusionado atómico.
 *
 * VIEWPORT CONGELADO: la respuesta del backend dispara el toast de éxito y el
 * refresco diferido; ambos pueden repintar el panel y recolocar el scroll. Se
 * captura la posición al iniciar el PUT y se reafirma al resolver (sin
 * `focus()`, sin `scrollIntoView()`, sin animación).
 */
async function persistirMovimiento(
  card: HTMLElement,
  base: Caja,
  opts: OpcionesPlantaUnica,
): Promise<void> {
  await preservarScrollAsync(() => persistirMovimientoAhora(card, base, opts));
}

async function persistirMovimientoAhora(
  card: HTMLElement,
  base: Caja,
  opts: OpcionesPlantaUnica,
): Promise<void> {
  const id = card.dataset.id ?? '';
  const nueva = leerCaja(card);
  const dL = nueva.left - base.left;
  const dT = nueva.top - base.top;
  if (!id || (!dL && !dT)) return;

  if (esGrupo(card)) {
    const ok = await adaptadorDe(opts).guardarGrupo(id, { partes: partesTrasMover(card, dL, dT) });
    if (!ok) {
      rebotar(card, base);
      toast('❌ No se pudo mover el espacio fusionado.');
      return;
    }
    toast('🔗 Bloque fusionado reubicado: todas sus partes en un solo PUT.');
  } else {
    const valores = { ui_left: pct(nueva.left), ui_top: pct(nueva.top) };
    const ok = await adaptadorDe(opts).guardarItem(id, valores);
    if (!ok) {
      rebotar(card, base);
      toast('❌ No se pudo guardar la posición del espacio.');
      return;
    }
    const room = opts.rooms().find((r) => r.id === id);
    if (room) Object.assign(room, valores);
    toast('✅ Espacio reubicado.');
  }
  // Refresco diferido (sólo cuando el operador dejó de interactuar).
  avisarCambios(opts);
}

// =============================================================================
// RESIZING ELÁSTICO LIBRE (espacio suelto + bloque fusionado consolidado)
// -----------------------------------------------------------------------------
// El tirador de la esquina inferior derecha estira la pieza sin imán ni rebote:
// solo respeta el lado mínimo (LADO_MIN) y los muros del recuadro amarillo. El
// espacio SUELTO persiste su ancho/alto y el BLOQUE FUSIONADO persiste todas sus
// partes escaladas en un ÚNICO PUT de grupo.
// =============================================================================

export function conectarResizeLibre(opts: OpcionesPlantaUnica): void {
  opts.scope
    .querySelectorAll<HTMLElement>('[data-libre-resize],[data-grupo-resize]')
    .forEach((handle) => {
      // Blindaje táctil estricto del asidero (también en bloques fusionados).
      blindarTiradorTactil(handle);
      handle.addEventListener('pointerdown', (evDown) => {
        const e = evDown as PointerEvent;
        if (e.button !== 0) return;
        const card = handle.closest<HTMLElement>('[data-inplace-card]');
        const lienzo = card ? lienzoDe(card) : null;
        if (!card || !lienzo) return;
        // iOS Safari: el estirado tampoco debe disparar el scroll nativo.
        contenerGestoTactil(e);
        // isResizing: la página queda 100% fija (sin scroll/rebote) hasta soltar.
        const liberarBloqueo = iniciarBloqueoResize();
        const rect = lienzo.getBoundingClientRect();
        const x0 = e.clientX;
        const y0 = e.clientY;
        const base = leerCaja(card);
        const id = card.dataset.id ?? '';
        let cambio = false;
        // Referencias LOCALES del gesto: el tamaño definitivo se aplica al soltar.
        let dW = 0;
        let dH = 0;
        // Gesto nuevo → la espera del guardado anterior arranca de cero y NINGÚN
        // PUT viaja hasta que el tirador se suelte.
        marcarInteraccionEditor();
        guardadoEditor.posponer();
        card.classList.add('pu-redimensionando');

        const aplicarFinal = (): void => {
          if (!cambio) return;
          aplicarCaja(card, {
            left: base.left,
            top: base.top,
            width: acotar(base.width + dW, LADO_MIN, Math.max(LADO_MIN, 100 - base.left)),
            height: acotar(base.height + dH, LADO_MIN, Math.max(LADO_MIN, 100 - base.top)),
          });
        };
        const pintor = crearPintorFrame(aplicarFinal);

        const enMovimiento = (m: PointerEvent): void => {
          contenerGestoTactil(m);
          dW = ((m.clientX - x0) / Math.max(1, rect.width)) * 100;
          dH = ((m.clientY - y0) / Math.max(1, rect.height)) * 100;
          if (!cambio && Math.abs(dW) < 0.1 && Math.abs(dH) < 0.1) return;
          cambio = true;
          pintor.programar();
        };

        seguirPuntero(enMovimiento, (ev) => {
          pintor.cancelar();
          card.classList.remove('pu-redimensionando');
          // isResizing OFF antes de cualquier retorno temprano.
          liberarBloqueo();
          if (cambio && ev.type === 'pointerup') {
            // Tamaño EXACTO del levantamiento del dedo.
            dW = ((ev.clientX - x0) / Math.max(1, rect.width)) * 100;
            dH = ((ev.clientY - y0) / Math.max(1, rect.height)) * 100;
          }
          marcarInteraccionEditor();
          if (!cambio) return;
          // Consolidación LOCAL; el PUT viaja 900 ms después del arrastre.
          aplicarFinal();
          programarGuardado(id, () => persistirTamano(card, base, opts));
        });
      });
    });
}

/**
 * PUT del nuevo TAMAÑO: recurso suelto o bloque fusionado atómico.
 * VIEWPORT CONGELADO tras la respuesta de la API (ver `persistirMovimiento`).
 */
async function persistirTamano(
  card: HTMLElement,
  base: Caja,
  opts: OpcionesPlantaUnica,
): Promise<void> {
  await preservarScrollAsync(() => persistirTamanoAhora(card, base, opts));
}

async function persistirTamanoAhora(
  card: HTMLElement,
  base: Caja,
  opts: OpcionesPlantaUnica,
): Promise<void> {
  const id = card.dataset.id ?? '';
  if (!id) return;
  const nueva = leerCaja(card);

  if (esGrupo(card)) {
    // Escalado proporcional de cada parte respecto del origen del bloque.
    const escala = {
      x: nueva.width / Math.max(1, base.width),
      y: nueva.height / Math.max(1, base.height),
    };
    const partes = partesTrasEscalar(card, { left: base.left, top: base.top }, escala);
    const ok = await adaptadorDe(opts).guardarGrupo(id, { partes });
    if (!ok) {
      rebotar(card, base);
      toast('❌ No se pudo redimensionar el bloque fusionado.');
      return;
    }
    toast('🔗 Bloque fusionado redimensionado: todas sus partes en un solo PUT.');
  } else {
    const valores = { ui_width: pct(nueva.width), ui_height: pct(nueva.height) };
    const ok = await adaptadorDe(opts).guardarItem(id, valores);
    if (!ok) {
      rebotar(card, base);
      toast('❌ No se pudo guardar el nuevo tamaño.');
      return;
    }
    const room = opts.rooms().find((r) => r.id === id);
    if (room) Object.assign(room, valores);
    toast(`✅ Tamaño actualizado (${pct(nueva.width)} × ${pct(nueva.height)}).`);
  }
  // Refresco diferido (sólo cuando el operador dejó de interactuar).
  avisarCambios(opts);
}
