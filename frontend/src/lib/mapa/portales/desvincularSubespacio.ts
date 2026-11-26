// =============================================================================
// DESVINCULAR UN SUB-ESPACIO DEL ESPACIO QUE LO CONTIENE (corrección en caliente)
// -----------------------------------------------------------------------------
// Permite reparar una ASIGNACIÓN ACCIDENTAL desde la propia pantalla: una pieza
// que quedó colgando de un espacio equivocado (y por eso aparece como
// sub-espacio fantasma) se DESVINCULA del padre sin borrar su inventario.
//
// Contrato de persistencia (fuente única, sin duplicar headers):
//   PUT /api/contenedores/{id}/  { "parent_contenedor": null }
// El backend resuelve la operación como guardado parcial: la pieza deja de ser
// hija del espacio activo y queda como espacio raíz de su MISMA habitación
// (`ubicacion` no se toca). Sus objetos y sub-espacios se conservan intactos.
//
// NO se define ningún header propio: la autenticación vive en
// src/services/auth (getAuthHeaders) — regla de Auth centralizado del proyecto.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../../../services/auth';
import { escapeHtml, toast } from '../../mapaJerarquico';
import type { NodoPortal } from './estadoPortales';

/** Datos mínimos de la pieza a desvincular (tarjeta del lienzo o selector). */
export interface PiezaDesvinculable {
  id: string;
  nombre: string;
}

/** Resultado de la desvinculación (para que el lienzo repinte o avise). */
export interface ResultadoDesvincular {
  ok: boolean;
  error?: string;
}

/**
 * ¿La pieza puede desvincularse de su padre?
 *
 * La arquitectura ANCLADA al cuarto (CONJUNTO / MUEBLE_INMUEBLE) no puede
 * cambiar de padre: el backend responde 400. El lienzo no ofrece una acción
 * imposible. Cajas y muebles móviles sí se pueden desvincular.
 */
export function puedeDesvincularse(pieza: {
  tipo_contenedor?: string | null;
  protegido?: boolean;
}): boolean {
  const tipo = String(pieza.tipo_contenedor ?? '').toUpperCase();
  if (tipo === 'CONJUNTO' || tipo === 'MUEBLE_INMUEBLE') return false;
  return true;
}

/**
 * Desvincula `pieza` del espacio `padre` (la deja como raíz de la habitación).
 * Devuelve `{ ok: true }` sólo cuando el backend confirmó el cambio.
 */
export async function desvincularSubespacioDePadre(
  padre: NodoPortal,
  pieza: PiezaDesvinculable,
): Promise<ResultadoDesvincular> {
  const id = String(pieza?.id ?? '').trim();
  if (!id) return { ok: false, error: 'La pieza no tiene identificador.' };

  const confirmado = window.confirm(
    `¿Desvincular «${pieza.nombre}» de «${padre.nombre}»?\n\n` +
      'La pieza dejará de figurar dentro de este espacio y quedará como espacio ' +
      'independiente de la misma habitación. Su contenido NO se borra.',
  );
  if (!confirmado) return { ok: false, error: 'Operación cancelada.' };

  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/${encodeURIComponent(id)}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_contenedor: null }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return { ok: false, error: 'Sesión expirada.' };
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const detalle =
        (data?.error as string) ||
        (data?.detail as string) ||
        (data?.parent_contenedor as string[] | undefined)?.join(' ') ||
        'No se pudo desvincular la pieza.';
      toast(`❌ ${escapeHtml(String(detalle))}`);
      return { ok: false, error: String(detalle) };
    }
    toast(`🔗 «${pieza.nombre}» desvinculado de «${padre.nombre}».`);
    window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
    return { ok: true };
  } catch {
    const error = 'Error de conexión al desvincular la pieza.';
    toast(`❌ ${error}`);
    return { ok: false, error };
  }
}

/**
 * Conecta los botones «⛓️‍💥» de las TARJETAS de una lista de piezas
 * (`selectorPiezasHtml`), tanto en el Panel de Contenido del Espacio Final como
 * en el listado del editor de un contenedor.
 *
 * Idempotente por render: el host se reescribe con `innerHTML`, así que los
 * listeners viejos desaparecen junto con sus nodos.
 */
export function conectarDesvinculacionTarjetas(opts: {
  scope: ParentNode;
  padre: NodoPortal;
}): void {
  opts.scope.querySelectorAll<HTMLButtonElement>('[data-desvincular-pieza]').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      // La fila entera es un portal/dropzone: el clic de la acción NO debe abrir
      // el espacio ni disparar el arrastre.
      ev.preventDefault();
      ev.stopPropagation();
      const id = btn.dataset.id ?? btn.dataset.desvincularPieza ?? '';
      if (!id) return;
      const nombre = btn.dataset.nombre || 'la pieza';
      btn.disabled = true;
      const resultado = await desvincularSubespacioDePadre(opts.padre, { id, nombre });
      if (!resultado.ok) {
        btn.disabled = false;
        return;
      }
      btn.closest('li')?.remove();
    });
  });
}
