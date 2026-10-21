// =============================================================================
// EDITOR ELÁSTICO DE DIVISIONES INTERNAS (Panel Derecho, Ley 2 — Nivel N+1…∞)
// -----------------------------------------------------------------------------
// Cuando el nodo activo es una HABITACIÓN viva —o CUALQUIER CONTENEDOR con
// sub-divisiones propias (regla recursiva infinita)— la derecha deja de ser un
// plano mudo: monta el MISMO editor elástico del asistente (renderLienzoElastico
// + conectarLienzoElastico) para modelar su interior con:
//   · «➕ Crear Espacio» → POST /api/contenedores/ (división estructural, sin
//     espejo de stock) → aparece al instante y se arrastra/estira/fusiona.
//   · El disyuntor canónico «Espacio Único» (lib/espacioUnico.ts) que declara al
//     nivel como bloque monolítico y re-transiciona la cascada (Ley 4).
//   · El PERÍMETRO ÁMBAR redimensionable (lib/perimetroElastico.ts) inyectado con
//     `inyectarPerimetroElastico(..., nodo)` y conectado con
//     `conectarPerimetroElastico(...)`: estirar el marco ensancha los límites
//     físicos de las sub-divisiones en CUALQUIER nivel de la cascada.
// Persistencia 100% delegada a los adaptadores (auth centralizada).
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../../../services/auth';
import { escapeHtml, toast } from '../../mapaJerarquico';
import { iconoDeEspacio } from '../../iconosFisicos';
import { adaptadorContenedores, adaptadorUbicaciones } from '../../lienzoElastico';
import type { AdaptadorEspacios, ItemElastico } from '../../lienzoElastico';
import { renderLienzoElastico } from '../../mapaPlantaUnica';
import { conectarLienzoElastico } from '../../plantaUnicaInteractivo';
import { checkboxEspacioUnicoHtml, GUIA_ESPACIO_UNICO } from '../../espacioUnico';
// 🎒 Disyuntor de movilidad (Lote 26): SIEMPRE debajo del control «Espacio Único».
import { lineaMuebleMovilHtml } from '../../muebleMovil';
// Propiedades del Objeto declarado (Dueño/Categoría/Estado/Valor estimado).
import { conectarPropiedadesObjetoEspacio } from '../../objetoEspacio';
import {
  conectarPerimetroElastico,
  guardarMedidaCon,
  inyectarPerimetroElastico,
} from '../../perimetroElastico';
import { reemplazarNodoActual } from './estadoPortales';
import type { NodoPortal } from './estadoPortales';
import { reaccionarEspacioUnico } from './barraComandosPortales';
import { cargarContenedores } from './datosNodosPortales';
// Disyuntores del espacio: persistencia compartida (PUT parcial multi-tenant).
import { guardarDeclaradoMovible, guardarEspacioUnico } from './disyuntoresPersistencia';
import type { InteriorNodo } from './datosNodosPortales';
// «Duplicar» (⧉) del espacio/sub-división: copia exacta contigua en el backend.
import { duplicarDivisionEnNodo } from './duplicarDivisionPortales';

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

/**
 * Cabecera del nivel con los DOS disyuntores del espacio activo, apilados en
 * este orden EXACTO (Lote 26): «Espacio Único» arriba y «🎒 Declarar como Mueble
 * Móvil / Objeto» justo debajo, para que el operador configure la pieza en
 * caliente MIENTRAS modela los ambientes de la habitación.
 */
function cabeceraHtml(nodo: NodoPortal): string {
  return `<div class="portal-grilla-cab">
    <span class="portal-grilla-titulo">🧱 Divisiones de «${escapeHtml(nodo.nombre)}»</span>
    ${checkboxEspacioUnicoHtml({ id: 'portalEspacioUnicoEditor', marcado: nodo.espacioUnico, valor: nodo.id })}
  </div>
  ${lineaMuebleMovilHtml(nodo, 'portalMuebleMovilEditor')}
  <p class="portal-monolitico-guia">${GUIA_ESPACIO_UNICO}</p>`;
}

/**
 * Adaptador REAL del recurso que oficia de DUEÑO del marco ámbar del nodo: una
 * HABITACIÓN persiste su medida en la Ubicación; un CONTENEDOR en sí mismo. Con
 * esto el perímetro es reutilizable de forma idéntica en TODOS los niveles.
 */
function adaptadorDelNodo(nodo: NodoPortal): AdaptadorEspacios {
  return nodo.tipo === 'habitacion' ? adaptadorUbicaciones() : adaptadorContenedores();
}

/**
 * Ubicación FÍSICA (habitación) que EXIGE el serializer de Django: `ubicacion` es
 * un campo OBLIGATORIO del `ContenedorSerializer` (`required=True`,
 * `allow_null=False`). Una HABITACIÓN la aporta por identidad; un CONTENEDOR la
 * hereda del registro real de su padre en el padrón. Sin este campo el POST
 * responde 400 «This field is required» ANTES de que `perform_create` pueda
 * resolverla desde el padre.
 */
async function ubicacionDeNodo(nodo: NodoPortal): Promise<string | null> {
  if (nodo.tipo === 'habitacion') return nodo.id;
  const conts = await cargarContenedores();
  return conts.find((c) => c.id === nodo.id)?.ubicacion ?? null;
}

/**
 * POST de una división interna (estructural: crear_espejo=false). RECURSIVO: la
 * habitación cuelga de su Ubicación (`ubicacion`); un contenedor con sub-divisiones
 * cuelga de su PADRE (`parent_contenedor`) y el backend reafirma la ubicación del
 * padre (ContenedorViewSet.perform_create). El payload viaja SIEMPRE con
 * `ubicacion` (campo obligatorio del serializer) para no romper la validación con
 * un 400. Así el descenso interno es idéntico en CUALQUIER nivel (N+1, N+2, …).
 */
async function crearEspacioEnNodo(nodo: NodoPortal, n: number): Promise<boolean> {
  if (!nodo.id) return false;
  const ubicacion = await ubicacionDeNodo(nodo);
  if (!ubicacion) {
    toast('❌ No se pudo resolver la habitación del nivel activo.');
    return false;
  }
  const cuerpo: Record<string, unknown> = {
    nombre: `Espacio ${n + 1}`,
    descripcion: '',
    // OBLIGATORIO del serializer: Ubicación física del contenedor padre.
    ubicacion,
    ui_left: `${6 + (n % 5) * 12}%`,
    ui_top: `${8 + (n % 4) * 16}%`,
    ui_width: '28%',
    ui_height: '24%',
    es_inmueble: false,
    // Subdivisión estructural: geometría del mapa sin stock espejo.
    crear_espejo: false,
    // Una DIVISIÓN interna nunca es monolítica: no nace como «Espacio Único».
    espacio_unico: false,
    // MOVILIDAD EXPLÍCITA (Lote 25/26): la división NACE como ARQUITECTURA del
    // espacio (false). El operador la declara «Mueble Móvil / Objeto» desde el
    // disyuntor del panel, que es el que persiste el flag en caliente.
    declarado_movible: false,
  };
  // El CONTENEDOR cuelga de su PADRE jerárquico (frontera real del nivel N+1).
  if (nodo.tipo !== 'habitacion') cuerpo.parent_contenedor = nodo.id;
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
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
  // 🧱 DISYUNTOR REVERSIBLE EN CALIENTE: al destildar «Espacio Único» el botón
  // «✏️ Editar» reaparece de inmediato (antes de que la cascada repinte el nivel)
  // y al tildarlo se deshabilita + el lienzo vuelve a navegación. La grilla directa
  // de objetos se destruye al re-transicionar la pantalla con el evento de abajo.
  reaccionarEspacioUnico(valor);
  window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
}

/**
 * Persiste el disyuntor «🎒 Mueble Móvil / Objeto» del CONTENEDOR activo (PUT
 * parcial multi-tenant: la Ubicación no expone el campo) y refresca el padrón en
 * memoria. El control vive SIEMPRE debajo de «Espacio Único» en el panel del
 * nivel activo, así que la declaración viaja acoplada a esa celda.
 */
export async function alternarMuebleMovil(nodo: NodoPortal, valor: boolean): Promise<void> {
  if (nodo.tipo !== 'contenedor') return;
  const ok = await guardarDeclaradoMovible(nodo.id, valor);
  if (!ok) return;
  reemplazarNodoActual({ declaradoMovible: valor });
  toast(
    valor
      ? '🎒 Mueble / Objeto declarado: se lista en «Elementos por ubicar» y en Objetos.'
      : '🧱 Declaración retirada: la pieza vuelve a ser ARQUITECTURA del espacio.',
  );
  window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
}

/**
 * LEY 2 · Despliega el EDITOR ELÁSTICO de divisiones en el Panel Derecho para una
 * habitación viva o un contenedor con sub-divisiones (recursivo ∞): cabecera con
 * «Espacio Único» + lienzo elástico naranja de perímetro ámbar estirable
 * («➕ Crear Espacio», arrastre, resizing y fusión). Idempotente por render.
 */
export function pintarEditorDivisiones(
  host: HTMLElement,
  nodo: NodoPortal,
  interior: InteriorNodo,
): void {
  const items = itemsEditor(interior);
  // PERÍMETRO ÁMBAR UNIVERSAL (reutilización del motor de la Planta): el lienzo
  // del interior se envuelve con `inyectarPerimetroElastico(..., nodo)` para que
  // el marco exterior sea estirable en CUALQUIER nivel de la cascada (habitación
  // o contenedor con sub-divisiones). El dueño persistente del ancho/alto es el
  // PROPIO nodo (`ui_width`/`ui_height`), nunca un contenedor inventado.
  const plano = inyectarPerimetroElastico(
    renderLienzoElastico({
      items,
      etiquetaCrear: 'Crear Espacio',
      textoVacio:
        'Este nivel todavía no tiene divisiones internas. Usá «➕ Crear Espacio» para subdividirlo en zonas físicas.',
      tip: TIP_DIVISIONES,
      // ⧉ «Duplicar» en cada tarjeta: copia exacta contigua del cajón/estante.
      permiteDuplicar: true,
    }),
    nodo,
  );
  host.innerHTML = cabeceraHtml(nodo) + plano;
  host.querySelector<HTMLInputElement>('[data-espacio-unico]')?.addEventListener('change', (ev) => {
    void alternarEspacioUnico(nodo, (ev.currentTarget as HTMLInputElement).checked);
  });
  // 🎒 Disyuntor de movilidad: acopla la declaración a la CELDA ACTIVA con PUT
  // parcial (mismo contrato que «Espacio Único») sin recargar la pantalla.
  host.querySelector<HTMLInputElement>('[data-mueble-movil]')?.addEventListener('change', (ev) => {
    void alternarMuebleMovil(nodo, (ev.currentTarget as HTMLInputElement).checked);
  });
  // Propiedades del Objeto espejo: se muestran al tildar el disyuntor y se
  // precargan si la pieza ya estaba declarada (PUT/GET parciales al Contenedor).
  conectarPropiedadesObjetoEspacio(host, nodo);
  conectarLienzoElastico({
    scope: host,
    rooms: () => items,
    adaptador: adaptadorContenedores(),
    crearItem: () => crearEspacioEnNodo(nodo, items.length),
    // ⧉ DUPLICAR: copia exacta contigua del espacio/sub-división (mismas
    // dimensiones, tipo y configuración) + nombre incremental. El latido de
    // cambios re-renderiza el nivel con la nueva pieza ya en su lugar.
    duplicarItem: async (item) => {
      const ok = await duplicarDivisionEnNodo(nodo, item);
      if (ok) window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
      return ok;
    },
    notificarCambios: () => window.dispatchEvent(new CustomEvent('estok:espacios-cambiados')),
  });
  // TIRADORES DEL PERÍMETRO (borde derecho / inferior / esquina): al estirar el
  // marco ámbar se ensanchan los límites físicos (%) de las sub-divisiones en
  // CUALQUIER nivel. La medida general se persiste en el recurso del NODO
  // (Ubicación ⇄ Contenedor) y el rebase de las tarjetas internas viaja SIEMPRE
  // por el adaptador de Contenedores (todos los hijos internos son contenedores).
  conectarPerimetroElastico({
    scope: host,
    id: () => nodo.id,
    guardar: guardarMedidaCon(adaptadorDelNodo(nodo)),
    adaptador: adaptadorContenedores(),
    alGuardar: () => window.dispatchEvent(new CustomEvent('estok:espacios-cambiados')),
  });
}
