// =============================================================================
// LA TARJETA DEL LIENZO COMO ORIGEN DEL ARRASTRE (modelo híbrido unificado)
// -----------------------------------------------------------------------------
// Una CAJA / CONTENEDOR es, a la vez, un BULTO y un RECEPTOR:
//
//   · RECEPTOR  → `lib/dropTarjetasLienzo.ts` ya la conecta como Drop Target
//                 (soltar un objeto o una caja encima lo guarda adentro).
//   · BULTO     → este módulo la vuelve ARRASTRABLE con el MISMO contrato que
//                 los chips de la canasta (`application/x-estok-contenedor`),
//                 de modo que se puede soltar en:
//                   - otra tarjeta del lienzo (queda DENTRO de ese espacio),
//                   - la canasta «🧺 Elementos por ubicar / A reubicar / En
//                     tránsito» (PUT con parent y celda nulos → vuelve a la
//                     bandeja para reubicarla),
//                   - cualquier Drop Zone del visor (casillero F·C, cuerpo del
//                     mueble, grilla directa de objetos).
//
// La tarjeta NO se marca `draggable` completa a propósito: el motor elástico
// usa `pointerdown` + transform para la geometría libre y un `draggable` nativo
// en el contenedor secuestraría ese gesto. El arrastre ENTRE espacios viaja por
// un ASA explícita (⠿) inyectada en la esquina de la tarjeta.
//
// Módulo de DOM puro: no hace fetch ni duplica la persistencia. Los Drop Targets
// (dropTarjetasLienzo.ts / transitoInterno.ts / bandejaSinUbicar.ts) ya
// interpretan los MIME types que se publican acá.
// =============================================================================

// Contrato ÚNICO del payload de arrastre (id real + tipo_entidad explícito).
import { publicarArrastre, MIME_ORIGEN } from './arrastreEntidad';

/** Marca del asa inyectada (evita duplicarla en cada re-render). */
const ATRIBUTO_ASA = 'data-asa-arrastre';
/** Selector de las tarjetas navegables del motor elástico. */
const SELECTOR_TARJETA = '[data-inplace-card][data-id]';
/** Clase del asa (estilos en styles/planta-unica.css). */
const CLASE_ASA = 'pu-asa-arrastre';
/** Clase aplicada a la tarjeta mientras viaja el arrastre. */
const CLASE_ARRASTRANDO = 'pu-celda-arrastrando';

export interface OpcionesArrastreTarjetas {
  /** Contenedor del lienzo (scope del motor elástico). */
  scope: ParentNode;
  /** Recurso de las tarjetas: '/contenedores' habilita el arrastre. */
  recurso: string;
}

/** Asa ⠿ de arrastre DENTRO de una tarjeta (stopPropagation en cada gesto). */
function inyectarAsa(card: HTMLElement): void {
  const id = card.dataset.id ?? '';
  if (!id || card.querySelector(`[${ATRIBUTO_ASA}]`)) return;
  const nombre = card.dataset.inplaceNombre || 'este espacio';
  const asa = document.createElement('span');
  asa.className = CLASE_ASA;
  asa.setAttribute(ATRIBUTO_ASA, id);
  asa.setAttribute('draggable', 'true');
  asa.setAttribute('role', 'button');
  asa.setAttribute('aria-label', `Arrastrar «${nombre}» a otro espacio o a la bandeja`);
  asa.setAttribute('tabindex', '-1');
  asa.title = `Arrastrá «${nombre}» a otro espacio, a una caja o a «🧺 Elementos por ubicar / A reubicar / En tránsito»`;
  asa.textContent = '⠿';
  // El asa vive DENTRO de la tarjeta arrastrable: se frena el `pointerdown` del
  // motor elástico para que el gesto sea SIEMPRE el arrastre nativo.
  asa.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  asa.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  });
  asa.addEventListener('dragstart', (ev) => {
    const de = ev as DragEvent;
    const destino = card.dataset.id ?? '';
    if (!destino) {
      de.preventDefault();
      return;
    }
    // PAYLOAD EXPLÍCITO: id REAL de la tarjeta + `tipo_entidad` declarado por el
    // render (`data-inplace-entidad`: caja | espacio). Nunca el id del padre.
    const tipoEntidad = card.dataset.inplaceEntidad === 'caja' ? 'caja' : 'espacio';
    publicarArrastre(de, { id: destino, tipoEntidad });
    // Origen 'lienzo': la canasta NO confunde este gesto con uno propio y lo
    // interpreta como extracción (el bulto vuelve a «A reubicar»).
    de.dataTransfer?.setData(MIME_ORIGEN, 'lienzo');
    // La tarjeta vive dentro del lienzo (y puede estar anidada en otro bloque
    // arrastrable): se frena la propagación para que ningún ancestro sobreescriba
    // el identificador recién publicado.
    de.stopPropagation();
    card.classList.add(CLASE_ARRASTRANDO);
  });
  asa.addEventListener('dragend', () => card.classList.remove(CLASE_ARRASTRANDO));
  card.appendChild(asa);
}

/**
 * Conecta cada tarjeta del lienzo como ORIGEN del arrastre.
 *
 * Sólo se activa para recursos de tipo Contenedor: las Ubicaciones (habitaciones
 * y plantas) no son bultos movibles entre espacios y su arrastre sigue siendo
 * exclusivamente geométrico. Idempotente por render: el lienzo se repinta con
 * `innerHTML`, así que las asas viejas desaparecen con sus tarjetas.
 */
export function conectarArrastreTarjetasLienzo(opts: OpcionesArrastreTarjetas): void {
  if (!opts.recurso.includes('contenedores')) return;
  opts.scope.querySelectorAll<HTMLElement>(SELECTOR_TARJETA).forEach(inyectarAsa);
}
