// =============================================================================
// ESPACIOS VISIBLES DE UNA HABITACIÓN (CONTADORES DEL MAPA) · PURO
// -----------------------------------------------------------------------------
// FUENTE ÚNICA de los contadores de espacios que muestran los rótulos del
// panel izquierdo y los resúmenes. La regla es la MISMA que dibuja el lienzo
// derecho, para que el número NUNCA discrepe de la cantidad de bloques:
//
//   · sólo cuentan los contenedores RAÍZ: las sub-divisiones internas de un
//     mueble (estanterías, cajoneras) quedan SUBSUMIDAS dentro de su padre y
//     no son bloques del cuarto;
//   · las CAJAS NO cuentan: son CONTENIDO del inventario (se muestran como
//     tarjetas del panel derecho), nunca bloques/divisiones del suelo. Sin esta
//     regla el rótulo prometía 5 espacios donde el mapa dibujaba 4 (bug real:
//     «Caja 06» contada como espacio de la habitación);
//   · los miembros de un mismo `fusion_grupo` (espacio fusionado en «L») se
//     colapsan en UN único bloque representativo.
//
// Contar el padrón en crudo devolvía 5 donde el mapa muestra 3. El lienzo NO
// usa este índice para dibujar: necesita TODOS los tiles para reconstruir la
// silueta irregular (ver `contenedoresRaizDeUbicacion` en datosNodosPortales).
//
// Módulo PURO: no toca el DOM ni hace fetch.
// =============================================================================

import type { ContenedorDto } from './portales/datosNodosPortales';
// ÚNICA fuente de la separación plano ⇄ cajas (taxonomía + rótulo canónico),
// con la excepción geométrica de los «espacios» guardados como CAJA modelada.
import { esCajaDeContenidoEnPlano } from '../taxonomiaContenedor';

/**
 * Indexa los ESPACIOS VISIBLES de cada habitación por el id de su Ubicación.
 */
export function indexarEspaciosVisiblesPorUbicacion(
  contenedores: ContenedorDto[],
): Map<string, ContenedorDto[]> {
  const porUbicacion = new Map<string, ContenedorDto[]>();
  const gruposVistos = new Set<string>();
  for (const c of contenedores) {
    if (c.parent_contenedor || !c.ubicacion) continue;
    // CAJAS: contenido del inventario, nunca un bloque/división del cuarto.
    // Excepción: una CAJA MODELADA con geometría propia en el cuarto es un
    // ESPACIO arquitectónico y cuenta igual que el lienzo la dibuja.
    if (esCajaDeContenidoEnPlano(c)) continue;
    if (c.fusion_grupo) {
      const claveGrupo = `${c.ubicacion}::${c.fusion_grupo}`;
      if (gruposVistos.has(claveGrupo)) continue;
      gruposVistos.add(claveGrupo);
    }
    const lista = porUbicacion.get(c.ubicacion) ?? [];
    lista.push(c);
    porUbicacion.set(c.ubicacion, lista);
  }
  return porUbicacion;
}
