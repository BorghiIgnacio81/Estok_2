// =============================================================================
// CONTRATO ÚNICO DEL ARRASTRE DE ENTIDADES (id real + tipo_entidad explícito)
// -----------------------------------------------------------------------------
// POR QUÉ EXISTE
//   El arrastre nativo de HTML5 permite que VARIOS handlers `dragstart` escuchen
//   el MISMO gesto: el evento burbujea desde el elemento tomado hasta cada
//   ancestro arrastrable. Si una Caja vive dentro de la tarjeta de un Estante y
//   ambos son `draggable="true"`, el handler del Estante se ejecuta DESPUÉS del
//   de la Caja y sobreescribe `dataTransfer` con SU id → al soltar, el backend
//   movía el ESTANTE en lugar de la Caja.
//
//   Este módulo centraliza el payload para que el dato viaje SIEMPRE explícito:
//     · `application/x-estok-entidad` → `<tipo_entidad>:<uuid>`
//       con tipo_entidad ∈ 'objeto' | 'caja' | 'espacio'.
//     · Se siguen publicando los MIME históricos
//       (`application/x-estok-objeto` / `application/x-estok-contenedor`) para
//       que los Drop Targets que aún no migraron sigan funcionando (0 regresiones).
//
//   `leerEntidadArrastrada()` es la ÚNICA lectura del payload: prioriza el dato
//   explícito y cae al MIME histórico cuando el arrastre viene de código viejo.
// =============================================================================

/** MIME del OBJETO fino arrastrado (legado + compatibilidad de Drop Targets). */
export const MIME_OBJETO = 'application/x-estok-objeto';
/** MIME del CONTENEDOR arrastrado (caja, estante, mueble). */
export const MIME_CONTENEDOR = 'application/x-estok-contenedor';
/**
 * MIME EXPLÍCITO del contrato nuevo: `<tipo_entidad>:<uuid>`.
 * Es la fuente de verdad del arrastre; los MIME de arriba quedan como espejo.
 */
export const MIME_ENTIDAD = 'application/x-estok-entidad';
/** Fallback de texto plano para destinos que sólo leen `text/plain`. */
export const MIME_TEXTO = 'text/plain';
/** Origen del gesto: la canasta ignora sus propios chips por este marcador. */
export const MIME_ORIGEN = 'application/x-estok-origen';

/**
 * Naturaleza de la entidad arrastrada:
 *   · `objeto`  → ítem fino de inventario.
 *   · `caja`    → contenedor MÓVIL (caja, mueble móvil declarado).
 *   · `espacio` → contenedor ARQUITECTÓNICO (estante, cajón, mueble fijo).
 */
export type TipoEntidadArrastrada = 'objeto' | 'caja' | 'espacio';

/** Punto de partida del gesto (la canasta se protege de sí misma). */
export type OrigenArrastre = 'bandeja' | 'lienzo' | 'panel' | 'visor';

/** Payload ya resuelto del arrastre. */
export interface EntidadArrastrada {
  /** UUID REAL del elemento tomado por el operador. */
  id: string;
  /** Naturaleza explícita del elemento arrastrado. */
  tipoEntidad: TipoEntidadArrastrada;
}

/** Opciones de publicación del arrastre. */
export interface OpcionesPublicarArrastre {
  /** UUID REAL del elemento arrastrado (nunca el del padre contenedor). */
  id: string;
  /** Naturaleza del elemento arrastrado. */
  tipoEntidad: TipoEntidadArrastrada;
  /** Punto de partida del gesto (opcional). */
  origen?: OrigenArrastre | null;
}

/** ¿El valor es un `tipo_entidad` válido del contrato? */
function esTipoEntidad(valor: string): valor is TipoEntidadArrastrada {
  return valor === 'objeto' || valor === 'caja' || valor === 'espacio';
}

/**
 * PUBLICA el arrastre con el payload EXPLÍCITO (id real + tipo_entidad) y su
 * espejo en los MIME históricos. Debe llamarse en el handler `dragstart` del
 * elemento tomado —y con `stopPropagation()` cuando exista un ancestro
 * arrastrable— para que ningún padre sobreescriba el identificador.
 */
export function publicarArrastre(
  de: DragEvent | null,
  opciones: OpcionesPublicarArrastre,
): void {
  const id = String(opciones.id ?? '').trim();
  if (!de?.dataTransfer || !id) return;
  const { tipoEntidad, origen = null } = opciones;
  de.dataTransfer.setData(MIME_ENTIDAD, `${tipoEntidad}:${id}`);
  de.dataTransfer.setData(tipoEntidad === 'objeto' ? MIME_OBJETO : MIME_CONTENEDOR, id);
  de.dataTransfer.setData(MIME_TEXTO, id);
  if (origen) de.dataTransfer.setData(MIME_ORIGEN, origen);
  de.dataTransfer.effectAllowed = 'move';
}

/**
 * LEE el payload del arrastre. Prioriza el contrato explícito
 * (`application/x-estok-entidad`) y cae a los MIME históricos para no romper
 * ningún origen de arrastre que todavía no haya migrado.
 */
export function leerEntidadArrastrada(de: DragEvent): EntidadArrastrada | null {
  const crudo = de.dataTransfer?.getData(MIME_ENTIDAD)?.trim() ?? '';
  if (crudo) {
    const separador = crudo.indexOf(':');
    const tipo = separador === -1 ? '' : crudo.slice(0, separador).trim();
    const id = separador === -1 ? '' : crudo.slice(separador + 1).trim();
    if (id && esTipoEntidad(tipo)) return { id, tipoEntidad: tipo };
  }
  const objetoId = de.dataTransfer?.getData(MIME_OBJETO)?.trim() ?? '';
  if (objetoId) return { id: objetoId, tipoEntidad: 'objeto' };
  const contenedorId = de.dataTransfer?.getData(MIME_CONTENEDOR)?.trim() ?? '';
  if (contenedorId) return { id: contenedorId, tipoEntidad: 'caja' };
  return null;
}
