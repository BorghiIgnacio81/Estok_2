// =============================================================================
// PASO 2 DEL ASISTENTE — DIVISIÓN DE ESPACIOS (controlador dedicado)
// -----------------------------------------------------------------------------
// Encapsula TODO el Paso 2 para que wizard.ts quede como una máquina de pasos
// delgada (límite de 400 líneas por módulo). Dos modos excluyentes según las
// plantas elegidas en el Paso 1:
//
//   · 1 PLANTA  → PLANO ESPACIAL REACTIVO (./planoPaso2): rectángulos mutables
//                 libres con fusión, resizing elástico y perímetro. NACE VACÍO:
//                 el usuario lo construye con «➕ Habitación» y cada alta se
//                 persiste al toque. Al confirmar el paso corre la MISMA
//                 compactación inteligente del botón «💾 Guardar».
//   · 2+ PLANTAS → flujo CLÁSICO de chips: se juntan nombres y se crean los
//                 ambientes en lote recién al confirmar (el reparto físico entre
//                 plantas se hace después en el Mapa Estok).
//
// El controlador NO posee el estado del asistente: recibe el `root`, los callbacks
// de navegación/estado y devuelve los ambientes vigentes por `setAmbientes`.
// =============================================================================

import { escapeHtml } from '../mapaJerarquico';
import { crearAmbiente, listarAmbientes } from './api';
import type { RecursoCreado } from './api';
import { avisoGlobal, mensajeDe } from './comunes';
import { desmontarPlanoPaso2, montarPlanoPaso2 } from './planoPaso2';
import { compactarYGuardarLienzos } from '../plantaGuardado';

/** Tope de ambientes del asistente (chips y plano comparten el mismo límite). */
const MAX_AMBIENTES = 8;
/** Atajos de un toque para los ambientes más comunes de una casa. */
const SUGERENCIAS_AMBIENTES = ['Cocina', 'Habitación', 'Living', 'Baño', 'Garaje', 'Depósito'];

/** Puente con el asistente (navegación, carteles y estado de ocupado). */
export interface ContextoPasoEspacios {
  /** Raíz del asistente (scope de todas las consultas de DOM). */
  root: HTMLElement;
  /** Plantas elegidas en el Paso 1: 1 = plano 2D espacial. */
  pisos: () => number;
  /** Navega a un paso (índice 0-based). */
  irAPaso: (indice: number) => void;
  /** Muestra/limpia el cartel del paso 2. */
  error: (mensaje: string | null) => void;
  /** true si el asistente ya está ejecutando una operación. */
  ocupado: () => boolean;
  /** Marca/desmarca la operación en curso. */
  marcarOcupado: (ocupado: boolean) => void;
  /** Estado visual de un botón (disabled + texto + opacidad). */
  cargando: (btn: HTMLButtonElement | null, activo: boolean, texto: string) => void;
  /** Entrega al asistente los ambientes vigentes (selector del Paso 3). */
  setAmbientes: (ambientes: RecursoCreado[]) => void;
}

export class PasoEspacios {
  private readonly ctx: ContextoPasoEspacios;
  /** Nombres acumulados en el flujo clásico (2+ plantas). */
  private nombres: string[] = [];
  /** El modelador espacial ya quedó montado (se monta UNA sola vez). */
  private planoListo = false;

  constructor(ctx: ContextoPasoEspacios) {
    this.ctx = ctx;
  }

  private q<T extends Element>(selector: string): T | null {
    return this.ctx.root.querySelector<T>(selector);
  }

  private mostrar(mensaje: string | null): void {
    this.ctx.error(mensaje);
  }

  /** Conecta TODOS los controles del paso (chips, sugerencias y botones). */
  iniciar(): void {
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
    this.q<HTMLElement>('#onbGuardarAmbientes')?.addEventListener('click', () => void this.confirmar());
    this.q<HTMLElement>('#onbOmitirPaso2')?.addEventListener('click', () => this.ctx.irAPaso(2));
    this.pintarSugerencias();
    this.pintarChips();
  }

  /**
   * Entra al Paso 2 y BIFURCA la interfaz según las plantas del Estok:
   *  - 1 planta   → plano espacial reactivo (se monta una sola vez).
   *  - 2+ plantas → entrada + sugerencias + chips clásicos.
   */
  async entrar(): Promise<void> {
    const espacial = this.ctx.pisos() <= 1;
    const alternar = (selector: string, visible: boolean): void => {
      this.q<HTMLElement>(selector)?.classList.toggle('hidden', !visible);
    };
    alternar('#onbPaso2IntroClasico', !espacial);
    alternar('#onbPaso2IntroEspacial', espacial);
    alternar('#onbAmbientesEntrada', !espacial);
    alternar('#onbSugerencias', !espacial);
    alternar('#onbAmbientesChips', !espacial);
    alternar('#onbPlanoTip', espacial);
    alternar('#onbPlanoUnico', espacial);
    const btn = this.q<HTMLButtonElement>('#onbGuardarAmbientes');
    if (btn) btn.textContent = espacial ? 'Continuar ➜' : 'Crear espacios y continuar';

    if (!espacial) {
      desmontarPlanoPaso2();
      return;
    }
    const cont = this.q<HTMLElement>('#onbPlanoUnico');
    if (!cont || this.planoListo) return;
    this.planoListo = true;
    try {
      await montarPlanoPaso2({
        contenedor: cont,
        maxItems: MAX_AMBIENTES,
        aviso: (mensaje) => this.mostrar(mensaje),
        // El Paso 3 re-lee los ambientes del backend: el plano crea sobre la marcha.
        alCambiarAmbientes: () => this.ctx.setAmbientes([]),
      });
    } catch {
      this.planoListo = false;
      this.mostrar(
        'No se pudo cargar el plano espacial. Podés omitir este paso y crearlo luego desde Almacenamiento.',
      );
    }
  }

  /** Botón «Crear espacios y continuar» (o «Continuar ➜» en modo espacial). */
  private async confirmar(): Promise<void> {
    if (this.ctx.ocupado()) return;
    if (this.ctx.pisos() <= 1) {
      await this.confirmarEspacial();
      return;
    }
    await this.confirmarClasico();
  }

  /**
   * Cierre del Paso 2 ESPACIAL: las habitaciones ya se persistieron al
   * inyectarse, así que ANTES de continuar corre la compactación inteligente
   * (la misma física del botón «💾 Guardar» de Almacenamiento: superposición
   * real → zona vacía más cercana; brechas mínimas → estirado simétrico) y
   * después se re-lee la lista real (el Paso 3 ofrece el selector correcto).
   */
  private async confirmarEspacial(): Promise<void> {
    const btn = this.q<HTMLButtonElement>('#onbGuardarAmbientes');
    this.mostrar(null);
    this.ctx.marcarOcupado(true);
    this.ctx.cargando(btn, true, 'Verificando…');
    try {
      await compactarYGuardarLienzos();
      const ambientes = await listarAmbientes();
      if (ambientes.length === 0) {
        this.mostrar(
          'Tu plano todavía no tiene habitaciones: usá «➕ Habitación» para inyectar la primera o tocá «Omitir este paso».',
        );
        return;
      }
      this.ctx.setAmbientes(ambientes);
      avisoGlobal(`✅ ${ambientes.length} habitación(es) dibujada(s) en tu plano.`);
      this.ctx.irAPaso(2);
    } catch (err) {
      this.mostrar(mensajeDe(err, 'No se pudo leer tu plano. Reintentá u omití este paso.'));
    } finally {
      this.ctx.marcarOcupado(false);
      this.ctx.cargando(btn, false, 'Continuar ➜');
    }
  }

  /** Cierre del Paso 2 CLÁSICO: crea en lote los ambientes escritos y avanza. */
  private async confirmarClasico(): Promise<void> {
    if (this.nombres.length === 0) {
      this.mostrar('Escribí al menos un ambiente (ej: Cocina) o usá «Omitir este paso».');
      return;
    }
    const btn = this.q<HTMLButtonElement>('#onbGuardarAmbientes');
    const creados: RecursoCreado[] = [];
    this.mostrar(null);
    this.ctx.marcarOcupado(true);
    this.ctx.cargando(btn, true, 'Creando espacios…');
    try {
      for (let i = 0; i < this.nombres.length; i++) {
        creados.push(await crearAmbiente(this.nombres[i], i));
      }
      this.ctx.setAmbientes(creados);
      avisoGlobal(`✅ ${creados.length} ambiente${creados.length === 1 ? '' : 's'} creado${creados.length === 1 ? '' : 's'}.`);
      this.ctx.irAPaso(2);
    } catch (err) {
      // Parcial tolerado: lo ya creado se conserva y el paso avanza igual.
      this.ctx.setAmbientes(creados);
      if (creados.length > 0) {
        avisoGlobal(`⚠️ Se crearon ${creados.length} ambiente(s); el resto no se pudo guardar.`);
        this.ctx.irAPaso(2);
      }
      this.mostrar(mensajeDe(err, 'No se pudieron crear los ambientes.'));
    } finally {
      this.ctx.marcarOcupado(false);
      this.ctx.cargando(btn, false, 'Crear espacios y continuar');
    }
  }

  // ── CHIPS (flujo clásico de 2+ plantas) ────────────────────────────────────

  private agregarNombre(valor: string): void {
    const nombre = valor.trim();
    if (!nombre) return;
    if (this.nombres.length >= MAX_AMBIENTES) {
      this.mostrar(`El asistente crea hasta ${MAX_AMBIENTES} ambientes. Después podés sumar más desde Almacenamiento.`);
      return;
    }
    if (this.nombres.some((n) => n.toLowerCase() === nombre.toLowerCase())) {
      this.mostrar(`«${nombre}» ya está en la lista.`);
      return;
    }
    this.nombres = [...this.nombres, nombre];
    this.pintarChips();
    this.mostrar(null);
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
}
