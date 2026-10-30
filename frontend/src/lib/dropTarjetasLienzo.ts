// =============================================================================
// LA TARJETA DEL LIENZO COMO DESTINO DEL ARRASTRE (guardar DENTRO de la caja)
// -----------------------------------------------------------------------------
// Requisito de las pruebas: arrastrar un objeto desde la bandeja inferior/lateral
// y soltarlo DIRECTAMENTE sobre una caja del lienzo debe guardarlo dentro (asignar
// `contenedor_id`) e incrementar su contador en el acto.
//
// Este módulo conecta TODAS las tarjetas del motor elástico
// (`[data-inplace-card][data-id]`: espacios sueltos y bloques fusionados) como
// zonas de soltado válidas, sin duplicar la física ni la persistencia:
//   · objeto/caja soltado sobre un CONTENEDOR → `guardarEnContenedor`
//     (PUT con `contenedor`/`parent_contenedor` y casillero nulo: el backend
//      decide «guardado directo» o «En Tránsito Interno»).
//   · objeto/caja soltado sobre una HABITACIÓN (Planta Única / planta) →
//     `guardarEnUbicacion` (PUT con `ubicacion` y sin contenedor).
// En ambos casos se emite el latido global (`estok:espacios-cambiados`), que
// re-resuelve el nivel activo, la ficha de la caja y la canasta; y además se
// incrementa el badge `[data-conteo-item]` de la tarjeta al instante para que el
// contador no espere la respuesta.
//
// El drop se aísla con `stopPropagation`: el lienzo tiene su propio handler
// (asignar a la celda F1·C1) y el Panel Izquierdo el «drop a ciegas»; sin esta
// guarda, soltar sobre una caja guardaría el elemento DOS veces.
// =============================================================================

import { toast } from './mapaJerarquico';
import { guardarEnContenedor, guardarEnUbicacion, leerCargaArrastrada } from './mapa/portales/transitoInterno';

/** Selector de las tarjetas navegables del motor elástico (sueltas y fusionadas). */
const SELECTOR_TARJETA = '[data-inplace-card][data-id]';
/** Clase de realce mientras el bulto está sobre la tarjeta. */
const CLASE_DROP_ACTIVA = 'pu-celda-drop-activa';
/** MIME types que publican la canasta y el visor al arrastrar un bulto. */
const MIMES_CARGA = ['application/x-estok-objeto', 'application/x-estok-contenedor'];

export interface OpcionesDropTarjetas {
  /** Contenedor del lienzo (scope del motor elástico). */
  scope: ParentNode;
  /** Recurso de las tarjetas: define si el destino es un contenedor o un cuarto. */
  recurso: string;
}

/** ¿El arrastre trae un bulto de la canasta/visor? (lee `dataTransfer.types`). */
function traeCarga(de: DragEvent): boolean {
  const tipos = Array.from(de.dataTransfer?.types ?? []);
  return MIMES_CARGA.some((mime) => tipos.includes(mime));
}

/** Incremento optimista del contador de ítems de la tarjeta destino. */
function subirConteo(card: HTMLElement): void {
  const badge = card.querySelector<HTMLElement>('[data-conteo-item]');
  if (!badge) return;
  const actual = Number(badge.dataset.conteoItem ?? '0');
  const nuevo = (Number.isFinite(actual) ? actual : 0) + 1;
  badge.dataset.conteoItem = String(nuevo);
  badge.textContent = `📦 ${nuevo}`;
  badge.classList.add('pu-conteo-sube');
  window.setTimeout(() => badge.classList.remove('pu-conteo-sube'), 900);
}

/**
 * Conecta cada tarjeta del lienzo como Drop Target del catálogo.
 *
 * Idempotente por render: el lienzo se repinta con `innerHTML` en cada nivel, así
 * que los listeners viejos desaparecen junto con sus tarjetas.
 */
export function conectarDropTarjetasLienzo(opts: OpcionesDropTarjetas): void {
  const esContenedor = opts.recurso.includes('contenedores');
  opts.scope.querySelectorAll<HTMLElement>(SELECTOR_TARJETA).forEach((card) => {
    const id = card.dataset.id ?? '';
    if (!id) return;

    card.addEventListener('dragover', (ev) => {
      const de = ev as DragEvent;
      if (!traeCarga(de)) return;
      de.preventDefault();
      de.stopPropagation();
      if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
      card.classList.add(CLASE_DROP_ACTIVA);
    });

    card.addEventListener('dragleave', (ev) => {
      const de = ev as DragEvent;
      // Ignora el cambio entre hijos de la MISMA tarjeta.
      if (de.relatedTarget && card.contains(de.relatedTarget as Node)) return;
      card.classList.remove(CLASE_DROP_ACTIVA);
    });

    card.addEventListener('drop', (ev) => {
      const de = ev as DragEvent;
      card.classList.remove(CLASE_DROP_ACTIVA);
      const carga = leerCargaArrastrada(de);
      if (!carga) return;
      // Se aísla el evento ANTES de cualquier await: ni el lienzo (celda F1·C1)
      // ni el drop a ciegas del Panel Izquierdo deben procesar la misma suelta.
      de.preventDefault();
      de.stopPropagation();
      // UN ESPACIO NUNCA SE CONTIENE A SÍ MISMO: el asa de arrastre de la propia
      // tarjeta no puede soltarse encima (el backend lo rechazaría con 400).
      if (carga.id === id) return;
      const nombre = card.dataset.inplaceNombre || 'la caja';
      const conDivisiones = card.dataset.inplaceDivisiones === '1';
      const guardado = esContenedor
        ? guardarEnContenedor(carga, {
            contenedorId: id,
            nombre,
            tieneDivisiones: conDivisiones,
            fila: null,
            col: null,
          })
        : guardarEnUbicacion(carga, id, nombre);
      void guardado
        .then((ok) => {
          if (!ok) return;
          if (carga.tipo === 'objeto') subirConteo(card);
          else toast('✅ Contenedor guardado dentro. Se actualizó su inventario.');
        })
        .catch(() => toast('❌ No se pudo guardar el elemento sobre la tarjeta.'));
    });
  });
}
