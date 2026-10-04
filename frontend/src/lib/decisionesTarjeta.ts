// =============================================================================
// TARJETA COMPARTIDA DEL MÓDULO DE DECISIONES (pestaña "Decisiones")
// -----------------------------------------------------------------------------
// Markup ÚNICO de las tarjetas de la pestaña: lo usan TANTO la grilla de objetos
// pendientes de decisión (Bloque 1 · lib/decisionesPendientes.ts) COMO los
// grupos ya decididos (Bloques 3, 4 y 5 · lib/decisionesGrupos.ts) y el listado
// de descartes con período de gracia (Alerta Rojo · lib/descarteGracia.ts).
// Antes cada consumidor armaba su propio HTML de tarjeta; acá vive una sola
// versión (disciplina de modularidad del proyecto, sin duplicar markup).
//
// La ubicación actual se dibuja con la MISMA mini-guía analítica que el
// componente global MinimapaRuta.astro (lib/rutaCajaMinimapas.ts), alimentada
// por el contexto cargado con cargarContextoRutaCaja().
// =============================================================================

import { rutaGeograficaCardHtml } from './rutaCajaMinimapas';

/** Objeto del tablero de Decisiones (payload de /api/objetos/panel_decisiones/). */
export interface ObjetoDecision {
  id: string;
  nombre: string;
  foto_principal: string | null;
  estado_conservacion: string;
  valor_estimado: string | null;
  categoria_nombre: string | null;
  plataformas_publicadas: string[];
  /** Enlace externo a la publicación (Mercado Libre) cuando existe. */
  url_publicacion?: string | null;
  dueno_original: string | null;
  dueno_original_nombre: string | null;
  dueno_externo_nombre: string | null;
  beneficiario: string | null;
  beneficiario_nombre: string | null;
  /** True si el objeto espera la decisión de ESTE usuario (dueño/beneficiario). */
  es_decision_propia: boolean;
  ubicacion: string | null;
  ubicacion_nombre: string | null;
  contenedor: string | null;
  contenedor_nombre: string | null;
  /** Decisión ya tomada (vender / conservar / tirar / mudar). */
  owner_action: string | null;
  owner_action_label: string | null;
  /** Inicio del período de gracia del descarte. */
  descartado_en: string | null;
  /** Fecha y hora EXACTA en que vence el período de gracia (ISO 8601). */
  fecha_limite_descarte: string | null;
  en_periodo_gracia: boolean;
  segundos_para_descarte: number | null;
  descarte_listo_para_ejecutar: boolean;
  despachado_en: string | null;
  despachado_por_nombre: string | null;
}

/** Foto de reemplazo cuando el objeto no tiene imágenes (asset público). */
export const FOTO_PLACEHOLDER = '/mueble.png';

const ESTADO_COLORS: Record<string, string> = {
  excelente: 'bg-green-100 text-green-700',
  bueno: 'bg-blue-100 text-blue-700',
  regular: 'bg-yellow-100 text-yellow-700',
  malo: 'bg-orange-100 text-orange-700',
  muy_malo: 'bg-red-100 text-red-700',
};

export function escapar(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatUSD(val: string | null | undefined): string {
  if (!val) return '—';
  const num = parseFloat(val);
  if (Number.isNaN(num)) return '—';
  return `$${num.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}

/** Nombre del dueño/beneficiario mostrable en la tarjeta ('' si no hay). */
export function nombreDueno(obj: ObjetoDecision): string {
  return (
    obj.dueno_original_nombre
    || obj.dueno_externo_nombre
    || obj.beneficiario_nombre
    || ''
  );
}

/** "Habitación · Mueble" con los datos disponibles ('' si no hay ubicación). */
export function ubicacionTexto(obj: ObjetoDecision): string {
  return [obj.ubicacion_nombre, obj.contenedor_nombre].filter(Boolean).join(' · ');
}

/** Chips de plataformas donde el objeto ya fue publicado (ML / FB). */
export function chipsPublicacionHtml(obj: ObjetoDecision): string {
  const ml = obj.plataformas_publicadas.includes('mercadolibre');
  const fb = obj.plataformas_publicadas.includes('facebook');
  if (!ml && !fb) return '';
  return `<div class="flex gap-1">
    ${ml ? '<span class="px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-[10px] font-semibold">ML</span>' : ''}
    ${fb ? '<span class="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold">FB</span>' : ''}
  </div>`;
}

export interface OpcionesTarjeta {
  /** Contenido extra entre el minimapa y la botonera (chips de estado, avisos). */
  pie?: string;
  /** Botonera / veredicto al pie de la tarjeta. */
  acciones?: string;
  /** Clases extra para el <article> (por ejemplo, resaltados por urgencia). */
  extraClases?: string;
  /** Atributos data-* extra para enganchar eventos (ej. data-grupo="tirar"). */
  atributos?: string;
}

/** HTML de una tarjeta del tablero de Decisiones (foto, datos, pie y acciones). */
export function tarjetaObjetoHtml(
  obj: ObjetoDecision,
  opciones: OpcionesTarjeta = {},
): string {
  const foto = obj.foto_principal ? escapar(obj.foto_principal) : FOTO_PLACEHOLDER;
  const estadoClase = ESTADO_COLORS[obj.estado_conservacion] || 'bg-gray-100 text-gray-700';
  const ubicacion = ubicacionTexto(obj);
  const dueno = nombreDueno(obj);
  // RUTA JERÁRQUICA INTERACTIVA: texto con flechas que despliega los minimapas
  // al hacer clic (mismo widget que el listado y, en el servidor, el componente
  // components/inventario/RutaJerarquicaInteractiva.astro). Sin ruta real se
  // conserva el estado textual de siempre (nunca un plano falso).
  const ruta = rutaGeograficaCardHtml({
    id: obj.id,
    ubicacion: obj.ubicacion ?? null,
    contenedor: obj.contenedor ?? null,
  });

  return `
    <article data-objeto-card="${escapar(obj.id)}" ${opciones.atributos || ''}
      class="decision-card bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col ${opciones.extraClases || ''}">
      <div class="relative">
        <img src="${foto}" alt="" class="h-40 w-full object-cover bg-slate-100" loading="lazy" />
        <span class="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-semibold ${estadoClase}">
          ${escapar(obj.estado_conservacion || 'sin estado')}
        </span>
        <span class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-white/90 text-gray-800 text-[11px] font-bold shadow-sm">
          ${formatUSD(obj.valor_estimado)}
        </span>
      </div>
      <div class="p-3 flex flex-col gap-2 flex-1">
        <div class="min-w-0">
          <a href="/objetos/${escapar(obj.id)}"
            class="block font-semibold text-gray-900 hover:text-blue-700 hover:underline truncate"
            title="${escapar(obj.nombre)}">${escapar(obj.nombre)}</a>
          ${ruta
            ? `<div class="decision-ruta min-w-0">${ruta}</div>`
            : `<p class="text-xs text-gray-500 truncate">${ubicacion ? `📍 ${escapar(ubicacion)}` : '📍 Sin ubicación'}</p>`}
          ${obj.categoria_nombre ? `<p class="text-[11px] text-gray-400 truncate">🏷️ ${escapar(obj.categoria_nombre)}</p>` : ''}
          ${dueno ? `<p class="text-[11px] text-gray-400 truncate">👤 ${escapar(dueno)}</p>` : ''}
        </div>
        ${chipsPublicacionHtml(obj)}
        ${opciones.pie || ''}
        ${opciones.acciones || ''}
      </div>
    </article>`;
}
