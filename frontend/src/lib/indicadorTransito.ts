// =============================================================================
// INDICADOR DE TRÁNSITO · CAPA DE RENDER COMPARTIDA
// -----------------------------------------------------------------------------
// ÚNICA fuente del marcado de los estados «En Tránsito». La consumen:
//   · lib/visorContenedorGrandeHtml.ts       (tránsito INTERNO · rojo)
//   · lib/mudanzaInventario.ts               (tránsito GENERAL · ámbar)
//   · components/ui/IndicadorTransito.astro  (SSR/fallback de #mudanzaTransito)
// Las clases semánticas (.estado-transito*) viven en styles/inventario.css: acá
// NUNCA se declaran utilidades Tailwind.
// =============================================================================

export type TipoTransito = 'interno' | 'general';

const TEXTO_POR_DEFECTO: Record<TipoTransito, string> = {
  interno: '🔴 En tránsito interno',
  general: '🚚 En Tránsito',
};

const TITULO_POR_DEFECTO: Record<TipoTransito, string> = {
  interno:
    'En Tránsito Interno: el elemento está físicamente dentro del mueble pero todavía no fue ubicado en un estante concreto.',
  general:
    'En Tránsito: viaja al Estok destino SIN ubicación física (limbo del inquilinato).',
};

/** Escapa texto para inyectarlo en HTML de forma segura. */
function esc(valor: string): string {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Pastilla del indicador de tránsito (idéntica firma que el componente .astro). */
export function indicadorTransitoHtml(
  tipo: TipoTransito = 'general',
  texto?: string,
): string {
  const contenido = texto ?? TEXTO_POR_DEFECTO[tipo];
  const titulo = TITULO_POR_DEFECTO[tipo];
  return `<span class="estado-transito estado-transito--${tipo}" title="${esc(titulo)}">${contenido}</span>`;
}
