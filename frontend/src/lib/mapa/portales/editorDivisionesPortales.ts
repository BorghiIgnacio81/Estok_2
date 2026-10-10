// =============================================================================
// EDITOR ELÁSTICO DE DIVISIONES DEL CUARTO (Panel Derecho, Ley 2 — Nivel N+1)
// -----------------------------------------------------------------------------
// Cuando el nodo activo es una HABITACIÓN viva, la derecha deja de ser un plano
// mudo: monta el MISMO editor elástico del asistente (renderLienzoElastico +
// conectarLienzoElastico) para modelar su interior con:
//   · «➕ Crear Espacio» → POST /api/contenedores/ (división estructural, sin
//     espejo de stock) → aparece al instante y se arrastra/estira/fusiona.
//   · El disyuntor canónico «Espacio Único» (lib/espacioUnico.ts) que declara al
//     cuarto como bloque monolítico y re-transiciona la cascada (Ley 4).
// Persistencia 100% delegada al adaptador de Contenedores (auth centralizada).
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../../../services/auth';
import { escapeHtml, toast } from '../../mapaJerarquico';
import { iconoDeEspacio } from '../../iconosFisicos';
import { adaptadorContenedores } from '../../lienzoElastico';
import type { ItemElastico } from '../../lienzoElastico';
import { renderLienzoElastico } from '../../mapaPlantaUnica';
import { conectarLienzoElastico } from '../../plantaUnicaInteractivo';
import { checkboxEspacioUnicoHtml, GUIA_ESPACIO_UNICO } from '../../espacioUnico';
import { reemplazarNodoActual } from './estadoPortales';
import type { NodoPortal } from './estadoPortales';
import { guardarEspacioUnico } from './datosNodosPortales';
import type { InteriorNodo } from './datosNodosPortales';

/** Ayuda contextual del editor del cuarto (micro-texto en español). */
const TIP_DIVISIONES =
  '🧱 <strong>Divisiones del cuarto</strong> · inyectá cada zona con «➕ Crear Espacio», arrastrala para acomodarla, estirá de su esquina y seleccioná 2+ para fusionarlas. Tocá una silueta para bajar a su interior jerárquico.';

/** Traduce la geometría real de los hijos a los rectángulos elásticos del editor. */
function itemsEditor(interior: InteriorNodo): ItemElastico[] {
  return interior.geometriaHijos.map((g) => ({
    id: String(g.id),
    nombre: String(g.nombre ?? 'Espacio'),
    icono: iconoDeEspacio(g.nombre),
    ui_left: g.ui_left ?? null,
    ui_top: g.ui_top ?? null,
    ui_width: g.ui_width ?? null,
    ui_height: g.ui_height ?? null,
    fusion_grupo: g.fusion_grupo ?? null,
  }));
}

/** Cabecera del nivel con el disyuntor canónico «Espacio Único». */
function cabeceraHtml(nodo: NodoPortal): string {
  return `<div class="portal-grilla-cab">
    <span class="portal-grilla-titulo">🧱 Divisiones de «${escapeHtml(nodo.nombre)}»</span>
    ${checkboxEspacioUnicoHtml({ id: 'portalEspacioUnicoEditor', marcado: nodo.espacioUnico, valor: nodo.id })}
  </div>
  <p class="portal-monolitico-guia">${GUIA_ESPACIO_UNICO}</p>`;
}

/** POST de una división interna del cuarto (estructural: crear_espejo=false). */
async function crearEspacioEnHabitacion(roomId: string, n: number): Promise<boolean> {
  if (!roomId) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: `Espacio ${n + 1}`,
        descripcion: '',
        ubicacion: roomId,
        ui_left: `${6 + (n % 5) * 12}%`,
        ui_top: `${8 + (n % 4) * 16}%`,
        ui_width: '28%',
        ui_height: '24%',
        es_inmueble: false,
        crear_espejo: false,
        espacio_unico: false,
      }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast('❌ ' + (err?.detail || err?.error || 'No se pudo crear el espacio.'));
      return false;
    }
    toast('✅ Espacio interno creado. Arrastralo para acomodarlo.');
    return true;
  } catch {
    toast('❌ Error de conexión al crear el espacio.');
    return false;
  }
}

/**
 * Persiste el disyuntor «Espacio Único» del nodo activo (Ubicación o Contenedor)
 * y re-transiciona la cascada en caliente (Ley 4). Autoridad ÚNICA del flag: la
 * usan tanto el editor elástico del cuarto como la grilla directa de objetos.
 */
export async function alternarEspacioUnico(nodo: NodoPortal, valor: boolean): Promise<void> {
  const recurso = nodo.tipo === 'habitacion' ? 'ubicaciones' : 'contenedores';
  const ok = await guardarEspacioUnico(nodo.id, valor, recurso);
  if (!ok) return;
  reemplazarNodoActual({ espacioUnico: valor });
  window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
}

/**
 * LEY 2 · Despliega el EDITOR ELÁSTICO de divisiones en el Panel Derecho para una
 * habitación viva: cabecera con «Espacio Único» + lienzo elástico naranja
 * («➕ Crear Espacio», arrastre, resizing y fusión). Idempotente por render.
 */
export function pintarEditorDivisiones(
  host: HTMLElement,
  nodo: NodoPortal,
  interior: InteriorNodo,
): void {
  const items = itemsEditor(interior);
  host.innerHTML =
    cabeceraHtml(nodo) +
    renderLienzoElastico({
      items,
      etiquetaCrear: 'Crear Espacio',
      textoVacio:
        'Esta habitación todavía no tiene divisiones internas. Usá «➕ Crear Espacio» para subdividirla en zonas físicas.',
      tip: TIP_DIVISIONES,
    });
  host.querySelector<HTMLInputElement>('[data-espacio-unico]')?.addEventListener('change', (ev) => {
    void alternarEspacioUnico(nodo, (ev.currentTarget as HTMLInputElement).checked);
  });
  conectarLienzoElastico({
    scope: host,
    rooms: () => items,
    adaptador: adaptadorContenedores(),
    crearItem: () => crearEspacioEnHabitacion(nodo.id, items.length),
    notificarCambios: () => window.dispatchEvent(new CustomEvent('estok:espacios-cambiados')),
  });
}
