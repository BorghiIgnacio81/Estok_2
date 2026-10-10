// =============================================================================
// ASISTENTE DE BIENVENIDA (ONBOARDING) — CONTROLADOR DE PASOS
// -----------------------------------------------------------------------------
// Máquina de 4 pasos con transición horizontal reactiva (izquierda → derecha)
// SIN recargar la página, sobre el markup de components/OnboardingBienvenida.astro.
//
//   PASO 1 (OBLIGATORIO / BLOQUEANTE): funda el primer Estok. No se puede
//     avanzar ni omitir hasta que el backend confirme (201) y quede activo el
//     nuevo X-Estok-Id en localStorage + estado global.
//   PASO 2/3/4 (OPCIONALES): espacios, almacenamiento y primer objeto. Todos
//     tienen "Omitir" (por paso) y "Omitir Tutorial" (esquina → finaliza).
//
// Acceso a la API delegado 100% en ./api (auth centralizada).
// =============================================================================

import { logout, setEstokActivoId } from '../../services/auth';
import type { EstokInfo } from '../../types';
import { fundarEstok } from './api';
import { ModalCodigoInvitacion } from './codigoInvitacion';
import { avisoGlobal, mensajeDe } from './comunes';
import { continuarPasoDivisiones, desmontarDivisiones, montarGuiaDivisiones } from './pasoDivisiones';
import { limpiarRastroAmbientes } from './rastroAmbientes';
import { iniciarPaso4Tutorial } from './pasoObjeto';
import { PasoEspacios } from './pasoEspacios';

// =============================================================================
// CONSTANTES
// =============================================================================

const TOTAL_PASOS = 4;

/**
 * Nombre del Estok que se funda automáticamente cuando el usuario usa
 * «Omitir Tutorial» sin haber completado el Paso 1: recibe acceso total de
 * inmediato a un inquilinato por defecto en vez de quedar bloqueado.
 */
const NOMBRE_ESTOK_POR_DEFECTO = 'Mi Estok Inicial';

// =============================================================================
// CLASE PRINCIPAL
// =============================================================================

export class AsistenteBienvenida {
  private root: HTMLElement;
  /** Índice 0-based del paso visible. */
  private paso = 0;
  private estok: EstokInfo | null = null;
  private ocupado = false;
  /** Plantas elegidas en el Paso 1: 1 = plano 2D espacial; >1 = chips clásicos. */
  private pisos = 1;
  /** Controlador del Paso 2 (chips clásicos o plano espacial reactivo). */
  private readonly paso2: PasoEspacios;
  /** Controlador del modal «Usar código de invitación» (cabecera del asistente). */
  private readonly modalCodigo: ModalCodigoInvitacion;

  constructor(root: HTMLElement) {
    this.root = root;
    this.paso2 = new PasoEspacios({
      root,
      pisos: () => this.pisos,
      irAPaso: (indice) => this.irAPaso(indice),
      error: (mensaje) => this.error('onbErrorPaso2', mensaje),
      ocupado: () => this.ocupado,
      marcarOcupado: (ocupado) => {
        this.ocupado = ocupado;
      },
      cargando: (btn, activo, texto) => this.cargando(btn, activo, texto),
    });
    this.modalCodigo = new ModalCodigoInvitacion({
      root,
      ocupado: () => this.ocupado,
      marcarOcupado: (ocupado) => {
        this.ocupado = ocupado;
      },
      onExito: (estok) => this.finalizar(estok),
    });
  }

  /** Estok fundado en el paso 1 (null = todavía no hay acceso concedido). */
  get estokFundado(): EstokInfo | null {
    return this.estok;
  }

  iniciar(): void {
    // El alta del Estok la resuelve el componente canónico Paso1Estok (fuente
    // única, compartida con el panel admin): acá sólo se reacciona a su evento.
    window.addEventListener('estok:paso1-completado', (e) => this.alFundarPaso1(e));
    this.q<HTMLElement>('#onbOmitirTutorial')?.addEventListener('click', () => void this.omitirTutorial());
    this.q<HTMLElement>('#onbCerrarSesion')?.addEventListener('click', () => this.cerrarSesion());
    this.q<HTMLElement>('#onbVolver')?.addEventListener('click', () => this.irAPaso(this.paso - 1));
    this.paso2.iniciar();
    this.modalCodigo.iniciar();
    this.bindPaso3();
    this.bindPaso4();
    this.renderProgreso();
  }

  // ── HELPERS DE DOM ─────────────────────────────────────────────────────────

  private q<T extends Element>(selector: string): T | null {
    return this.root.querySelector<T>(selector);
  }

  private error(id: string, mensaje: string | null): void {
    const el = this.q<HTMLElement>(`#${id}`);
    if (!el) return;
    if (mensaje) {
      el.textContent = mensaje;
      el.classList.remove('hidden');
    } else {
      el.textContent = '';
      el.classList.add('hidden');
    }
  }

  private cargando(btn: HTMLButtonElement | null, activo: boolean, texto: string): void {
    if (!btn) return;
    btn.disabled = activo;
    btn.textContent = texto;
    btn.classList.toggle('opacity-60', activo);
  }

  // ── NAVEGACIÓN ENTRE PASOS (transición izquierda → derecha) ────────────────

  private irAPaso(indice: number): void {
    this.paso = Math.max(0, Math.min(TOTAL_PASOS - 1, indice));
    const track = this.q<HTMLElement>('#onbTrack');
    if (track) track.style.transform = `translateX(-${this.paso * 100}%)`;
    if (this.paso === 1) void this.paso2.entrar();
    // Paso 3: guía secuencial de divisiones (lista deduplicada + lienzo por cuarto).
    if (this.paso === 2) void this.iniciarPaso3();
    // Al salir del Paso 3 se limpia su estado (lienzo + lista).
    if (this.paso !== 2) desmontarDivisiones();
    // Paso 4: formulario modular completo (Gemini IA + Mercado Libre + minimapas).
    if (this.paso === 3) iniciarPaso4Tutorial();
    this.renderProgreso();
    this.root.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private renderProgreso(): void {
    for (let i = 0; i < TOTAL_PASOS; i++) {
      const pill = this.q<HTMLElement>(`[data-onb-progreso="${i + 1}"]`);
      if (!pill) continue;
      const completado = i < this.paso;
      const activo = i === this.paso;
      pill.className = [
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-base border',
        completado
          ? 'bg-green-100 text-green-700 border-green-200'
          : activo
            ? 'bg-blue-700 text-white border-blue-700 shadow-sm'
            : 'bg-white/70 text-gray-500 border-gray-200',
      ].join(' ');
      const circulo = pill.querySelector<HTMLElement>('span');
      if (circulo) circulo.textContent = completado ? '✓' : String(i + 1);
    }
    this.q<HTMLElement>('#onbVolver')?.classList.toggle('hidden', this.paso === 0);
  }

  // ── PASO 1 — ALTA CANÓNICA (la resuelve el componente Paso1Estok) ──────────
  // El componente Paso1Estok llama al inicializador canónico fundarEstok() y
  // emite `estok:paso1-completado` con la ficha creada. Acá sólo se sincroniza
  // el estado del asistente (estok + plantas) y se navega al Paso 2.

  private alFundarPaso1(evento: Event): void {
    const detalle = (evento as CustomEvent<{ estok: EstokInfo; pisos: number }>).detail;
    if (!detalle?.estok) return;
    this.estok = detalle.estok;
    // El Paso 2 se bifurca según las plantas elegidas: 1 sola → modelador 2D.
    this.pisos = detalle.pisos > 0 ? detalle.pisos : 1;
    // Contrato del requerimiento: el ID del nuevo Estok queda en localStorage
    // (clave 'estok_activo_id' → header X-Estok-Id) y se avisa al estado global.
    setEstokActivoId(detalle.estok.id);
    window.dispatchEvent(new CustomEvent('estok:estok-fundado', { detail: detalle.estok }));
    avisoGlobal(`✅ Estok «${detalle.estok.nombre}» fundado. ¡Acceso concedido!`);
    this.irAPaso(1);
  }

  // ── OMITIR TUTORIAL — BYPASS CON ACCESO INMEDIATO ─────────────────────────

  /**
   * «Omitir Tutorial»: atajo de escape que NUNCA deja al usuario bloqueado.
   *
   * Si el Paso 1 ya se completó, cierra el asistente como siempre. Si todavía no
   * hay Estok, funda uno por defecto («Mi Estok Inicial») con el usuario como
   * Admin, lo persiste en localStorage ('estok_activo_id' → header X-Estok-Id) y
   * entra al Dashboard ordinario con acceso total, sin pasar por los pasos 2-4.
   */
  private async omitirTutorial(): Promise<void> {
    if (this.ocupado) return;
    this.error('onbErrorPaso1', null);
    const btn = this.q<HTMLButtonElement>('#onbOmitirTutorial');
    this.ocupado = true;
    this.cargando(btn, true, 'Preparando tu Estok…');
    try {
      if (!this.estok) {
        const estok = await fundarEstok(NOMBRE_ESTOK_POR_DEFECTO, 1);
        this.estok = estok;
        setEstokActivoId(estok.id);
        window.dispatchEvent(new CustomEvent('estok:estok-fundado', { detail: estok }));
        avisoGlobal(`✅ Estok «${estok.nombre}» creado. ¡Acceso concedido!`);
      }
      this.finalizar();
    } catch (err) {
      this.error('onbErrorPaso1', mensajeDe(err, 'No se pudo preparar tu Estok inicial. Reintentá.'));
      this.ocupado = false;
      this.cargando(btn, false, 'Omitir Tutorial →');
    }
  }

  // ── PASO 2 — DIVIDIR ESPACIOS (opcional) ─────────────────────────────────
  // TODO el paso vive en ./pasoEspacios (PasoEspacios): bifurca entre el PLANO
  // ESPACIAL reactivo de rectángulos mutables (1 sola planta) y los chips
  // clásicos de nombres (2+ plantas). La navegación entra por this.paso2.entrar().

  // (fin del Paso 2)

  // ── PASO 3 — DIVISIONES DE LA HABITACIÓN (opcional) ───────────────────────

  private bindPaso3(): void {
    // «Continuar» dispara el EMBUDO secuencial: no avanza salvo que el 100% de
    // las habitaciones reales haya recibido una decisión explícita. El escape
    // real al Paso 4 vive en ./pasoDivisiones (callback `avanzar`).
    this.q<HTMLElement>('#onbGuardarMueble')?.addEventListener('click', () =>
      continuarPasoDivisiones(),
    );
    // «Omitir» es la salida limpia del paso: evita el embudo por completo.
    this.q<HTMLElement>('#onbOmitirPaso3')?.addEventListener('click', () => this.irAPaso(3));
  }

  /**
   * Monta el EMBUDO secuencial del Paso 3: combobox con la lista REAL de
   * habitaciones (deduplicadas del Paso 2) y, por cada pendiente, sus 3 vías de
   * acción. Toda la lógica vive en ./pasoDivisiones; el escape al Paso 4 se
   * inyecta como callback (`avanzar`).
   */
  private async iniciarPaso3(): Promise<void> {
    const lista = this.q<HTMLElement>('#onbDivisionesLista');
    const lienzo = this.q<HTMLElement>('#onbDivisionesLienzo');
    if (!lista || !lienzo) return;
    this.error('onbErrorPaso3', null);
    await montarGuiaDivisiones({ lista, lienzo, avanzar: () => this.irAPaso(3) });
  }

  // ── PASO 4 — TU PRIMER OBJETO (formulario modular completo, opcional) ─────

  private bindPaso4(): void {
    // El guardado lo orquesta el formulario modular real (objetoFormCore.ts, vía
    // iniciarPaso4Tutorial en ./pasoObjeto): acá sólo queda la salida del tutorial.
    this.q<HTMLElement>('#onbOmitirPaso4')?.addEventListener('click', () => this.finalizar());
  }


  // ── SALIDA LIMPIA — CERRAR SESIÓN DESDE EL ASISTENTE ─────────────────────

  /**
   * Cierra la sesión sin quedar atrapado en el asistente: limpia tokens y datos
   * de usuario (services/auth · logout) y vuelve al Login. Pensado para un
   * usuario nuevo que entra por error con una cuenta ajena.
   */
  private cerrarSesion(): void {
    logout();
    document.documentElement.removeAttribute('data-estok-onboarding');
    window.location.href = '/login';
  }

  // ── CIERRE — ACCESO CONCEDIDO AL DASHBOARD ORDINARIO ─────────────────────

  /**
   * Cierra el asistente SOLO si el paso 1 se completó (el Estok existe y está
   * activo). Limpia el estado global, deja el ID en localStorage y redirige
   * limpiamente al Dashboard, que ahora responde 200 OK con X-Estok-Id.
   */
  private finalizar(estok: EstokInfo | null = this.estok): void {
    if (!estok) return;
    setEstokActivoId(estok.id);
    // Cierre limpio: el rastro anti-latencia del Paso 2 se descarta tras el éxito.
    limpiarRastroAmbientes();
    window.dispatchEvent(new CustomEvent('estok:onboarding-finalizado', { detail: estok }));
    document.documentElement.removeAttribute('data-estok-onboarding');
    if (window.location.pathname === '/') {
      window.location.reload();
    } else {
      window.location.href = '/';
    }
  }
}
