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
import { acotar, aplicarCaja, esGrupo, leerCaja, pct } from './lienzoCajas';
import { adaptadorUbicaciones, type AdaptadorEspacios, type ItemElastico } from './lienzoElastico';
import { crearGuardadoProgramado, crearNotificadorDebounced } from './debounceGuardado';

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
 */
function seguirPuntero(alMover: (m: PointerEvent) => void, alSoltar: () => void): void {
  const soltar = (): void => {
    window.removeEventListener('pointermove', alMover);
    window.removeEventListener('pointerup', soltar);
    window.removeEventListener('pointercancel', soltar);
    alSoltar();
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

/** Avisa del cambio al consumidor agrupando ráfagas de gestos. */
function notificarCambios(opts: OpcionesPlantaUnica): void {
  notificarDebounced(opts.notificarCambios);
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
      e.preventDefault();
      const rect = lienzo.getBoundingClientRect();
      const x0 = e.clientX;
      const y0 = e.clientY;
      const base = leerCaja(card);
      let movido = false;
      card.classList.add('pu-arrastrando');
      // DEBOUNCE ANTI-LAG · 500 ms: el arrastre corre a 60 FPS en el CLIENTE y la
      // persistencia se AGENDA (el reloj se reinicia en cada píxel). Mientras el
      // puntero se mueve NO viaja ningún PUT; si el gesto se detiene, el checkpoint
      // silencioso consolida lo modelado y al SOLTAR se cancela y se envía el PUT
      // final: un único guardado consolidado hacia la API de Django.
      const guardado = crearGuardadoProgramado(() => persistirMovimiento(card, base, opts, true));

      const enMovimiento = (m: PointerEvent): void => {
        const dL = ((m.clientX - x0) / Math.max(1, rect.width)) * 100;
        const dT = ((m.clientY - y0) / Math.max(1, rect.height)) * 100;
        if (!movido && Math.abs(dL) < 0.1 && Math.abs(dT) < 0.1) return; // clic simple
        m.preventDefault();
        movido = true;
        // Libertad total: solo se respetan los muros del recuadro amarillo.
        aplicarCaja(card, {
          left: acotar(base.left + dL, 0, Math.max(0, 100 - base.width)),
          top: acotar(base.top + dT, 0, Math.max(0, 100 - base.height)),
          width: base.width,
          height: base.height,
        });
        guardado.programar();
      };

      seguirPuntero(enMovimiento, () => {
        card.classList.remove('pu-arrastrando');
        guardado.cancelar();
        if (!movido) return;
        void persistirMovimiento(card, base, opts, false);
      });
    });
  });
}

/** PUT de la nueva POSICIÓN: recurso suelto o bloque fusionado atómico. */
async function persistirMovimiento(
  card: HTMLElement,
  base: Caja,
  opts: OpcionesPlantaUnica,
  /** Checkpoint silencioso: guarda sin rebote, sin toast y sin recargar la pantalla. */
  silencioso = false,
): Promise<void> {
  const id = card.dataset.id ?? '';
  const nueva = leerCaja(card);
  const dL = nueva.left - base.left;
  const dT = nueva.top - base.top;
  if (!id || (!dL && !dT)) return;

  if (esGrupo(card)) {
    const ok = await adaptadorDe(opts).guardarGrupo(id, { partes: partesTrasMover(card, dL, dT) });
    if (!ok) {
      if (silencioso) return;
      rebotar(card, base);
      toast('❌ No se pudo mover el espacio fusionado.');
      return;
    }
    if (!silencioso) toast('🔗 Bloque fusionado reubicado: todas sus partes en un solo PUT.');
  } else {
    const valores = { ui_left: pct(nueva.left), ui_top: pct(nueva.top) };
    const ok = await adaptadorDe(opts).guardarItem(id, valores);
    if (!ok) {
      if (silencioso) return;
      rebotar(card, base);
      toast('❌ No se pudo guardar la posición del espacio.');
      return;
    }
    const room = opts.rooms().find((r) => r.id === id);
    if (room) Object.assign(room, valores);
    if (!silencioso) toast('✅ Espacio reubicado.');
  }
  // El checkpoint silencioso NO recarga la pantalla: el gesto sigue vivo.
  if (!silencioso) notificarCambios(opts);
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
      handle.addEventListener('pointerdown', (evDown) => {
        const e = evDown as PointerEvent;
        if (e.button !== 0) return;
        const card = handle.closest<HTMLElement>('[data-inplace-card]');
        const lienzo = card ? lienzoDe(card) : null;
        if (!card || !lienzo) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = lienzo.getBoundingClientRect();
        const x0 = e.clientX;
        const y0 = e.clientY;
        const base = leerCaja(card);
        let cambio = false;
        card.classList.add('pu-redimensionando');
        // DEBOUNCE ANTI-LAG · 500 ms: el estirado también corre a 60 FPS en el
        // cliente; el PUT se agenda y se consolida al soltar el tirador.
        const guardado = crearGuardadoProgramado(() => persistirTamano(card, base, opts, true));

        const enMovimiento = (m: PointerEvent): void => {
          const dW = ((m.clientX - x0) / Math.max(1, rect.width)) * 100;
          const dH = ((m.clientY - y0) / Math.max(1, rect.height)) * 100;
          if (!cambio && Math.abs(dW) < 0.1 && Math.abs(dH) < 0.1) return;
          m.preventDefault();
          cambio = true;
          aplicarCaja(card, {
            left: base.left,
            top: base.top,
            width: acotar(base.width + dW, LADO_MIN, Math.max(LADO_MIN, 100 - base.left)),
            height: acotar(base.height + dH, LADO_MIN, Math.max(LADO_MIN, 100 - base.top)),
          });
          guardado.programar();
        };

        seguirPuntero(enMovimiento, () => {
          card.classList.remove('pu-redimensionando');
          guardado.cancelar();
          if (!cambio) return;
          void persistirTamano(card, base, opts, false);
        });
      });
    });
}

/** PUT del nuevo TAMAÑO: recurso suelto o bloque fusionado atómico. */
async function persistirTamano(
  card: HTMLElement,
  base: Caja,
  opts: OpcionesPlantaUnica,
  /** Checkpoint silencioso: guarda sin rebote, sin toast y sin recargar la pantalla. */
  silencioso = false,
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
      if (silencioso) return;
      rebotar(card, base);
      toast('❌ No se pudo redimensionar el bloque fusionado.');
      return;
    }
    if (!silencioso) {
      toast('🔗 Bloque fusionado redimensionado: todas sus partes en un solo PUT.');
    }
  } else {
    const valores = { ui_width: pct(nueva.width), ui_height: pct(nueva.height) };
    const ok = await adaptadorDe(opts).guardarItem(id, valores);
    if (!ok) {
      if (silencioso) return;
      rebotar(card, base);
      toast('❌ No se pudo guardar el nuevo tamaño.');
      return;
    }
    const room = opts.rooms().find((r) => r.id === id);
    if (room) Object.assign(room, valores);
    if (!silencioso) toast(`✅ Tamaño actualizado (${pct(nueva.width)} × ${pct(nueva.height)}).`);
  }
  // El checkpoint silencioso NO recarga la pantalla: el gesto sigue vivo.
  if (!silencioso) notificarCambios(opts);
}
