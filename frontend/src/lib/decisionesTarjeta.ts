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
// Iconografía de interfaz: rutas canónicas (WebP optimizados) en UN solo módulo.
import { ASSET_MUEBLE } from './assetsUi';

/** Objeto del tablero de Decisiones (payload de /api/objetos/panel_decisiones/). */
export interface ObjetoDecision {
  id: string;
  nombre: string;
  foto_principal: string | null;
  estado_conservacion: string;
  valor_estimado: string | null;
  categoria_nombre: string | null;
  plataformas_publicadas: string[];
  /** True si el objeto ya fue publicado en alguna plataforma de venta. */
  publicado?: boolean;
  /** Estado de publicación canónico del backend: 'publicado' | 'sin_publicar'. */
  estado_publicacion?: string;
  /** Etiqueta legible del estado de publicación ('Publicado' / 'Sin publicar'). */
  estado_publicacion_label?: string | null;
  /** Estado NATIVO que reporta Mercado Libre ('active' | 'paused' | 'closed'). */
  publicacion_status?: string | null;
  /** True sólo si Mercado Libre reporta la publicación como 'active'. */
  publicacion_activa?: boolean;
  /** Advertencia lista para mostrar ('' cuando la publicación está OK). */
  publicacion_aviso?: string | null;
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
export const FOTO_PLACEHOLDER = ASSET_MUEBLE;

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

/**
 * "Habitación · Mueble" con los datos disponibles ('' si no hay ubicación).
 *
 * DEDUPLICADO: el backend resuelve `contenedor_nombre` con JERARQUÍA DE FALLBACK
 * (contenedor → espacio → ubicación), así que un objeto guardado directo en un
 * espacio devuelve el MISMO nombre en `ubicacion_nombre` y en
 * `contenedor_nombre`: se imprime una sola vez («Baño», nunca «Baño · Baño»).
 */
export function ubicacionTexto(obj: ObjetoDecision): string {
  const nombres = [obj.ubicacion_nombre, obj.contenedor_nombre]
    .map((nombre) => (nombre ?? '').trim())
    .filter(Boolean);
  return [...new Set(nombres)].join(' · ');
}

/**
 * Estado REAL de la publicación para las tarjetas (una sola versión).
 *
 * El backend verifica el ítem contra Mercado Libre (GET /items/{id}) y manda
 * `estado_publicacion` = 'publicado' | 'pausada' | 'finalizada' | 'sin_publicar'.
 * Acá se traduce a etiqueta + color + advertencia, sin comparar literales en
 * cada tarjeta.
 */
export interface InfoEstadoPublicacion {
  /** Etiqueta legible ('Publicado' / 'Pausada' / 'Finalizada' / 'Sin publicar'). */
  label: string;
  /** Clases Tailwind del chip de estado. */
  clases: string;
  /** Advertencia para el pie de la tarjeta ('' cuando está OK). */
  aviso: string;
  /** ¿La publicación está vendiendo en Mercado Libre? */
  vendiendo: boolean;
}

const INFO_ESTADO_PUBLICACION: Record<string, Omit<InfoEstadoPublicacion, 'label'>> = {
  publicado: { clases: 'bg-emerald-100 text-emerald-800', aviso: '', vendiendo: true },
  pausada: {
    clases: 'bg-amber-100 text-amber-800',
    aviso: 'Publicación pausada en Mercado Libre: reactivala para volver a vender.',
    vendiendo: false,
  },
  finalizada: {
    clases: 'bg-red-100 text-red-800',
    aviso: 'Publicación finalizada o eliminada en Mercado Libre: el enlace ya no está activo.',
    vendiendo: false,
  },
  sin_publicar: { clases: 'bg-gray-100 text-gray-600', aviso: '', vendiendo: false },
};

/** Estado legible de la publicación de una tarjeta. */
export function estadoPublicacionInfo(obj: ObjetoDecision): InfoEstadoPublicacion {
  const estado = String(obj.estado_publicacion || '').trim() || 'sin_publicar';
  const base = INFO_ESTADO_PUBLICACION[estado] || INFO_ESTADO_PUBLICACION.sin_publicar;
  const label = (obj.estado_publicacion_label || '').trim()
    || (estado === 'publicado' ? 'Publicado' : 'Sin publicar');
  // La advertencia del backend manda (texto único); si no vino, la del estado.
  const aviso = (obj.publicacion_aviso || '').trim() || base.aviso;
  return { label, clases: base.clases, aviso, vendiendo: base.vendiendo };
}

/** Chips de plataformas donde el objeto ya fue publicado (ML / FB). */
export function chipsPublicacionHtml(obj: ObjetoDecision): string {
  const plataformas = Array.isArray(obj.plataformas_publicadas)
    ? obj.plataformas_publicadas
    : [];
  const ml = plataformas.includes('mercadolibre');
  const fb = plataformas.includes('facebook');
  // Mercado Libre muestra el ESTADO REAL (pausada / finalizada) en lugar del
  // chip genérico «ML»: si la publicación dejó de estar activa, el usuario
  // tiene que verlo de un vistazo en la tarjeta. El aviso se dibuja incluso si
  // el backend ya quitó la marca 'mercadolibre' del inventario.
  const info = estadoPublicacionInfo(obj);
  const estadoFueraDeLinea = obj.estado_publicacion === 'pausada'
    || obj.estado_publicacion === 'finalizada';
  if (!ml && !fb && !estadoFueraDeLinea) return '';

  const chipMl = ml && info.vendiendo
    ? '<span class="px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-[10px] font-semibold">ML</span>'
    : '';
  const chipEstado = estadoFueraDeLinea
    ? `<span class="px-1.5 py-0.5 rounded-full ${info.clases} text-[10px] font-semibold">ML · ${escapar(info.label)}</span>`
    : '';
  return `<div class="flex gap-1 flex-wrap">
    ${chipMl}${chipEstado}
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
  // al hacer clic (el MISMO widget rutaGeograficaWidget.ts que usa el listado).
  // Sin ruta real se conserva el estado textual de siempre (nunca un plano falso).
  const ruta = rutaGeograficaCardHtml({
    id: obj.id,
    ubicacion: obj.ubicacion ?? null,
    contenedor: obj.contenedor ?? null,
  });

  return `
    <article data-objeto-card="${escapar(obj.id)}" data-ficha-url="/objetos/${escapar(obj.id)}" ${opciones.atributos || ''}
      class="decision-card cursor-pointer bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col ${opciones.extraClases || ''}">
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

// =============================================================================
// NAVEGACIÓN DE LAS TARJETAS (cuerpo → ficha interna del objeto)
// -----------------------------------------------------------------------------
// REGLA DE DESTINOS (pantalla /alertas-stock):
//   · Clic en el CUERPO o el TÍTULO de la tarjeta → ficha interna de Estok
//     (/objetos/<id>): es el `data-ficha-url` del <article>.
//   · Los BOTONES de la tarjeta (publicar, «Ver publicación», despacho,
//     descarte, reclamo…) y el widget de RUTA conservan su propia acción: la
//     navegación los ignora para que nunca se pisen dos destinos.
//   · «Ver publicación» es SIEMPRE la publicación externa de Mercado Libre
//     (ver botonPublicacionExternaHtml): nunca la ficha interna.
//
// Se registra UNA sola vez por delegación en el documento, así funciona también
// para las tarjetas que las islas vuelven a inyectar en caliente.
// =============================================================================

/** Elementos con acción propia: su clic NO navega a la ficha. */
const SELECTOR_ACCION_PROPIA = [
  'a', 'button', 'input', 'select', 'textarea', 'label', 'summary',
  '[role="button"]',
  // Widget de ruta geográfica (texto + minimapas) y acciones marcadas a mano.
  '[data-ruta-geo]', '[data-ruta-mapa]', '[data-no-ficha]',
].join(', ');

let navegacionEnlazada = false;

/** Habilita el clic en el cuerpo de las tarjetas → ficha interna del objeto. */
export function initNavegacionTarjetasDecisiones(): void {
  if (navegacionEnlazada || typeof document === 'undefined') return;
  navegacionEnlazada = true;

  document.addEventListener('click', (evento) => {
    // El clic con modificador o con el botón central abre en otra pestaña: se
    // deja el comportamiento nativo del navegador.
    if (evento.defaultPrevented || evento.button !== 0) return;
    if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;

    const objetivo = evento.target as Element | null;
    if (!objetivo || typeof objetivo.closest !== 'function') return;
    if (objetivo.closest(SELECTOR_ACCION_PROPIA)) return;

    const tarjeta = objetivo.closest<HTMLElement>('[data-ficha-url]');
    const url = (tarjeta?.dataset.fichaUrl || '').trim();
    if (!url) return;

    window.location.href = url;
  });
}

/**
 * Botón «🔗 Ver publicación»: abre EXCLUSIVAMENTE la publicación externa del
 * objeto en Mercado Libre, en una pestaña nueva. Sin URL externa activa NO se
 * dibuja: el acceso a la ficha interna es el clic en el cuerpo/título.
 */
export function botonPublicacionExternaHtml(obj: ObjetoDecision): string {
  const url = String(obj.url_publicacion || '').trim();
  if (!url) return '';
  return `
    <a href="${escapar(url)}" target="_blank" rel="noopener noreferrer"
      title="Abrir la publicación en Mercado Libre"
      class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-base">
      🔗 Ver publicación
    </a>`;
}

