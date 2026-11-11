// =============================================================================
// BLOQUE 3 DEL TABLERO DE DECISIONES · 💰 Con decisión de Vender
// -----------------------------------------------------------------------------
// Grillas «📢 Sin publicar» y «🔗 Ya publicados» de la SECCIÓN 1
// («✅ Decisiones tomadas (En proceso)» de /alertas-stock).
//
// Cada tarjeta ofrece:
//   · 📢 Armar formulario de Mercado Libre (objeto sin publicar),
//   · 🔗 Ver publicación + estado REAL de Mercado Libre (ya publicado),
//   · 📦 Despachar envío (sólo Administrador Físico),
//   · ✅ Marcar como Vendido (dueño): registra el ingreso financiero y archiva
//     el objeto (lib/decisionesCierre.ts).
//
// Vive aparte de lib/decisionesGrupos.ts (que orquesta el tablero) para
// mantener los módulos de UI por debajo del límite de modularidad del proyecto.
// El markup de la tarjeta NO se duplica: lo comparte desde lib/decisionesTarjeta.
// =============================================================================

import { refOpcional } from './dom';
import {
  botonPublicacionExternaHtml,
  escapar,
  estadoPublicacionInfo,
  tarjetaObjetoHtml,
} from './decisionesTarjeta';
import type { ObjetoDecision } from './decisionesTarjeta';
import { estaPublicado, ordenarGrupoDecisiones } from './decisionesOrden';
import { accionesCierreHtml } from './decisionesCierre';
import { puedeAdministrarFisico } from './descarteGracia';

/** Subconjunto del tablero de decisiones que alimenta este bloque. */
export interface GrupoVender {
  vender_sin_publicar?: ObjetoDecision[];
  vender_publicados?: ObjetoDecision[];
}

// -----------------------------------------------------------------------------
// BLOQUE 3 · Con decisión de Vender (sin publicar / ya publicados)
// -----------------------------------------------------------------------------

export function renderVender(panel: GrupoVender): void {
  // Orden del tablero: los casos que todavía admiten acción (publicar) arriba;
  // los ya despachados, al fondo. El bloque «Sin publicar» se lee antes que
  // «Ya publicados» por markup de la página.
  const sinPublicar = ordenarGrupoDecisiones(panel.vender_sin_publicar || [], 'vender');
  const publicados = ordenarGrupoDecisiones(panel.vender_publicados || [], 'vender');

  const gridSinPublicar = refOpcional('venderSinPublicarGrid');
  if (gridSinPublicar) gridSinPublicar.innerHTML = sinPublicar.map(cardVender).join('');
  const gridPublicados = refOpcional('venderPublicadosGrid');
  if (gridPublicados) gridPublicados.innerHTML = publicados.map(cardVender).join('');

  refOpcional('venderSinPublicarBloque')?.classList.toggle('hidden', sinPublicar.length === 0);
  refOpcional('venderPublicadosBloque')?.classList.toggle('hidden', publicados.length === 0);
}

function cardVender(obj: ObjetoDecision): string {
  // El estado REAL manda: una publicación pausada/finalizada en Mercado Libre
  // NO es «publicado» para el inventario (ver decisionesTarjeta).
  const publicado = estaPublicado(obj);
  return tarjetaObjetoHtml(obj, {
    pie: pieDespachoHtml(obj),
    // Cierre del ciclo: «✅ Marcar como Vendido» (registra el ingreso) debajo de
    // las acciones de publicación, para el propietario del objeto.
    acciones: (publicado ? accionesPublicadoHtml(obj) : accionesSinPublicarHtml(obj))
      + accionesCierreHtml(obj, 'vender'),
    atributos: 'data-grupo="vender"',
  });
}

/** Botón para armar el formulario de publicación (objeto decidido sin publicar). */
function accionesSinPublicarHtml(obj: ObjetoDecision): string {
  return `
    <div class="mt-auto flex flex-col gap-1.5">
      <span class="inline-flex items-center justify-center px-2 py-1 rounded-lg bg-green-100 text-green-800 text-xs font-bold">
        💰 Para vender · sin publicar
      </span>
      <button type="button" data-publicar="${escapar(obj.id)}"
        class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-base">
        📢 Armar formulario de Mercado Libre
      </button>
    </div>`;
}

/** Veredicto + link 🔗 de un objeto ya publicado (y despacho si corresponde). */
function accionesPublicadoHtml(obj: ObjetoDecision): string {
  // DESTINOS SEPARADOS: «Ver publicación» lleva EXCLUSIVAMENTE a la publicación
  // externa de Mercado Libre (pestaña nueva) y solo existe cuando el objeto
  // tiene una URL activa. La ficha interna se abre desde el cuerpo/título de la
  // tarjeta, no desde este botón (antes caía a `/objetos/<id>`).
  //
  // ESTADO REAL: si Mercado Libre la pausó, el veredicto deja de decir
  // «Publicado para vender» y se advierte cómo reactivarla.
  const info = estadoPublicacionInfo(obj);
  const veredicto = info.vendiendo
    ? `<span class="inline-flex items-center justify-center px-2 py-1 rounded-lg bg-green-100 text-green-800 text-xs font-bold">
        💰 Publicado para vender
      </span>`
    : `<span class="inline-flex items-center justify-center px-2 py-1 rounded-lg ${info.clases} text-xs font-bold">
        ⏸️ ${escapar(info.label)}
      </span>
      ${info.aviso ? `<p class="text-[11px] text-amber-700">${escapar(info.aviso)}</p>` : ''}`;
  return `
    <div class="mt-auto flex flex-col gap-1.5">
      ${veredicto}
      ${botonPublicacionExternaHtml(obj)}
      ${botonDespachoHtml(obj)}
    </div>`;
}

/**
 * Despacho del envío: solo visible para el Administrador Físico del Estok
 * (el backend responde 403 a cualquier otro usuario).
 */
function botonDespachoHtml(obj: ObjetoDecision): string {
  if (obj.despachado_en) {
    const por = obj.despachado_por_nombre ? ` por ${escapar(obj.despachado_por_nombre)}` : '';
    return `
      <span class="inline-flex items-center justify-center px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-semibold">
        📦 Envío despachado${por}
      </span>`;
  }
  if (!puedeAdministrarFisico()) return '';
  return `
    <button type="button" data-despachar-envio="${escapar(obj.id)}"
      class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white bg-slate-700 hover:bg-slate-800 rounded-lg shadow-sm transition-base">
      📦 Despachar envío (Admin. Físico)
    </button>`;
}

/** Chip de despacho en la tarjeta (pie) para los objetos vendidos. */
function pieDespachoHtml(obj: ObjetoDecision): string {
  if (!obj.despachado_en) return '';
  const por = obj.despachado_por_nombre ? ` · ${escapar(obj.despachado_por_nombre)}` : '';
  return `
    <div class="bg-slate-50 border border-slate-200 rounded-lg p-2 text-[11px] text-slate-600">
      📦 Despachado el ${new Date(obj.despachado_en).toLocaleDateString('es-AR')}${por}
    </div>`;
}
