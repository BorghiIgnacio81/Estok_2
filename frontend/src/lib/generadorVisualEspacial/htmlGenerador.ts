// =============================================================================
// GENERADOR VISUAL ESPACIAL · MARCADO DE LOS 3 PASOS (render puro)
// -----------------------------------------------------------------------------
// Funciones PURAS que devuelven el HTML de cada paso del modal. No tocan el DOM,
// no hacen fetch y no conservan estado: el componente
// components/GeneradorVisualEspacial.tsx les pasa la configuración actual.
// =============================================================================

import { escapeHtml } from '../escapeHtml';
import {
  camposDeNivel,
  miniaturaPresetSvg,
  type CampoConfiguracion,
  type ConfiguracionNivel,
  type ElementoEspacial,
  type NivelEspacial,
  type PresetEspacial,
} from './presetsEspaciales';

/** Opciones del selector rápido (los campos 0/1 se muestran como No / Sí). */
function opcionesDeCampo(campo: CampoConfiguracion, valor: number): string {
  if (campo.minimo === 0 && campo.maximo === 1) {
    return [0, 1]
      .map(
        (v) =>
          `<option value="${v}"${v === valor ? ' selected' : ''}>${v === 0 ? 'No' : 'Sí'}</option>`,
      )
      .join('');
  }
  let html = '';
  for (let v = campo.minimo; v <= campo.maximo; v++) {
    html += `<option value="${v}"${v === valor ? ' selected' : ''}>${v}</option>`;
  }
  return html;
}

/** Chips con el resumen de lo que el motor va a generar. */
export function htmlResumen(nivel: NivelEspacial, config: ConfiguracionNivel): string {
  const chips = camposDeNivel(nivel)
    .map((campo) => {
      const valor = config[campo.clave];
      const texto =
        campo.maximo === 1 && campo.minimo === 0 ? (valor > 0 ? 'Sí' : 'No') : String(valor);
      return `<span class="gve-chip">${campo.icono} ${escapeHtml(campo.etiqueta)}: <strong>${texto}</strong></span>`;
    })
    .join('');
  return `<p class="gve-resumen-titulo">Se generarán</p><div class="gve-chips">${chips}</div>`;
}

/** PASO 1 · Configuración de elementos con selectores rápidos. */
export function htmlPaso1(nivel: NivelEspacial, config: ConfiguracionNivel): string {
  const campos = camposDeNivel(nivel)
    .map(
      (campo) => `<label class="gve-campo">
        <span class="gve-campo-titulo">${campo.icono} ${escapeHtml(campo.etiqueta)}</span>
        <select class="gve-select" data-gve-campo="${campo.clave}" aria-label="${escapeHtml(campo.etiqueta)}">
          ${opcionesDeCampo(campo, config[campo.clave])}
        </select>
        <span class="gve-campo-ayuda">${escapeHtml(campo.ayuda)}</span>
      </label>`,
    )
    .join('');
  return `<section class="gve-seccion">
    <h3 class="gve-h3">1 · Configuración de elementos</h3>
    <p class="gve-ayuda">Elegí cantidades y tipos con los selectores rápidos. El motor arma 4 plantillas 2D adaptadas a este nivel.</p>
    <div class="gve-campos">${campos}</div>
    <div class="gve-resumen" data-gve-resumen>${htmlResumen(nivel, config)}</div>
    <p class="gve-nota">💡 ¿Preferís empezar de cero? Usá <strong>«Crear en blanco»</strong> y modelá las subdivisiones a mano.</p>
  </section>`;
}


/** PASO 2 · Galería de las 4 plantillas con miniaturas vectoriales 2D. */
export function htmlPaso2(presets: PresetEspacial[], seleccionado: string | null): string {
  const tarjetas = presets
    .map((preset) => {
      const activo = seleccionado === preset.id;
      const total = preset.elementos.length;
      return `<button type="button" class="gve-preset${activo ? ' gve-preset--activo' : ''}"
        data-gve-preset="${preset.id}" aria-pressed="${activo}">
        <span class="gve-preset-svg">${miniaturaPresetSvg(preset)}</span>
        <span class="gve-preset-titulo">${escapeHtml(preset.titulo)}</span>
        <span class="gve-preset-desc">${escapeHtml(preset.descripcion)}</span>
        <span class="gve-preset-meta">${total} espacio${total === 1 ? '' : 's'}</span>
      </button>`;
    })
    .join('');
  return `<section class="gve-seccion">
    <h3 class="gve-h3">2 · Galería de 4 plantillas 2D</h3>
    <p class="gve-ayuda">Miniaturas vectoriales con variantes arquitectónicas y estructurales para este nivel. Elegí una para ajustarla.</p>
    <div class="gve-presets">${tarjetas}</div>
  </section>`;
}

/** PASO 3 · Lienzo de inserción + ajuste fino de las subdivisiones. */
export function htmlPaso3(elementos: ElementoEspacial[]): string {
  const filas = elementos
    .map(
      (el, i) => `<li class="gve-fila">
        <span class="gve-fila-icono" aria-hidden="true">${escapeHtml(el.icono)}</span>
        <input class="gve-input" type="text" data-gve-nombre="${i}" value="${escapeHtml(el.nombre)}"
          aria-label="Nombre de la subdivisión ${i + 1}" />
        <button type="button" class="gve-mini" data-gve-dividir="${i}" title="Dividir esta subdivisión en dos">✂️</button>
        <button type="button" class="gve-mini gve-mini--peligro" data-gve-quitar="${i}" title="Quitar esta subdivisión">🗑️</button>
      </li>`,
    )
    .join('');
  const total = elementos.length;
  return `<section class="gve-seccion">
    <h3 class="gve-h3">3 · Inserción y ajuste fino en el lienzo</h3>
    <p class="gve-ayuda">Arrastrá cada bloque para moverlo y estirá desde la esquina inferior derecha. También podés renombrar, dividir o quitar subdivisiones.</p>
    <div class="gve-lienzo" data-gve-lienzo></div>
    <div class="gve-acciones">
      <button type="button" class="gve-btn gve-btn--secundario" data-gve-agregar>＋ Añadir subdivisión</button>
      <span class="gve-contador">${total} espacio${total === 1 ? '' : 's'}</span>
    </div>
    <ul class="gve-lista">${filas}</ul>
    <p class="gve-nota">Al insertar, el mapa 2D real conserva estas posiciones y te deja seguir arrastrando, estirando y fusionando.</p>
  </section>`;
}

/** Indicador de progreso (1 · Configuración → 2 · Plantillas → 3 · Ajuste). */
export function htmlPasos(paso: 1 | 2 | 3): string {
  const etiquetas = ['Configuración', 'Plantillas 2D', 'Ajuste fino'];
  const items = etiquetas
    .map((etiqueta, i) => {
      const n = (i + 1) as 1 | 2 | 3;
      const estado = n === paso ? 'gve-paso gve-paso--activo' : n < paso ? 'gve-paso gve-paso--hecho' : 'gve-paso';
      return `<li class="${estado}"><span class="gve-paso-num">${n < paso ? '✓' : n}</span>${etiqueta}</li>`;
    })
    .join('');
  return `<ol class="gve-pasos" aria-label="Pasos del generador visual">${items}</ol>`;
}
