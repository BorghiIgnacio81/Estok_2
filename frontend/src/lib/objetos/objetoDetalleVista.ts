// =============================================================================
// VISTA DE DETALLE DEL OBJETO — ficha técnica destacada + limpieza de campos base
// -----------------------------------------------------------------------------
// Orquesta la presentación del detalle (/objetos/<id>):
//
//   1. FICHA TÉCNICA PRIORITARIA: si el objeto pertenece a un subtipo
//      (libro/revista, tecnología, mueble/arte, ropa) o tiene datos técnicos,
//      la tarjeta se muestra arriba. Las filas y su formato los resuelve
//      lib/objetos/objetoFichaTecnica.ts (único formateador).
//      Si la categoría es de subtipo pero todavía no hay datos cargados, la
//      tarjeta se mantiene con un aviso accionable (nunca con filas vacías).
//
//   2. LIMPIEZA DE CAMPOS BASE SECUNDARIOS: los campos marcados con
//      `[data-campo-base]` se ocultan cuando están vacíos (no se muestra «—»)
//      o cuando son poco relevantes para la familia del objeto.
//      Es una regla SÓLO de presentación: no toca ni borra datos del objeto.
// =============================================================================

import {
  FAMILIAS_OBJETO,
  familiaDeCategoria,
  type FamiliaObjeto,
} from './objetoCamposEspecificos';
import { renderFichaTecnica } from './objetoFichaTecnica';

/** Campos base que NO se muestran para ciertas familias (dato poco relevante). */
const CAMPOS_BASE_IRRELEVANTES: Record<FamiliaObjeto, readonly string[]> = {
  // El color no describe a un libro/revista: el dato relevante es el ejemplar.
  libro: ['color'],
  tecnologia: [],
  mueble_arte: [],
  ropa: [],
};

/** True si el valor no aporta información (null, undefined o texto vacío). */
function vacio(valor: unknown): boolean {
  return valor === null || valor === undefined || String(valor).trim() === '';
}

/** Nombre de la categoría del objeto (texto plano, puede ser ''). */
function nombreCategoria(objeto: Record<string, any> | null | undefined): string {
  const categoria = objeto?.categoria_nombre
    ?? (typeof objeto?.categoria === 'string' ? objeto.categoria : objeto?.categoria?.nombre)
    ?? '';
  return String(categoria).trim();
}

/** Valor del objeto asociado a una clave base (`descripcion`, `color`, …). */
function valorBase(objeto: Record<string, any> | null | undefined, clave: string): unknown {
  if (!objeto || !clave) return undefined;
  return objeto[clave];
}

/**
 * Oculta los campos base secundarios vacíos o irrelevantes para la familia.
 *
 * Los elementos se declaran en el marcado con `data-campo-base="<clave>"`.
 * @returns claves que quedaron ocultas (útil para depurar).
 */
export function depurarCamposBase(
  objeto: Record<string, any> | null | undefined,
): string[] {
  const familia = familiaDeCategoria(nombreCategoria(objeto));
  const irrelevantes = familia ? CAMPOS_BASE_IRRELEVANTES[familia] ?? [] : [];
  const ocultos: string[] = [];

  document.querySelectorAll<HTMLElement>('[data-campo-base]').forEach((elemento) => {
    const clave = elemento.dataset.campoBase ?? '';
    const ocultar = irrelevantes.includes(clave) || vacio(valorBase(objeto, clave));
    elemento.classList.toggle('hidden', ocultar);
    if (ocultar && clave) ocultos.push(clave);
  });

  return ocultos;
}

/**
 * Renderiza la vista patrimonial del detalle: ficha técnica + limpieza de campos.
 *
 * @returns familia detectada, cantidad de filas técnicas y campos ocultos.
 */
export function renderVistaDetalle(
  objeto: Record<string, any> | null | undefined,
): { familia: FamiliaObjeto | null; filas: number; camposOcultos: string[] } {
  const familia = familiaDeCategoria(nombreCategoria(objeto));
  const filas = renderFichaTecnica(objeto);

  const seccion = document.getElementById('fichaTecnicaSection');
  const aviso = document.getElementById('fichaTecnicaVacia');
  const enlace = document.getElementById('fichaTecnicaEditar') as HTMLAnchorElement | null;
  const resumen = document.getElementById('fichaTecnicaResumen');

  if (filas === 0 && familia && seccion) {
    // Subtipo sin datos técnicos: tarjeta con guía accionable, sin filas vacías.
    const { titulo, icono } = FAMILIAS_OBJETO[familia];
    if (resumen) resumen.textContent = `${icono} ${titulo}`;
    if (enlace && objeto?.id) enlace.href = `/objetos/${objeto.id}/editar`;
    aviso?.classList.remove('hidden');
    seccion.classList.remove('hidden');
  } else {
    aviso?.classList.add('hidden');
  }

  const camposOcultos = depurarCamposBase(objeto);
  return { familia, filas, camposOcultos };
}
