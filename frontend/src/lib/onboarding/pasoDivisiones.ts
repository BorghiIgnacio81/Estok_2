// =============================================================================
// PASO 3 DEL ASISTENTE — GUÍA SECUENCIAL DE DIVISIONES DE LA HABITACIÓN
// -----------------------------------------------------------------------------
// Flujo GUIADO (asistente), NO un formulario plano:
//   1. Se le pregunta al usuario: «¿Desea crear las divisiones y estanterías
//      internas de sus ambientes?».
//   2. Se enumeran los ambientes UNIFICADOS (deduplicados) y, por cada uno, hay
//      dos botones:
//        · [🧱 Crear Divisiones] → despliega el lienzo elástico naranja de ese
//          cuarto (subdividir, arrastrar, estirar y fusionar en un bloque).
//        · [Omitir]              → saltea ese ambiente de forma limpia.
//
// FIX DE CAMPO — DEDUPLICACIÓN: el listado SIEMPRE se pide al endpoint filtrado
// `GET /api/ubicaciones/?deduplicar_grupos=1` (a través de ./api → listarAmbientes),
// de modo que un espacio fusionado en «L» se muestra como UNA sola opción y NUNCA
// como tiles repetidos («Cocina, Fusión, Fusión, Baño»). El lienzo 2D sí recibe
// todos los tiles: solo el selector colapsa el grupo.
//
// El lienzo reutiliza el MISMO motor elástico 2D del plano (renderLienzoElastico
// + conectarLienzoElastico). Cada espacio es una subdivisión ESTRUCTURAL: se crea
// con POST /api/contenedores/ (crear_espejo=false → sin stock) y se fusiona en un
// bloque único e indisoluble. Persistencia multi-tenant (JWT + X-Estok-Id) 100%
// delegada al motor 2D (adaptadorContenedores). No reimplementa headers ni red.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../../services/auth';
import { escapeHtml, guardarUbicacion } from '../mapaJerarquico';
import { checkboxEspacioUnicoHtml } from '../espacioUnico';
import { renderLienzoElastico } from '../mapaPlantaUnica';
import { conectarLienzoElastico } from '../plantaUnicaInteractivo';
import { adaptadorContenedores } from '../lienzoElastico';
import type { ItemElastico } from '../lienzoElastico';
import { asegurarPrimerAmbiente, listarAmbientes } from './api';
import type { RecursoCreado } from './api';
import { avisoGlobal } from './comunes';

/** Contenedor/espacio raíz de una habitación tal como lo devuelve el backend. */
interface EspacioApi {
  id: string | number;
  nombre: string;
  ui_left?: string | null;
  ui_top?: string | null;
  ui_width?: string | null;
  ui_height?: string | null;
  fusion_grupo?: string | null;
}

/** Ayuda contextual del lienzo de divisiones (se dibuja dentro del lienzo). */
const TIP_DIVISIONES =
  '🧱 <strong>Divisiones de la habitación</strong> · inyectá cada zona con <strong>«➕ Crear Espacio»</strong>, arrastrala para acomodarla, estirá de su esquina para cambiar su tamaño y <strong>seleccioná 2+ para fusionarlas</strong> en un único bloque indisoluble. Todo se guarda solo.';

// --- Estado del LIENZO elástico de la habitación activa ----------------------
let contenedor: HTMLElement | null = null;
let roomId: string | null = null;
let espacios: ItemElastico[] = [];

// --- Estado de la GUÍA secuencial (lista de ambientes) -----------------------
let listaEl: HTMLElement | null = null;
let lienzoEl: HTMLElement | null = null;
let ambientes: RecursoCreado[] = [];
let roomActivo: string | null = null;
/**
 * Ambientes marcados con «⏳ En otro momento»: la estructura se modelará más
 * tarde (solo afecta a la interfaz; nada se borra ni se bloquea).
 */
const diferidos = new Set<string>();

// =============================================================================
// LIENZO ELÁSTICO DE LA HABITACIÓN ACTIVA
// =============================================================================

/** GET de los espacios RAÍZ de la habitación (fuente de verdad = PostgreSQL). */
async function fetchEspacios(id: string): Promise<ItemElastico[]> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/contenedores/?ubicacion=${id}&raiz=true&page_size=1000`,
      { headers: { ...getAuthHeaders() } },
    );
    if (res.status === 401) {
      window.location.href = '/login';
      return [];
    }
    if (!res.ok) return [];
    const data = (await res.json()) as EspacioApi[] | { results?: EspacioApi[] };
    const lista: EspacioApi[] = Array.isArray(data) ? data : data?.results ?? [];
    return lista.map((c) => ({
      id: String(c.id),
      nombre: c.nombre,
      ui_left: c.ui_left ?? null,
      ui_top: c.ui_top ?? null,
      ui_width: c.ui_width ?? null,
      ui_height: c.ui_height ?? null,
      fusion_grupo: c.fusion_grupo ?? null,
    }));
  } catch {
    return [];
  }
}

/** Crea un espacio estructural (sin espejo de stock) dentro de la habitación. */
async function crearEspacio(id: string): Promise<boolean> {
  if (!id) return false;
  const n = espacios.length;
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: `Espacio ${n + 1}`,
        descripcion: '',
        ubicacion: id,
        ui_left: `${6 + (n % 5) * 12}%`,
        ui_top: `${8 + (n % 4) * 16}%`,
        ui_width: '28%',
        ui_height: '24%',
        es_inmueble: false,
        // Subdivisión estructural del paso 3: geometría del mapa sin stock espejo.
        crear_espejo: false,
        // Una DIVISIÓN interna nunca es monolítica: no nace como «Espacio Único».
        espacio_unico: false,
      }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

/** Render + re-enlace del motor 2D (el marcado se regenera en cada refresco). */
function pintar(): void {
  const cont = contenedor;
  if (!cont) return;
  cont.innerHTML = renderLienzoElastico({
    items: espacios,
    etiquetaCrear: 'Crear Espacio',
    textoVacio:
      'Sin divisiones todavía. Usá «➕ Crear Espacio» para subdividir esta habitación en zonas físicas.',
    tip: TIP_DIVISIONES,
  });
  conectarLienzoElastico({
    scope: cont,
    rooms: () => espacios,
    adaptador: adaptadorContenedores(),
    notificarCambios: () => void refrescar(),
    crearItem: () => crearEspacio(roomId ?? ''),
  });
}

/** Ciclo completo: leer el backend, dibujar y re-enlazar la edición. */
async function refrescar(): Promise<void> {
  espacios = roomId ? await fetchEspacios(roomId) : [];
  pintar();
}

/** Monta el lienzo elástico de la habitación elegida (idempotente). */
async function montarDivisiones(id: string, cont: HTMLElement): Promise<void> {
  contenedor = cont;
  roomId = id;
  await refrescar();
}

/** Limpia SOLO el estado del lienzo (la lista de ambientes sigue viva). */
function desmontarLienzo(): void {
  contenedor = null;
  roomId = null;
  espacios = [];
  if (lienzoEl) lienzoEl.innerHTML = '';
}

// =============================================================================
// GUÍA SECUENCIAL (lista de ambientes + acciones por ambiente)
// =============================================================================

/**
 * Render de la lista guiada de ambientes (deduplicados) con sus acciones:
 * checkbox reutilizable «Espacio Único», [🧱 Crear Divisiones] y [⏳ En otro
 * momento]. Si el ambiente es «Espacio Único» (monolítico) se bloquea la
 * creación de divisiones y se muestra que está listo para recibir objetos.
 */
function pintarLista(): void {
  const cont = listaEl;
  if (!cont) return;
  if (ambientes.length === 0) {
    cont.innerHTML =
      '<p class="text-sm text-gray-400">Todavía no hay ambientes. Podés marcar «En otro momento» y subdividir más tarde desde Almacenamiento.</p>';
    return;
  }
  cont.innerHTML = ambientes
    .map((a) => {
      const unico = Boolean(a.espacioUnico);
      const diferido = diferidos.has(a.id);
      const activo = roomActivo === a.id;
      const base = 'rounded-2xl border px-4 py-3 flex flex-col gap-2 transition-base';
      const tono = activo
        ? 'border-orange-400 bg-orange-50'
        : diferido
          ? 'border-amber-200 bg-amber-50/70'
          : 'border-gray-200 bg-white';
      const botonCrear = unico
        ? '<span class="px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">✅ Listo para objetos</span>'
        : `<button type="button" data-div-crear="${a.id}" class="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold transition-base">🧱 Crear Divisiones</button>`;
      const etiquetaDiferido = diferido
        ? '<span class="text-[11px] font-semibold text-amber-700">⏳ Se modelará más tarde</span>'
        : '';
      return `<div class="${base} ${tono}" data-div-fila="${a.id}">
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
          <div class="flex items-center gap-2 flex-wrap">
            <p class="text-sm font-semibold text-gray-800">${escapeHtml(a.nombre)}</p>
            ${etiquetaDiferido}
          </div>
          ${checkboxEspacioUnicoHtml({ id: `divUnico-${a.id}`, marcado: unico, valor: a.id })}
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          ${botonCrear}
          <button type="button" data-div-otro-momento="${a.id}" class="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold transition-base">⏳ En otro momento</button>
        </div>
      </div>`;
    })
    .join('');
}

/** Activa el cuarto elegido y despliega abajo su lienzo elástico naranja. */
async function seleccionarAmbiente(id: string): Promise<void> {
  if (!id) return;
  diferidos.delete(id);
  roomActivo = id;
  pintarLista();
  if (!lienzoEl) return;
  lienzoEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  await montarDivisiones(id, lienzoEl);
}

/**
 * «⏳ En otro momento»: la estructura de ese ambiente se modelará más tarde. No
 * borra nada ni bloquea el paso: deja el editor disponible en esa sección para
 * futuras pasadas y permite avanzar de forma limpia.
 */
function marcarParaOtroMomento(id: string): void {
  if (!id) return;
  diferidos.add(id);
  if (roomActivo === id) {
    roomActivo = null;
    desmontarLienzo();
  }
  pintarLista();
}

/**
 * Persiste el checkbox «Espacio Único» de un ambiente (PUT /api/ubicaciones/{id}/).
 * Un «Espacio Único» es monolítico: se cierra su lienzo de divisiones (queda
 * listo para recibir objetos de forma directa, sin quedar «En Tránsito»).
 */
async function persistirEspacioUnico(id: string, valor: boolean): Promise<void> {
  const ambiente = ambientes.find((a) => a.id === id);
  const ok = await guardarUbicacion(id, { espacio_unico: valor });
  if (ambiente) ambiente.espacioUnico = valor;
  if (valor && roomActivo === id) {
    roomActivo = null;
    desmontarLienzo();
  }
  pintarLista();
  avisoGlobal(
    ok
      ? `✅ «${ambiente?.nombre ?? 'Ambiente'}» ${valor ? 'declarado Espacio Único' : 'dividible de nuevo'}.`
      : '⚠️ No se pudo guardar «Espacio Único». Reintentá.',
  );
}

/**
 * Monta la GUÍA del Paso 3 (idempotente; se re-corre al reingresar al paso).
 * El listado viene SIEMPRE del endpoint deduplicado (?deduplicar_grupos=1).
 */
export async function montarGuiaDivisiones(opciones: {
  lista: HTMLElement;
  lienzo: HTMLElement;
}): Promise<void> {
  listaEl = opciones.lista;
  lienzoEl = opciones.lienzo;
  diferidos.clear();
  roomActivo = null;
  desmontarLienzo();

  // Fix de deduplicación: un espacio fusionado en «L» = UNA sola opción.
  let lista = await listarAmbientes();
  if (lista.length === 0) {
    const base = await asegurarPrimerAmbiente();
    if (base) lista = [base];
  }
  ambientes = lista;
  pintarLista();

  // Delegación de eventos por asignación (idempotente ante re-montajes).
  listaEl.onclick = (e) => {
    const t = e.target as HTMLElement;
    const crear = t.closest<HTMLElement>('[data-div-crear]');
    if (crear?.dataset.divCrear) {
      void seleccionarAmbiente(crear.dataset.divCrear);
      return;
    }
    const otro = t.closest<HTMLElement>('[data-div-otro-momento]');
    if (otro?.dataset.divOtroMomento) marcarParaOtroMomento(otro.dataset.divOtroMomento);
  };
  // Checkbox reutilizable «Espacio Único»: persiste al toque (change delega).
  listaEl.onchange = (e) => {
    const input = e.target as HTMLInputElement;
    const id = input?.dataset?.espacioUnico;
    if (id) void persistirEspacioUnico(id, input.checked);
  };
}

/** Limpia TODO el estado del Paso 3 (vuelta atrás o cierre del asistente). */
export function desmontarDivisiones(): void {
  desmontarLienzo();
  listaEl = null;
  lienzoEl = null;
  ambientes = [];
  diferidos.clear();
  roomActivo = null;
}
