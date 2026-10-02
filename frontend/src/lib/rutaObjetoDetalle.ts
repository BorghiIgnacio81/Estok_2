// =============================================================================
// RUTA DE UBICACIÓN DE UN OBJETO (sucesión de minimapas) - página de detalle
// -----------------------------------------------------------------------------
// REGLA UNIFICADA DE UBICACIÓN: siempre que se muestre la ubicación de un objeto
// (Ver Objeto, Editar Objeto, Mover o Mudanza) se renderiza una HILERA horizontal
// de minimapas analíticos asimétricos que desciende en orden:
//
//   [Planta] ➔ [Habitación] ➔ [Espacio/Mueble] ➔ [División/Caja]
//
// Cada mapa resalta en NARANJA (#f97316) el contenedor hijo respectivo. La
// geometría y el resalte NO se duplican: los aporta el motor único
// (lib/rutaCajaMinimapas.ts → nodoContenedor + renderMinimapasAnidados), el
// MISMO de Almacenamiento, Objetos, Decisión y Mudanza.
//
// Este módulo sólo orquesta la carga del contexto espacial del Estok activo y la
// inyección en el host de la página. Auth centralizada (getAuthHeaders dentro de
// rutaCajaMinimapas): acá NUNCA se definen headers propios.
// =============================================================================

import { cargarContextoRutaCaja, rutaMinimapasHtml } from './rutaCajaMinimapas';

/** Entidad mínima: ambiente y contenedor más profundo del objeto. */
export interface ObjetoUbicable {
  ubicacion?: string | null;
  contenedor?: string | null;
}

/**
 * Rellena el host `hostId` con la fila de minimapas de la ubicación del objeto y
 * muestra su bloque (`sectionId`). Devuelve true si hubo ruta real que mostrar.
 * Sin ubicación ni contenedor deja el bloque oculto (nunca un plano falso).
 */
export async function renderRutaUbicacionObjeto(
  hostId: string,
  sectionId: string | null,
  objeto: ObjetoUbicable,
): Promise<boolean> {
  const host = document.getElementById(hostId);
  const seccion = sectionId ? document.getElementById(sectionId) : null;
  if (!host) return false;
  host.innerHTML = '';
  seccion?.classList.add('hidden');

  const tieneUbicacion = Boolean(objeto.ubicacion || objeto.contenedor);
  if (!tieneUbicacion) return false;

  try {
    await cargarContextoRutaCaja();
  } catch {
    // Sin contexto espacial el bloque queda oculto: mejor sin mapa que con uno
    // inventado o descalzado.
    return false;
  }

  const html = rutaMinimapasHtml({
    ubicacion: objeto.ubicacion ?? null,
    parent_contenedor: objeto.contenedor ?? null,
  });
  if (!html) return false;
  host.innerHTML = html;
  seccion?.classList.remove('hidden');
  return true;
}
