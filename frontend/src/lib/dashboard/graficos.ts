// =============================================================================
// DASHBOARD - GRAFICOS Y TARJETAS (barras, donut SVG, categorias, ultimos)
// Extraido de pages/index.astro (Fase A refactor preventivo).
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../../services/auth';
import type { DecisionPorUsuario } from './tipos';

  // ===========================================================================
  // MAPEOS
  // ===========================================================================

  // Taxonomía unificada: la clasificación es por categoría (11 oficiales Meli).
  // Los mapas viejos por "tipo" (libro/tecnologia/mueble/ropa) fueron eliminados.

  // Ícono por categoría oficial (11 Meli). Usado en "Últimos objetos".
  function getIconoCategoria(nombre: string | null | undefined): string {
    if (!nombre) return '';
    const map: Record<string, string> = {
      'Muebles': '🛋️',
      'Arte': '🎨',
      'Coleccionables': '🏺',
      'Antigüedades': '🕰️',
      'Jardín': '🌿',
      'Computación': '💻',
      'Electrónica': '📺',
      'Cocina': '🍳',
      'Hogar': '🏠',
      'Herramientas': '🔧',
      'Materiales': '🧱',
    };
    return map[nombre] || '';
  }

  export const ESTADO_LABELS: Record<string, { label: string; color: string }> = {

    excelente: { label: 'Excelente', color: 'bg-green-100 text-green-700' },
    bueno: { label: 'Bueno', color: 'bg-blue-100 text-blue-700' },
    regular: { label: 'Regular', color: 'bg-yellow-100 text-yellow-700' },
    malo: { label: 'Malo', color: 'bg-orange-100 text-orange-700' },
    muy_malo: { label: 'Muy malo', color: 'bg-red-100 text-red-700' },
  };

  // ===========================================================================
  // RENDERIZADO DE BARRAS DE PROGRESO
  // ===========================================================================

  export function renderBarChart(containerId: string, data: Record<string, number>, labelMap: Record<string, any>, total: number) {
    const container = document.getElementById(containerId)!;
    const entries = Object.entries(data);

    if (entries.length === 0) {
      container.innerHTML = '<p class="text-sm text-gray-400">Sin datos</p>';
      return;
    }

    container.innerHTML = entries.map(([key, count]) => {
      const info = labelMap[key] || { label: key, color: 'bg-gray-100 text-gray-700' };
      const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
      return `
        <div>
          <div class="flex justify-between items-center mb-1">
            <span class="text-sm text-gray-700">${info.label || key}</span>
            <span class="text-sm font-medium text-gray-900">${count} (${percentage}%)</span>
          </div>
          <div class="w-full bg-gray-100 rounded-full h-2.5">
            <div class="h-2.5 rounded-full ${info.color.split(' ')[0]}" style="width: ${percentage}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ===========================================================================
  // RENDERIZADO DE ÚLTIMOS OBJETOS
  // ===========================================================================

  export function renderUltimos(objetos: any[]) {
    const container = document.getElementById('ultimosContainer')!;
    if (!objetos || objetos.length === 0) {
      container.innerHTML = '<p class="text-sm text-gray-400">No hay objetos registrados aún.</p>';
      return;
    }

    container.innerHTML = objetos.map(o => {
      const icono = o.categoria_nombre ? getIconoCategoria(o.categoria_nombre) : '📦';
      return `
        <a href="/objetos/${o.id}" class="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-base border border-gray-100">
          <span class="text-lg">${icono}</span>

          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900 truncate">${o.nombre}</p>
            <p class="text-xs text-gray-400">${new Date(o.fecha_registro).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
          </div>
          ${o.valor_estimado ? `<span class="text-sm font-medium text-green-700">$${Number(o.valor_estimado).toLocaleString('es-AR')}</span>` : ''}
        </a>
      `;
    }).join('');
  }

  // ===========================================================================
  // RENDERIZADO DE CARDS DE CATEGORÍAS (dinámicas desde /api/categorias/)
  // Consume las 11 categorías oficiales (Mercado Libre) del backend unificado.
  // ===========================================================================

  // Paleta cíclica para las cards (evita hardcodear categorías específicas)
  const CATEGORIA_PALETA = [
    { bg: 'bg-blue-100', text: 'text-blue-700' },
    { bg: 'bg-green-100', text: 'text-green-700' },
    { bg: 'bg-amber-100', text: 'text-amber-700' },
    { bg: 'bg-purple-100', text: 'text-purple-700' },
    { bg: 'bg-rose-100', text: 'text-rose-700' },
    { bg: 'bg-cyan-100', text: 'text-cyan-700' },
    { bg: 'bg-indigo-100', text: 'text-indigo-700' },
    { bg: 'bg-orange-100', text: 'text-orange-700' },
    { bg: 'bg-teal-100', text: 'text-teal-700' },
    { bg: 'bg-pink-100', text: 'text-pink-700' },
    { bg: 'bg-lime-100', text: 'text-lime-700' },
  ];

  export async function renderCategorias() {
    const grid = document.getElementById('categoriasGrid');
    if (!grid) return;
    try {
      const response = await fetch(`${API_BASE_URL}/categorias/`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Error del servidor (${response.status})`);
      }
      const data = await response.json();
      const categorias = Array.isArray(data) ? data : (data.results || []);

      if (categorias.length === 0) {
        grid.innerHTML = '<p class="text-sm text-gray-400 col-span-full">No hay categorías creadas todavía.</p>';
        return;
      }

      grid.innerHTML = categorias.map((cat: any, i: number) => {
        const color = CATEGORIA_PALETA[i % CATEGORIA_PALETA.length];
        const icono = cat.icono || '🏷️';
        const count = cat.objetos_count ?? 0;
        return `
          <a href="/objetos?categoria_id=${encodeURIComponent(cat.id)}"
             class="block bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 hover:shadow-md transition-base hover:scale-[1.02] transition-transform cursor-pointer"
             aria-label="Ver objetos de la categoría ${cat.nombre}">
            <div class="w-10 h-10 ${color.bg} rounded-lg flex items-center justify-center mb-3">
              <span class="text-xl">${icono}</span>
            </div>
            <h3 class="font-semibold text-gray-900 text-sm line-clamp-2">${cat.nombre}</h3>
            <p class="text-xs ${color.text} font-medium mt-2">${count} objeto${count === 1 ? '' : 's'}</p>
          </a>
        `;
      }).join('');
    } catch (err) {
      console.error('Error al cargar categorías:', err);
      grid.innerHTML = '<p class="text-sm text-gray-400 col-span-full">Error al cargar categorías.</p>';
    }
  }

  // ===========================================================================
  // ANALÍTICAS NATIVAS (sin librerías externas)
  // Barras horizontales apiladas por usuario + torta SVG con <circle>
  // ===========================================================================

  // Mapa de colores OFICIAL de decisiones (clases Tailwind estrictas).
  const DECISION_SEGMENTS: { key: keyof DecisionPorUsuario; label: string; cssClass: string }[] = [
    { key: 'vender_publicado',    label: 'Vender · Publicado',    cssClass: 'bg-green-400' },
    { key: 'vender_no_publicado', label: 'Vender · No publicado', cssClass: 'bg-green-700' },
    { key: 'conservar',           label: 'Conservar',             cssClass: 'bg-blue-600' },
    { key: 'tirar',               label: 'Tirar',                 cssClass: 'bg-red-600' },
    { key: 'sin_decision',        label: 'Sin decisión',          cssClass: 'bg-orange-500' },
  ];

  const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] || ch);
  }

  function totalDecisiones(u: DecisionPorUsuario): number {
    return (u.vender_publicado || 0) + (u.vender_no_publicado || 0)
      + (u.conservar || 0) + (u.tirar || 0) + (u.sin_decision || 0);
  }

  // Barras horizontales apiladas: una fila por usuario (dueño original),
  // cada segmento = volumen de una decisión con su color oficial.
  export function renderBarrasApiladas(data: DecisionPorUsuario[]) {
    const container = document.getElementById('barrasApiladasContainer')!;
    if (!data || data.length === 0) {
      container.innerHTML = '<p class="text-sm text-gray-400">Sin objetos con dueño asignado aún.</p>';
      return;
    }

    const filas = [...data].sort((a, b) => totalDecisiones(b) - totalDecisiones(a));

    container.innerHTML = filas.map((usr) => {
      const total = totalDecisiones(usr);
      if (total <= 0) return '';
      const nombre = escapeHtml(usr.usuario_nombre || usr.usuario_id);
      const segmentos = DECISION_SEGMENTS.map((seg) => {
        const value = Number(usr[seg.key]) || 0;
        const pct = (value / total) * 100;
        return value > 0
          ? `<div class="${seg.cssClass}" style="width:${pct.toFixed(2)}%" title="${seg.label}: ${value}"></div>`
          : '';
      }).join('');

      return `
        <div>
          <div class="flex justify-between items-center mb-1 gap-2">
            <span class="text-sm font-medium text-gray-700 truncate">${nombre}</span>
            <span class="text-xs text-gray-400 shrink-0">${total} objeto${total === 1 ? '' : 's'}</span>
          </div>
          <div class="flex w-full h-4 rounded-full overflow-hidden bg-gray-100" role="img" aria-label="Decisiones de ${nombre}">
            ${segmentos}
          </div>
        </div>
      `;
    }).join('');
  }

  // Paleta hex fija para las 11 categorías oficiales del sistema (torta SVG).
  const CATEGORIA_HEX_COLORS: Record<string, string> = {
    'Muebles': '#3b82f6',
    'Arte': '#22c55e',
    'Coleccionables': '#f59e0b',
    'Antigüedades': '#a855f7',
    'Jardín': '#f43f5e',
    'Computación': '#06b6d4',
    'Electrónica': '#6366f1',
    'Cocina': '#f97316',
    'Hogar': '#14b8a6',
    'Herramientas': '#ec4899',
    'Materiales': '#84cc16',
  };
  const CATEGORIA_FALLBACK_COLORS = ['#94a3b8', '#64748b', '#475569'];

  function categoriaHex(nombre: string, index: number): string {
    return CATEGORIA_HEX_COLORS[nombre] || CATEGORIA_FALLBACK_COLORS[index % CATEGORIA_FALLBACK_COLORS.length];
  }

  // Torta (donut) 100% SVG nativa con <circle stroke-dasharray="..." />.
  // Cada segmento es un <circle> con un único dash de largo proporcional,
  // rotado a su ángulo de inicio (arranca a las 12 en punto).
  export function renderPieSVG(containerId: string, data: Record<string, number>) {
    const container = document.getElementById(containerId)!;
    const entries = Object.entries(data).filter(([, v]) => Number(v) > 0);
    const total = entries.reduce((acc, [, v]) => acc + Number(v), 0);
    if (total <= 0 || entries.length === 0) {
      container.innerHTML = '<p class="text-sm text-gray-400 text-center py-10">Sin datos para mostrar</p>';
      return;
    }

    const SIZE = 180;
    const CENTER = SIZE / 2;
    const RADIUS = 70;
    const STROKE_WIDTH = 28;
    const CIRCUNFERENCIA = 2 * Math.PI * RADIUS;

    let acumulado = 0;
    const segmentos = entries.map(([nombre, valor], i) => {
      const frac = Number(valor) / total;
      const largo = frac * CIRCUNFERENCIA;
      const rotacion = (acumulado / CIRCUNFERENCIA) * 360 - 90;
      const color = categoriaHex(nombre, i);
      acumulado += largo;
      const circle = `
        <circle
          cx="${CENTER}" cy="${CENTER}" r="${RADIUS}"
          fill="none"
          stroke="${color}"
          stroke-width="${STROKE_WIDTH}"
          stroke-dasharray="${largo.toFixed(3)} ${(CIRCUNFERENCIA - largo).toFixed(3)}"
          stroke-dashoffset="0"
          transform="rotate(${rotacion.toFixed(3)} ${CENTER} ${CENTER})"
        >
          <title>${escapeHtml(nombre)}: ${valor} objeto${Number(valor) === 1 ? '' : 's'}</title>
        </circle>
      `;
      return { nombre, valor, color, circle };
    });

    container.innerHTML = `
      <div class="flex flex-col items-center w-full">
        <div class="relative">
          <svg viewBox="0 0 ${SIZE} ${SIZE}" class="w-44 h-44" role="img" aria-label="Distribución de objetos por categoría">
            ${segmentos.map((s) => s.circle).join('')}
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span class="text-2xl font-bold text-gray-900 leading-none">${total}</span>
            <span class="text-[10px] uppercase tracking-wide text-gray-400 mt-1">objetos</span>
          </div>
        </div>
        <!-- Leyenda limpia con nombres e indicadores de color -->
        <div class="w-full mt-4 grid grid-cols-1 gap-x-4 gap-y-0.5">
          ${segmentos.map((s) => `
            <div class="flex items-center justify-between gap-2 py-0.5">
              <span class="inline-flex items-center gap-2 text-xs text-gray-600 min-w-0">
                <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background-color:${s.color}"></span>
                <span class="truncate">${escapeHtml(s.nombre)}</span>
              </span>
              <span class="text-xs font-medium text-gray-900 shrink-0">${s.valor} (${((Number(s.valor) / total) * 100).toFixed(1)}%)</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
