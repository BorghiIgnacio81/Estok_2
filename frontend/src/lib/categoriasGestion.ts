// =============================================================================
// GESTIÓN DE CATEGORÍAS · listado + baja segura (modal «Nueva Categoría»)
// -----------------------------------------------------------------------------
// Se monta DENTRO del modal de components/CategoriaCreator.astro: además del
// alta, el operador ve las categorías del Estok activo y puede ELIMINAR las que
// ya no usa. Las 11 oficiales del sistema se listan con candado (inmutables).
//
// Contrato con el backend (DELETE /api/categorias/{id}/):
//   · 403 si `es_sistema` (categoría oficial) o si no hay membresía en el Estok.
//   · 200 con { objetos_desvinculados, subcategorias_reasignadas }.
//   · La FK `Objeto.categoria` es SET_NULL → los objetos quedan «Sin categoría»
//     (nunca se borran) y las subcategorías se promueven al padre.
//
// Tras confirmar la baja NO se recarga la página:
//   · se quita la fila del DOM,
//   · se emite 'categoriaEliminada' (lo escuchan el filtro de /objetos y el
//     combobox del formulario de objeto) y
//   · se invalida la caché de catálogos (catalogosEstok).
//
// Auth centralizada: getAuthHeaders()/API_BASE_URL SIEMPRE de services/auth.
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../services/auth';
import { cargarCategoriasEstok, invalidarCategoriasEstok } from './catalogosEstok';
import type { CategoriaEstok } from './catalogosEstok';
import { esc } from './listadoObjetosPiezas';
import { showToast } from './toast';

/** Detalle que viaja en el evento `categoriaEliminada`. */
export interface CategoriaEliminada {
  id: string;
  nombre: string;
  objetos_desvinculados: number;
  subcategorias_reasignadas: number;
}

const ICONO_TACHO =
  '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6' +
  'm1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>';

/** Recarga viva del listado montado (null si el modal está cerrado). */
let recargarListadoActivo: (() => Promise<void>) | null = null;

/**
 * Mensaje legible de un error de DRF (`detail`/`error`/campo) sin exponer
 * nunca un «Error 500» crudo al operador.
 */
function mensajeDeError(data: any, status: number): string {
  const primero = (valor: any): string => {
    const item = Array.isArray(valor) ? valor[0] : valor;
    return typeof item === 'string' ? item.trim() : '';
  };
  return (
    primero(data?.detail) ||
    primero(data?.error) ||
    primero(data?.non_field_errors) ||
    `No se pudo eliminar la categoría (${status}).`
  );
}

// ---------------------------------------------------------------------------
// RENDER DEL LISTADO
// ---------------------------------------------------------------------------

function filaCategoriaHtml(categoria: CategoriaEstok): string {
  const meta = categoria.objetosCount
    ? categoria.objetosCount === 1
      ? '1 objeto'
      : `${categoria.objetosCount} objetos`
    : 'Sin objetos';
  const accion = categoria.esSistema
    ? '<span class="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-gray-400 bg-gray-100 rounded-lg" ' +
      'title="Categoría oficial del sistema: no se puede eliminar">🔒 Sistema</span>'
    : `<button type="button" data-eliminar-categoria="${esc(categoria.id)}" ` +
      `data-nombre="${esc(categoria.nombre)}" data-objetos="${categoria.objetosCount}" ` +
      'class="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-base" ' +
      `title="Eliminar categoría" aria-label="Eliminar la categoría ${esc(categoria.nombre)}">` +
      ICONO_TACHO +
      '</button>';

  return (
    `<li data-fila-categoria="${esc(categoria.id)}" class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50">` +
    `<span class="w-6 text-center text-lg leading-none">${esc(categoria.icono)}</span>` +
    '<span class="flex-1 min-w-0">' +
    `<span class="block text-sm font-medium text-gray-800 truncate">${esc(categoria.nombre)}</span>` +
    `<span class="block text-[11px] text-gray-400">${esc(meta)}</span>` +
    '</span>' +
    accion +
    '</li>'
  );
}

// ---------------------------------------------------------------------------
// MODAL DE CONFIRMACIÓN (diálogo propio, no window.confirm)
// ---------------------------------------------------------------------------

/**
 * Pide confirmación explícita antes de la baja. Resuelve `true` sólo si el
 * operador pulsa «Eliminar»; el clic en el fondo, «Cancelar» o ESC resuelven
 * `false` (la acción destructiva NUNCA se asume por defecto).
 */
function confirmarEliminacion(datos: { nombre: string; objetos: number }): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'modalConfirmarEliminarCategoria';
    overlay.className =
      'fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm';
    const avisoObjetos = datos.objetos
      ? `<p class="mt-2 text-xs text-gray-500">${
          datos.objetos === 1
            ? '1 objeto quedará'
            : `${datos.objetos} objetos quedarán`
        } sin categoría.</p>`
      : '';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="tituloConfirmarCategoria"
        class="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div class="flex items-center gap-2 px-6 py-4 border-b border-gray-200">
          <span class="text-xl">🗑️</span>
          <h3 id="tituloConfirmarCategoria" class="text-base font-bold text-gray-900">Eliminar categoría</h3>
        </div>
        <div class="px-6 py-4">
          <p class="text-sm text-gray-700">¿Estás seguro de eliminar la categoría <strong>«${esc(datos.nombre)}»</strong>?</p>
          <p class="mt-2 text-sm text-gray-500">Los objetos asociados pasarán a <strong>«Sin categoría»</strong>.</p>
          ${avisoObjetos}
        </div>
        <div class="flex gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button type="button" data-confirmar="no"
            class="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-base">
            Cancelar
          </button>
          <button type="button" data-confirmar="si"
            class="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-base shadow-sm">
            Eliminar
          </button>
        </div>
      </div>
    `;

    function cerrar(resultado: boolean) {
      document.removeEventListener('keydown', alTeclear);
      overlay.remove();
      resolve(resultado);
    }
    function alTeclear(event: KeyboardEvent) {
      if (event.key === 'Escape') cerrar(false);
    }

    overlay.addEventListener('click', (event) => {
      const boton = (event.target as HTMLElement).closest<HTMLElement>('[data-confirmar]');
      if (boton) {
        cerrar(boton.dataset.confirmar === 'si');
        return;
      }
      if (event.target === overlay) cerrar(false);
    });
    document.addEventListener('keydown', alTeclear);

    document.body.appendChild(overlay);
    // Foco en «Cancelar»: un Enter accidental no borra nada.
    overlay.querySelector<HTMLButtonElement>('[data-confirmar="no"]')?.focus();
  });
}


// ---------------------------------------------------------------------------
// BAJA CONTRA LA API
// ---------------------------------------------------------------------------

async function eliminarCategoria(
  id: string,
  nombre: string,
): Promise<CategoriaEliminada | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/categorias/${encodeURIComponent(id)}/`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return null;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(mensajeDeError(data, res.status), 'error');
      return null;
    }
    return {
      id,
      nombre,
      objetos_desvinculados: Number(data?.objetos_desvinculados ?? 0) || 0,
      subcategorias_reasignadas: Number(data?.subcategorias_reasignadas ?? 0) || 0,
    };
  } catch {
    showToast('Error de conexión al eliminar la categoría.', 'error');
    return null;
  }
}

// ---------------------------------------------------------------------------
// MONTAJE DEL GESTOR
// ---------------------------------------------------------------------------

/**
 * Monta el listado de categorías (con tacho por fila) en `host` y engancha la
 * baja con confirmación. Idempotente por host: el modal puede abrirse varias
 * veces sin duplicar listeners.
 *
 * @param alEliminar callback opcional tras una baja exitosa.
 */
export function initCategoriasGestion(
  host: HTMLElement | null,
  alEliminar?: (categoria: CategoriaEliminada) => void,
): void {
  if (!host || (host as any).__categoriasGestionInit) return;
  (host as any).__categoriasGestionInit = true;

  const lista = document.createElement('ul');
  lista.className = 'max-h-48 space-y-0.5 overflow-y-auto pr-1';
  lista.innerHTML = '<li class="px-2 py-2 text-xs text-gray-400">Cargando categorías...</li>';
  host.replaceChildren(lista);

  const vacio = () =>
    '<li class="px-2 py-2 text-xs text-gray-400">Todavía no hay categorías en este Estok.</li>';

  async function cargar(): Promise<void> {
    // `forzar` = true: el listado del gestor siempre refleja el servidor.
    const categorias = await cargarCategoriasEstok(true);
    if (!categorias.length) {
      lista.innerHTML = vacio();
      return;
    }
    // Las personalizadas primero: son las únicas que el operador puede borrar.
    const ordenadas = [...categorias].sort((a, b) => {
      if (a.esSistema !== b.esSistema) return a.esSistema ? 1 : -1;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
    lista.innerHTML = ordenadas.map(filaCategoriaHtml).join('');
  }

  recargarListadoActivo = cargar;

  lista.addEventListener('click', async (event) => {
    const boton = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-eliminar-categoria]',
    );
    if (!boton) return;
    const id = boton.dataset.eliminarCategoria;
    const nombre = boton.dataset.nombre || 'esta categoría';
    const objetos = Number(boton.dataset.objetos || 0) || 0;
    if (!id) return;

    const confirmado = await confirmarEliminacion({ nombre, objetos });
    if (!confirmado) return;

    boton.setAttribute('disabled', 'disabled');
    const resultado = await eliminarCategoria(id, nombre);
    boton.removeAttribute('disabled');
    if (!resultado) return;

    // 1) Caché fuera: cualquier combobox que re-cargue verá la lista real.
    invalidarCategoriasEstok();
    // 2) Fila fuera del DOM (sin recargar la página).
    boton.closest('li')?.remove();
    if (!lista.querySelector('li')) {
      lista.innerHTML = vacio();
      recargarListadoActivo = null;
    }
    // 3) Aviso + evento para el resto de la pantalla.
    const desvinculados = resultado.objetos_desvinculados;
    const detalle = desvinculados
      ? desvinculados === 1
        ? '1 objeto pasó a «Sin categoría»'
        : `${desvinculados} objetos pasaron a «Sin categoría»`
      : 'No había objetos asociados';
    showToast(`🗑️ Categoría «${nombre}» eliminada · ${detalle}`, 'success');
    window.dispatchEvent(new CustomEvent('categoriaEliminada', { detail: resultado }));
    alEliminar?.(resultado);
  });

  void cargar();
}

/** Refresca el listado montado (p. ej. tras crear una categoría en el modal). */
export function refrescarCategoriasGestion(): void {
  invalidarCategoriasEstok();
  void recargarListadoActivo?.();
}

