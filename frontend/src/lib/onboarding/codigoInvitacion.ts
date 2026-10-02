// =============================================================================
// ASISTENTE DE BIENVENIDA — VINCULACIÓN POR CÓDIGO DE INVITACIÓN
// -----------------------------------------------------------------------------
// Modal flotante (Tailwind) de la cabecera del asistente que permite a un
// usuario recién registrado entrar a un Estok (Tenant) YA existente que otro
// inquilino le compartió, en lugar de fundar el suyo.
//
// La validación de negocio NO se duplica acá: se delega 100% al backend
// (POST /api/estoks/unirse/), que verifica que el código exista en PostgreSQL y
// siga vigente —CodigoInvitacion.es_valido: activo, no expirado y con
// `usos_actuales < usos_maximos` (los códigos del modal nacen con 4 usos)—,
// incrementa el contador de usos en +1 y crea la Membresía del usuario en ese
// Estok devolviendo su `id`.
//
// Auth 100% centralizada: la petición usa unirseConCodigo() de src/services/auth
// y la activación del inquilinato reutiliza activarEstok() de ./api (JWT +
// X-Estok-Id, caché de usuario y `ultimo_estok_activo` del backend).
// =============================================================================

import { unirseConCodigo } from '../../services/auth';
import type { EstokInfo } from '../../types';
import { activarEstok } from './api';
import { avisoGlobal, mensajeDe } from './comunes';

/** Texto controlado que exige el requerimiento ante un código inválido o vencido. */
const MENSAJE_CODIGO_INVALIDO = 'Código inválido o vencido.';

/** Longitud mínima aceptada para evitar disparar consultas por ruido de tipeo. */
const LONGITUD_MINIMA_CODIGO = 6;

/** Puente con el asistente (estado de ocupado y cierre con acceso concedido). */
export interface ContextoModalCodigo {
  /** Raíz del asistente (scope de todas las consultas de DOM). */
  root: HTMLElement;
  /** true si el asistente ya está ejecutando otra operación. */
  ocupado: () => boolean;
  /** Marca/desmarca la operación en curso (comparte el candado del asistente). */
  marcarOcupado: (ocupado: boolean) => void;
  /** Se dispara al vincular con éxito: el asistente cierra y navega al panel. */
  onExito: (estok: EstokInfo) => void;
}

export class ModalCodigoInvitacion {
  private readonly ctx: ContextoModalCodigo;

  constructor(ctx: ContextoModalCodigo) {
    this.ctx = ctx;
  }

  private q<T extends Element>(selector: string): T | null {
    return this.ctx.root.querySelector<T>(selector);
  }

  /** Conecta apertura, cierre (Cruz/Cancelar/fondo) y envío del código. */
  iniciar(): void {
    this.q<HTMLElement>('#onbCodigoBtn')?.addEventListener('click', () => this.abrir());
    this.q<HTMLElement>('#onbCodigoCerrar')?.addEventListener('click', () => this.cerrar());
    this.q<HTMLElement>('#onbCodigoCancelar')?.addEventListener('click', () => this.cerrar());
    this.q<HTMLElement>('#onbCodigoBackdrop')?.addEventListener('click', () => this.cerrar());
    this.q<HTMLElement>('#onbCodigoVincular')?.addEventListener('click', () => void this.vincular());
    this.q<HTMLInputElement>('#onbCodigoInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.vincular();
      }
    });
  }

  private abrir(): void {
    this.error(null);
    const input = this.q<HTMLInputElement>('#onbCodigoInput');
    if (input) {
      input.value = '';
      input.focus();
    }
    this.visible(true);
  }

  private cerrar(): void {
    this.error(null);
    this.visible(false);
  }

  /** Alterna display del overlay sin depender del orden de utilidades Tailwind. */
  private visible(mostrar: boolean): void {
    const modal = this.q<HTMLElement>('#onbCodigoModal');
    if (!modal) return;
    modal.classList.toggle('hidden', !mostrar);
    modal.classList.toggle('flex', mostrar);
  }

  private error(mensaje: string | null): void {
    const el = this.q<HTMLElement>('#onbCodigoError');
    if (!el) return;
    if (mensaje) {
      el.textContent = mensaje;
      el.classList.remove('hidden');
    } else {
      el.textContent = '';
      el.classList.add('hidden');
    }
  }

  private cargando(activo: boolean): void {
    const btn = this.q<HTMLButtonElement>('#onbCodigoVincular');
    if (!btn) return;
    btn.disabled = activo;
    btn.textContent = activo ? 'Vinculando…' : 'Vincular Estok';
    btn.classList.toggle('opacity-60', activo);
  }

  /**
   * Envía el código al backend. Si es válido, activa el Estok recibido
   * (localStorage 'estok_activo_id' → header X-Estok-Id + caché de usuario) y
   * avisa al asistente para que cierre y redirija al panel compartido.
   */
  private async vincular(): Promise<void> {
    if (this.ctx.ocupado()) return;

    const input = this.q<HTMLInputElement>('#onbCodigoInput');
    const codigo = (input?.value || '').trim().toUpperCase();
    if (codigo.length < LONGITUD_MINIMA_CODIGO) {
      this.error('Ingresá el código de invitación completo.');
      return;
    }

    this.error(null);
    this.ctx.marcarOcupado(true);
    this.cargando(true);
    try {
      const data = await unirseConCodigo(codigo);
      await activarEstok(data.estok);
      avisoGlobal(`✅ Te uniste a «${data.estok.nombre}». ¡Acceso concedido!`);
      this.cerrar();
      this.ctx.onExito(data.estok);
    } catch (err) {
      // 400 = código inexistente/vencido o sin usos: mensaje controlado in-place.
      // Cualquier otro fallo (red/5xx) informa su causa real sin mentir al usuario.
      const estado = (err as { status?: number } | null)?.status;
      this.error(
        estado === 400
          ? MENSAJE_CODIGO_INVALIDO
          : mensajeDe(err, 'No se pudo vincular el código. Reintentá.'),
      );
      this.ctx.marcarOcupado(false);
      this.cargando(false);
    }
  }
}
