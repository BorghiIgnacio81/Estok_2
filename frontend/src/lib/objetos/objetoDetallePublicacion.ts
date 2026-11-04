// =============================================================================
// FICHA DE OBJETO · PUBLICACIÓN EN MERCADO LIBRE (estado REAL)
// -----------------------------------------------------------------------------
// La ficha muestra el estado real de la publicación del objeto y lo vuelve a
// verificar contra la API de Mercado Libre al abrirse:
//
//   · GET  /api/objetos/<id>/  → `publicacion_ml` (estado guardado, sin red).
//   · POST /api/mercadolibre/sincronizar_estados/ {objeto_id} → GET /items/{id}
//     en el backend y persistencia del status real (active / paused / closed).
//
// Si Mercado Libre reporta la publicación pausada o finalizada, se advierte y
// el enlace deja de ofrecerse. El botón «Ver publicación» usa EXCLUSIVAMENTE la
// permalink guardada en la base (la persiste el backend al crear, editar y
// sincronizar el ítem): nunca se arma una URL manual con el item_id, que en las
// publicaciones de catálogo (UP) devuelve 404.
// Vive fuera de la página por la regla de modularización (<400 líneas de UI).
// =============================================================================

import { refOpcional } from '../dom';
import { escaparHtml } from '../invitacionEstok';
import { showToast } from '../toast';
import { sincronizarEstadosML } from '../../services/mercadolibre';
import type { EstadoPublicacionML } from '../../services/mercadolibre';

const SECCION_ID = 'publicacionMLSection';
const CONTENIDO_ID = 'publicacionMLContenido';

/** Colores/íconos por estado canónico de la publicación. */
const ESTILOS: Record<string, { chip: string; icono: string; borde: string }> = {
  publicado: {
    chip: 'bg-emerald-100 text-emerald-800',
    icono: '🔗',
    borde: 'border-emerald-200',
  },
  pausada: {
    chip: 'bg-amber-100 text-amber-800',
    icono: '⏸️',
    borde: 'border-amber-200',
  },
  finalizada: {
    chip: 'bg-red-100 text-red-800',
    icono: '⛔',
    borde: 'border-red-200',
  },
  sin_publicar: {
    chip: 'bg-gray-100 text-gray-600',
    icono: '📢',
    borde: 'border-gray-200',
  },
};

function estilo(estado: string) {
  return ESTILOS[estado] || ESTILOS.sin_publicar;
}

/**
 * Pinta el bloque de publicación de la ficha.
 *
 * `null` (objeto sin publicación vinculada) oculta la sección completa: la
 * ficha de un objeto que nunca se publicó no muestra nada de Mercado Libre.
 */
export function renderPublicacionML(estado: EstadoPublicacionML | null | undefined): void {
  const seccion = refOpcional<HTMLElement>(SECCION_ID);
  const contenido = refOpcional<HTMLElement>(CONTENIDO_ID);
  if (!seccion || !contenido) return;

  const estadoActual = String(estado?.estado || '').trim();
  if (!estado || estadoActual === 'sin_publicar' || !estado.item_id) {
    seccion.classList.add('hidden');
    contenido.innerHTML = '';
    return;
  }

  const visual = estilo(estadoActual);
  // ENLACE: SIEMPRE la PERMALINK guardada en la base. El backend la persiste al
  // crear, editar (PUT /items) y sincronizar con los ítems del vendedor
  // (GET /users/{user_id}/items/search); `url` ya viene derivada de ella, y
  // `permalink` se usa como respaldo. NUNCA se arma la URL con el item_id:
  // `articulo.mercadolibre.com.ar/<id>` devuelve 404 en publicaciones de
  // catálogo (UP). Sin permalink no se dibuja el botón.
  const permalink = String(estado.permalink || estado.url || '').trim();
  const vigente = estadoActual === 'publicado' || estadoActual === 'pausada';
  const enlace = permalink && vigente
    ? `<a href="${escaparHtml(permalink)}" target="_blank" rel="noopener noreferrer"
        class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100 transition-base">
        🔗 Ver publicación
      </a>`
    : '';

  contenido.innerHTML = `
    <div class="flex flex-wrap items-center gap-2">
      <span class="px-2 py-0.5 rounded-full ${visual.chip} text-xs font-bold">
        ${visual.icono} ${escaparHtml(estado.label || estadoActual)}
      </span>
      <span class="text-[11px] text-gray-500">Ítem ${escaparHtml(estado.item_id)}</span>
      ${enlace}
    </div>
    ${estado.aviso
      ? `<p class="mt-2 text-xs font-medium text-amber-700">⚠️ ${escaparHtml(estado.aviso)}</p>`
      : ''}`;

  seccion.classList.remove('hidden');
  seccion.classList.remove(
    'border-emerald-200', 'border-amber-200', 'border-red-200', 'border-gray-200',
  );
  seccion.classList.add(visual.borde);
}

/**
 * Verifica el estado REAL del ítem contra Mercado Libre y repinta el bloque.
 *
 * Best-effort: si la verificación falla (sin conexión, cuenta de ML
 * desconectada) la ficha conserva el estado que ya vino en el detalle.
 */
export async function verificarPublicacionML(objetoId: string): Promise<void> {
  if (!objetoId) return;
  try {
    const resultado = await sincronizarEstadosML({ objetoId, forzar: true });
    const estado = resultado?.estado || resultado?.items?.[0];
    if (estado) {
      renderPublicacionML(estado);
      if (estado.cambiado) {
        const mensaje = estado.estado === 'publicado'
          ? '🔗 La publicación sigue activa en Mercado Libre.'
          : `⚠️ Publicación ${String(estado.label || '').toLowerCase()} en Mercado Libre.`;
        showToast(mensaje, estado.estado === 'publicado' ? 'success' : 'info');
      }
    }
  } catch (error) {
    console.warn(
      '[Publicación ML] No se pudo verificar el estado real del ítem:',
      error,
    );
  }
}
