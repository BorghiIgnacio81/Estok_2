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

import { setEstokActivoId } from '../../services/auth';
import type { EstokInfo } from '../../types';
import { escapeHtml } from '../mapaJerarquico';
import {
  asegurarPrimerAmbiente,
  crearAmbiente,
  crearMueble,
  crearObjetoInicial,
  fundarEstok,
  listarAmbientes,
} from './api';
import type { RecursoCreado } from './api';

// =============================================================================
// CONSTANTES
// =============================================================================

const TOTAL_PASOS = 4;
const MAX_AMBIENTES = 8;
/** Atajos de un toque para los ambientes más comunes de una casa. */
const SUGERENCIAS_AMBIENTES = ['Cocina', 'Habitación', 'Living', 'Baño', 'Garaje', 'Depósito'];

/** Mensaje legible de cualquier error (Error nativo o AuthError del backend). */
function mensajeDe(err: unknown, porDefecto: string): string {
  const e = err as { error?: string; message?: string } | null;
  return e?.error || e?.message || porDefecto;
}

function avisoGlobal(mensaje: string): void {
  const w = window as unknown as {
    showSuccess?: (m: string) => void;
    showInfo?: (m: string) => void;
    showWarning?: (m: string) => void;
  };
  (w.showSuccess ?? w.showInfo ?? w.showWarning ?? (() => undefined))(mensaje);
}

// =============================================================================
// CLASE PRINCIPAL
// =============================================================================

export class AsistenteBienvenida {
  private root: HTMLElement;
  /** Índice 0-based del paso visible. */
  private paso = 0;
  private estok: EstokInfo | null = null;
  private ambientes: RecursoCreado[] = [];
  private mueble: RecursoCreado | null = null;
  private nombres: string[] = [];
  private ocupado = false;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Estok fundado en el paso 1 (null = todavía no hay acceso concedido). */
  get estokFundado(): EstokInfo | null {
    return this.estok;
  }

  iniciar(): void {
    this.q<HTMLFormElement>('#onbFormEstok')?.addEventListener('submit', (e) => void this.fundar(e));
    this.q<HTMLElement>('#onbOmitirTutorial')?.addEventListener('click', () => this.finalizar());
    this.q<HTMLElement>('#onbVolver')?.addEventListener('click', () => this.irAPaso(this.paso - 1));
    this.bindPaso2();
    this.bindPaso3();
    this.bindPaso4();
    this.pintarSugerencias();
    this.pintarChips();
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
    if (this.paso === 1) this.pintarChips();
    if (this.paso === 2) void this.pintarSelectAmbientes();
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
    const omitir = this.q<HTMLElement>('#onbOmitirTutorial');
    if (omitir) omitir.classList.toggle('hidden', !this.estok);
  }

  // ── PASO 1 — FUNDAR EL ESTOK (OBLIGATORIO) ────────────────────────────────

  private async fundar(e: Event): Promise<void> {
    e.preventDefault();
    if (this.ocupado) return;

    const nombre = (this.q<HTMLInputElement>('#onbNombreEstok')?.value || '').trim();
    if (nombre.length < 2) {
      this.error('onbErrorPaso1', 'Escribí un nombre para tu Estok (mínimo 2 caracteres).');
      return;
    }
    const pisos = Number(this.q<HTMLSelectElement>('#onbCantidadPisos')?.value || 1);
    const btn = this.q<HTMLButtonElement>('#onbFundarBtn');

    this.error('onbErrorPaso1', null);
    this.ocupado = true;
    this.cargando(btn, true, 'Fundando Estok…');
    try {
      const estok = await fundarEstok(nombre, Number.isFinite(pisos) && pisos > 0 ? pisos : 1);
      this.estok = estok;
      // Contrato del requerimiento: el ID del nuevo Estok queda en localStorage
      // (clave 'estok_activo_id' → header X-Estok-Id) y se avisa al estado global.
      setEstokActivoId(estok.id);
      window.dispatchEvent(new CustomEvent('estok:estok-fundado', { detail: estok }));
      avisoGlobal(`✅ Estok «${estok.nombre}» fundado. ¡Acceso concedido!`);

      const ok = this.q<HTMLElement>('#onbPaso1Ok');
      if (ok) {
        ok.textContent = `✅ «${estok.nombre}» quedó fundado y activo. Seguí con los pasos opcionales o tocá «Omitir Tutorial».`;
        ok.classList.remove('hidden');
      }
      this.irAPaso(1);
    } catch (err) {
      this.error('onbErrorPaso1', mensajeDe(err, 'No se pudo fundar el Estok. Reintentá.'));
    } finally {
      this.ocupado = false;
      this.cargando(btn, false, '🏠 Fundar Estok');
    }
  }

  // ── PASO 2 — DIVIDIR ESPACIOS (opcional) ──────────────────────────────────

  private bindPaso2(): void {
    const input = this.q<HTMLInputElement>('#onbAmbienteInput');
    this.q<HTMLElement>('#onbAmbienteAgregar')?.addEventListener('click', () => {
      this.agregarNombre(input?.value || '');
      if (input) input.value = '';
    });
    input?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.agregarNombre(input.value);
      input.value = '';
    });
    this.q<HTMLElement>('#onbSugerencias')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-onb-sugerido]');
      if (btn?.dataset.onbSugerido) this.agregarNombre(btn.dataset.onbSugerido);
    });
    this.q<HTMLElement>('#onbAmbientesChips')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-onb-chip-quitar]');
      if (!btn) return;
      const i = Number(btn.dataset.onbChipQuitar);
      this.nombres = this.nombres.filter((_, idx) => idx !== i);
      this.pintarChips();
    });
    this.q<HTMLElement>('#onbGuardarAmbientes')?.addEventListener('click', () => void this.guardarAmbientes());
    this.q<HTMLElement>('#onbOmitirPaso2')?.addEventListener('click', () => this.irAPaso(2));
  }

  private agregarNombre(valor: string): void {
    const nombre = valor.trim();
    if (!nombre) return;
    if (this.nombres.length >= MAX_AMBIENTES) {
      this.error('onbErrorPaso2', `El asistente crea hasta ${MAX_AMBIENTES} ambientes. Después podés sumar más desde Almacenamiento.`);
      return;
    }
    if (this.nombres.some((n) => n.toLowerCase() === nombre.toLowerCase())) {
      this.error('onbErrorPaso2', `«${nombre}» ya está en la lista.`);
      return;
    }
    this.nombres = [...this.nombres, nombre];
    this.pintarChips();
    this.error('onbErrorPaso2', null);
  }

  private pintarSugerencias(): void {
    const cont = this.q<HTMLElement>('#onbSugerencias');
    if (!cont || cont.childElementCount > 0) return;
    cont.innerHTML = SUGERENCIAS_AMBIENTES.map(
      (n) => `<button type="button" data-onb-sugerido="${escapeHtml(n)}" class="px-3 py-1.5 rounded-full bg-white border border-gray-200 text-sm text-gray-700 hover:border-blue-400 hover:text-blue-700 transition-base">+ ${escapeHtml(n)}</button>`,
    ).join('');
  }

  private pintarChips(): void {
    const cont = this.q<HTMLElement>('#onbAmbientesChips');
    if (!cont) return;
    if (this.nombres.length === 0) {
      cont.innerHTML = '<p class="text-sm text-gray-400">Todavía no agregaste ambientes. Tocá una sugerencia o escribí el nombre.</p>';
      return;
    }
    cont.innerHTML = this.nombres
      .map(
        (n, i) => `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-800 text-sm font-medium">
          ${escapeHtml(n)}
          <button type="button" data-onb-chip-quitar="${i}" title="Quitar" class="text-blue-400 hover:text-red-600 transition-base">✕</button>
        </span>`,
      )
      .join('');
  }

  private async guardarAmbientes(): Promise<void> {
    if (this.ocupado) return;
    if (this.nombres.length === 0) {
      this.error('onbErrorPaso2', 'Escribí al menos un ambiente (ej: Cocina) o usá «Omitir este paso».');
      return;
    }
    const btn = this.q<HTMLButtonElement>('#onbGuardarAmbientes');
    const creados: RecursoCreado[] = [];
    this.error('onbErrorPaso2', null);
    this.ocupado = true;
    this.cargando(btn, true, 'Creando espacios…');
    try {
      for (let i = 0; i < this.nombres.length; i++) {
        creados.push(await crearAmbiente(this.nombres[i], i));
      }
      this.ambientes = creados;
      avisoGlobal(`✅ ${creados.length} ambiente${creados.length === 1 ? '' : 's'} creado${creados.length === 1 ? '' : 's'}.`);
      this.irAPaso(2);
    } catch (err) {
      this.ambientes = creados;
      if (creados.length > 0) {
        avisoGlobal(`⚠️ Se crearon ${creados.length} ambiente(s); el resto no se pudo guardar.`);
        this.irAPaso(2);
      }
      this.error('onbErrorPaso2', mensajeDe(err, 'No se pudieron crear los ambientes.'));
    } finally {
      this.ocupado = false;
      this.cargando(btn, false, 'Crear espacios y continuar');
    }
  }

  // ── PASO 3 — CONFIGURAR ALMACENAMIENTO (opcional) ─────────────────────────

  private bindPaso3(): void {
    this.q<HTMLElement>('#onbGuardarMueble')?.addEventListener('click', () => void this.guardarMueble());
    this.q<HTMLElement>('#onbOmitirPaso3')?.addEventListener('click', () => this.irAPaso(3));
  }

  /** Llena el selector de ambientes del paso 3 (memoria → backend). */
  private async pintarSelectAmbientes(): Promise<void> {
    const select = this.q<HTMLSelectElement>('#onbAmbienteSelect');
    if (!select) return;
    if (this.ambientes.length === 0) this.ambientes = await listarAmbientes();
    select.innerHTML =
      this.ambientes.length > 0
        ? this.ambientes.map((a) => `<option value="${a.id}">${escapeHtml(a.nombre)}</option>`).join('')
        : '<option value="">Crearemos «Habitación principal» por vos</option>';
  }

  private async guardarMueble(): Promise<void> {
    if (this.ocupado) return;
    const btn = this.q<HTMLButtonElement>('#onbGuardarMueble');
    const nombre = (this.q<HTMLInputElement>('#onbMuebleInput')?.value || '').trim() || 'Mueble 1';
    this.error('onbErrorPaso3', null);
    this.ocupado = true;
    this.cargando(btn, true, 'Creando mueble…');
    try {
      const seleccionado = this.q<HTMLSelectElement>('#onbAmbienteSelect')?.value || '';
      let ubicacionId = seleccionado || this.ambientes[0]?.id || '';
      if (!ubicacionId) {
        // El usuario omitió el paso 2: creamos un ambiente mínimo para no perder
        // la ubicación del mueble (el paso 3 también funciona en solitario).
        const ambiente = await asegurarPrimerAmbiente();
        if (ambiente) {
          this.ambientes = [...this.ambientes, ambiente];
          ubicacionId = ambiente.id;
          void this.pintarSelectAmbientes();
        }
      }
      if (!ubicacionId) {
        this.error('onbErrorPaso3', 'No hay un ambiente disponible para el mueble. Probá con «Omitir este paso».');
        return;
      }

      const mueble = await crearMueble(nombre, ubicacionId, this.ambientes.length);
      this.mueble = mueble;
      avisoGlobal(`✅ «${mueble.nombre}» quedó creado. Ahora guardá tu primer objeto.`);
      this.irAPaso(3);
    } catch (err) {
      this.error('onbErrorPaso3', mensajeDe(err, 'No se pudo crear el mueble.'));
    } finally {
      this.ocupado = false;
      this.cargando(btn, false, 'Crear mueble y continuar');
    }
  }

  // ── PASO 4 — TU PRIMER OBJETO (opcional) ─────────────────────────────────

  private bindPaso4(): void {
    this.q<HTMLElement>('#onbGuardarObjeto')?.addEventListener('click', () => void this.guardarObjeto());
    this.q<HTMLElement>('#onbOmitirPaso4')?.addEventListener('click', () => this.finalizar());
  }

  private async guardarObjeto(): Promise<void> {
    if (this.ocupado) return;
    const nombre = (this.q<HTMLInputElement>('#onbObjetoInput')?.value || '').trim();
    if (!nombre) {
      this.error('onbErrorPaso4', 'Ponele un nombre al objeto (ej: Taladro) o usá «Omitir/Finalizar».');
      return;
    }
    const valorBruto = Number(this.q<HTMLInputElement>('#onbObjetoValor')?.value || '');
    const btn = this.q<HTMLButtonElement>('#onbGuardarObjeto');
    this.error('onbErrorPaso4', null);
    this.ocupado = true;
    this.cargando(btn, true, 'Guardando objeto…');
    try {
      const objeto = await crearObjetoInicial({
        nombre,
        valorEstimado: Number.isFinite(valorBruto) && valorBruto > 0 ? valorBruto : null,
        contenedorId: this.mueble?.id ?? null,
        ubicacionId: this.mueble ? null : (this.ambientes[0]?.id ?? null),
      });
      avisoGlobal(`✅ «${objeto.nombre}» ya forma parte de tu inventario.`);
      this.finalizar();
    } catch (err) {
      this.error('onbErrorPaso4', mensajeDe(err, 'No se pudo guardar el objeto.'));
      this.ocupado = false;
      this.cargando(btn, false, 'Guardar objeto y finalizar');
    }
  }

  // ── CIERRE — ACCESO CONCEDIDO AL DASHBOARD ORDINARIO ─────────────────────

  /**
   * Cierra el asistente SOLO si el paso 1 se completó (el Estok existe y está
   * activo). Limpia el estado global, deja el ID en localStorage y redirige
   * limpiamente al Dashboard, que ahora responde 200 OK con X-Estok-Id.
   */
  private finalizar(): void {
    if (!this.estok) return;
    setEstokActivoId(this.estok.id);
    window.dispatchEvent(new CustomEvent('estok:onboarding-finalizado', { detail: this.estok }));
    document.documentElement.removeAttribute('data-estok-onboarding');
    if (window.location.pathname === '/') {
      window.location.reload();
    } else {
      window.location.href = '/';
    }
  }
}
