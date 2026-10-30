// =============================================================================
// ACCIONES DE LA CAJA / CONTENEDOR ACTIVO (Panel Derecho de Almacenamiento)
// -----------------------------------------------------------------------------
// Cuando el operador inspecciona una caja («Caja 01») el Panel Derecho muestra su
// interior (ficha + objetos guardados) y, debajo, la canasta de objetos
// disponibles. Este módulo aporta la barra de acciones DESTACADA de ese nivel:
//
//   · 🚚 «Poner Caja En Tránsito» → saca la pieza de su espacio actual y la deja
//     como raíz suelta en la habitación limbo «En Tránsito» del Estok activo
//     (POST /api/contenedores/{id}/en_transito/). Desde ahí se reubica
//     arrastrándola desde «🧺 Elementos por ubicar» al plano nuevo.
//   · 🔎 «Abrir ficha completa» → /contenedores/{id} con TODO el inventario.
//
// Módulo de DOM puro: no dibuja planos ni duplica la cascada. La persistencia
// usa la auth centralizada (getAuthHeaders / API_BASE_URL) y el latido global
// `estok:espacios-cambiados` refresca los dos paneles y la canasta.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../../../services/auth';
import { escapeHtml, toast } from '../../mapaJerarquico';
import type { NodoPortal } from './estadoPortales';
// Recepción del Drag & Drop de la canasta: la persistencia (PUT con la relación
// jerárquica y casillero fino nulo) es EXACTAMENTE la del motor de portales —
// acá no se reimplementa ninguna regla, sólo se declara la zona de suelta.
import { guardarEnContenedor, leerCargaArrastrada } from './transitoInterno';

/**
 * ¿La pieza activa admite «Poner Caja En Tránsito»?
 * Sólo contenedores MÓVILES: un mueble inmueble (es_inmueble) es arquitectura
 * clavada al cuarto y el backend lo rechaza con 400.
 */
export function admitePonerEnTransito(nodo: NodoPortal | null): boolean {
  if (!nodo || nodo.tipo !== 'contenedor') return false;
  return !nodo.esInmueble;
}

/**
 * Barra de acciones del contenedor activo (vacía para habitaciones o para
 * muebles inmuebles, que no pueden viajar al limbo).
 */
export function barraAccionesCajaHtml(nodo: NodoPortal): string {
  if (nodo.tipo !== 'contenedor') return '';
  const transito = admitePonerEnTransito(nodo)
    ? `<button type="button"
        data-caja-en-transito="${escapeHtml(nodo.id)}"
        class="portal-caja-btn portal-caja-btn-transito"
        title="Sacá «${escapeHtml(nodo.nombre)}» de su espacio actual y dejala en «En Tránsito» para reubicarla arrastrándola desde «Elementos por ubicar»">
        🚚 Poner Caja En Tránsito
      </button>`
    : '';
  return `<div class="portal-caja-acciones">
    ${transito}
    <a href="/contenedores/${escapeHtml(nodo.id)}"
      class="portal-caja-btn portal-caja-btn-ficha"
      title="Abrir la ficha completa de «${escapeHtml(nodo.nombre)}» con todo su inventario interno">
      🔎 Abrir ficha completa
    </a>
  </div>`;
}

/** POST del limbo de mudanza + refresco en caliente de paneles y canasta. */
async function ponerEnTransito(nodo: NodoPortal, boton: HTMLButtonElement): Promise<void> {
  if (boton.disabled) return;
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = '⏳ Poniendo en tránsito…';
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/${nodo.id}/en_transito/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast('❌ ' + (datos?.detail || datos?.error || 'No se pudo poner la caja en tránsito.'));
      boton.disabled = false;
      boton.textContent = textoOriginal;
      return;
    }
    toast(datos?.mensaje || '🚚 La caja quedó en «En Tránsito».');
    // Latido global: re-resuelve el árbol, repinta ambos paneles y recarga la
    // canasta inferior, donde la caja ya aparece como bulto suelto a reubicar.
    window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
    window.dispatchEvent(new CustomEvent('estok:objetos-cambiados', { detail: { id: nodo.id } }));
  } catch {
    toast('❌ Error de conexión al poner la caja en tránsito.');
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

/**
 * ZONA DE SUELTA de la caja abierta: el operador arrastra un objeto o una caja
 * desde la bandeja (Panel Derecho) y la suelta para guardarla DENTRO del nodo
 * activo. Sin celda fina: el backend decide «directo» o «En Tránsito Interno».
 */
export function zonaDropCajaHtml(nodo: NodoPortal): string {
  if (nodo.tipo !== 'contenedor') return '';
  return `<div class="portal-caja-drop"
    data-caja-drop="${escapeHtml(nodo.id)}"
    data-caja-drop-nombre="${escapeHtml(nodo.nombre)}"
    data-caja-drop-divisiones="${nodo.conDivisiones ? '1' : '0'}"
    title="Soltá acá un objeto o una caja de la bandeja para guardarlo dentro de «${escapeHtml(nodo.nombre)}»">
    ⬇ Soltá acá los objetos de la bandeja para guardarlos dentro de «${escapeHtml(nodo.nombre)}»
  </div>`;
}

/** Conecta la zona de suelta del contenedor activo con el motor de portales. */
export function conectarDropCaja(host: HTMLElement, nodo: NodoPortal): void {
  const zona = host.querySelector<HTMLElement>('[data-caja-drop]');
  if (!zona) return;
  const limpiar = (): void => zona.classList.remove('portal-caja-drop-activo');
  zona.addEventListener('dragover', (ev) => {
    const de = ev as DragEvent;
    de.preventDefault();
    if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
    zona.classList.add('portal-caja-drop-activo');
  });
  zona.addEventListener('dragleave', limpiar);
  zona.addEventListener('drop', (ev) => {
    const de = ev as DragEvent;
    limpiar();
    if (de.defaultPrevented) return;
    const carga = leerCargaArrastrada(de);
    if (!carga) return;
    // Se aísla el evento: ningún otro handler del panel debe guardar dos veces.
    de.preventDefault();
    de.stopPropagation();
    void guardarEnContenedor(carga, {
      contenedorId: nodo.id,
      nombre: nodo.nombre,
      tieneDivisiones: nodo.conDivisiones,
      fila: null,
      col: null,
    });
  });
}

/**
 * Conecta la barra de acciones del contenedor activo. Idempotente por render:
 * el host se reescribe por innerHTML en cada nivel, así que los listeners viejos
 * desaparecen con sus nodos.
 */
export function conectarAccionesCaja(host: HTMLElement, nodo: NodoPortal): void {
  host.querySelectorAll<HTMLButtonElement>('[data-caja-en-transito]').forEach((boton) => {
    boton.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void ponerEnTransito(nodo, boton);
    });
  });
  conectarDropCaja(host, nodo);
}
