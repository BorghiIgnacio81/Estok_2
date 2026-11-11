// =============================================================================
// TAXONOMÍA FÍSICA DE CONTENEDORES (cliente) - única fuente de la clasificación
// -----------------------------------------------------------------------------
// Espejo EXACTO en TypeScript de `inventario/services/taxonomia_contenedor.py`.
// Separa sin ambigüedad las CINCO naturalezas físicas del almacenamiento:
//
//   - CONJUNTO        → conjunto/estructura interna de un mueble (estante,
//                       cajonera, cajón). Estructura pura: NUNCA se lista como
//                       objeto suelto por ubicar.
//   - MUEBLE_INMUEBLE → mueble FIJO adherido a su cuarto (ropero empotrado, PC
//                       Setup, cama cucheta fija). Anclado: no se muda.
//   - MUEBLE_MOVIL    → mueble mudable (ropero espejo, archivador, cama
//                       cucheta). Es un MUEBLE CONTENEDOR: se dibuja como tal
//                       en el lienzo, pero NO es un objeto suelto por ubicar.
//   - CAJA            → contenedor móvil de inventario (caja pequeña). Siempre
//                       movible, contenedora y contenida (ej: «Caja 01»).
//   - OBJETO          → ítem fino suelto, contenido directamente en una
//                       habitación sin mueble (ej: «Cortadora de césped»).
//
// REGLA HERMÉTICA DE LA BANDEJA «por ubicar»: SOLO CAJAS móviles y OBJETOS
// sueltos. Toda estructura fija (CONJUNTO / MUEBLE_INMUEBLE) y todo mueble
// (MUEBLE_MOVIL) queda TERMINANTEMENTE EXCLUIDO, aunque no tenga casillero.
//
// COMPATIBILIDAD LEGACY: los payloads viejos podían traer `tipo='MUEBLE'` o
// `tipo='ESTANTE'`. Se normalizan en vivo para no romper ni una vista:
// 'MUEBLE' → MUEBLE_INMUEBLE si `es_inmueble`, si no MUEBLE_MOVIL; 'ESTANTE' →
// CONJUNTO.
// =============================================================================

export const TIPO_CONJUNTO = 'CONJUNTO';
export const TIPO_MUEBLE_INMUEBLE = 'MUEBLE_INMUEBLE';
export const TIPO_MUEBLE_MOVIL = 'MUEBLE_MOVIL';
export const TIPO_CAJA = 'CAJA';
export const TIPO_OBJETO = 'OBJETO';

/** Campos mínimos para clasificar cualquier pieza (payload de la API o local). */
export interface PiezaTaxonomica {
  tipo?: string | null;
  es_inmueble?: boolean | null;
  /**
   * DECLARACIÓN EXPLÍCITA del operador (checkbox del modal de edición): sólo
   * `true` marca la pieza como bulto movible. `false`/`null`/`undefined` = sin
   * declarar → se trata como ARQUITECTURA del espacio (Lote 25, default False).
   */
  declarado_movible?: boolean | null;
  parent_contenedor?: string | null;
  subcontenedores_count?: number | null;
  /** Geometría elástica del plano (null / cero = pieza sin lugar clavado). */
  ui_left?: string | null;
  ui_top?: string | null;
  ui_height?: string | null;
}

// =============================================================================
// LIMBO DE MUDANZA (Lote 28) · única fuente del concepto en el cliente
// -----------------------------------------------------------------------------
// La zona «En Tránsito» del tablero de mudanzas NO es un espacio físico del
// plano: es la habitación VIRTUAL donde aterrizan las piezas que viajan entre
// Estoks sin ubicación real (en el backend `Contenedor.ubicacion` es NOT NULL,
// así que una caja mudada nunca queda con ubicación nula). Espejo exacto de
// `NOMBRES_LIMBO` (inventario/services/mudanza_service.py).
// =============================================================================

/** Nombres vigentes de la habitación limbo de mudanza (actual + histórico). */
export const NOMBRES_LIMBO: readonly string[] = ['En Tránsito', 'Zona de Mudanza'];

/** ¿El rótulo de la habitación es el de la zona limbo de mudanza? */
export function esHabitacionLimbo(nombre?: string | null): boolean {
  return NOMBRES_LIMBO.includes(String(nombre ?? '').trim());
}

/** Procedencia espacial de un bulto: la aporta la API de contenedores. */
export interface PiezaEnBandeja extends PiezaTaxonomica {
  /** Rótulo de la pieza: «Caja 02»…«Cajas 05» la declara Caja por sí solo. */
  nombre?: string | null;
  /**
   * Guardada dentro de un mueble anfitrión SIN estante fino: es un bulto
   * pendiente de ubicación fina y por lo tanto admisible en la canasta.
   */
  en_transito_interno?: boolean | null;
  /** ID de la habitación que la aloja (`null` = limbo huérfano). */
  ubicacion?: string | null;
  /** Nombre de esa habitación (`null` = limbo huérfano). */
  ubicacion_nombre?: string | null;
}

/**
 * PIEZA EN EL LIMBO DE MUDANZA: sin habitación física real asignada.
 *
 * Una caja mudada entre Estoks aterriza en la habitación limbo «En Tránsito»
 * (o queda huérfana con `ubicacion` nula), así que cada pantalla la trata como
 * «suelta» y no como una pieza ubicada en un cuarto del plano.
 */
export function esCajaEnLimbo(pieza: PiezaEnBandeja | null | undefined): boolean {
  if (pieza?.ubicacion == null) return true;
  return esHabitacionLimbo(pieza.ubicacion_nombre);
}

// =============================================================================
// OBJETOS Y SU HOGAR ESPACIAL (contenedor ⇄ espacio) · única fuente en el cliente
// -----------------------------------------------------------------------------
// La canasta «🧺 Elementos por ubicar» distingue dos preguntas distintas:
//   · ¿el objeto está ALOJADO en un contenedor? (`contenedor_id IS NOT NULL`)
//   · ¿el objeto no tiene NINGÚN hogar espacial?
// Un objeto que vive dentro de una caja NO es un bulto suelto: su ubicación
// física depende EXCLUSIVAMENTE de la caja que lo aloja, así que no se lista ni
// se marca individualmente (se representa con el chip de su contenedor).
// =============================================================================

/** Referencias espaciales mínimas de un Objeto (las FK que expone la API). */
export interface ObjetoConHogar {
  /** Caja/contenedor que lo aloja (`null` = no pertenece a ningún contenedor). */
  contenedor?: string | null;
  /** Habitación/espacio físico (`null` = sin espacio asignado). */
  ubicacion?: string | null;
  /** Nombre de esa habitación (`null` = sin espacio asignado). */
  ubicacion_nombre?: string | null;
}

/**
 * OBJETO ALOJADO EN UN CONTENEDOR (`contenedor_id IS NOT NULL`).
 *
 * Su ubicación física depende del contenedor que lo aloja: nunca debe listarse
 * como «objeto suelto» ni rotularse «En tránsito» por su cuenta. Si la caja está
 * en el limbo de mudanza, el bulto recuperable es LA CAJA, no su contenido.
 */
export function esObjetoAlojadoEnContenedor(
  objeto: ObjetoConHogar | null | undefined,
): boolean {
  return objeto?.contenedor != null;
}

/**
 * OBJETO SUELTO ESTRICTO de la canasta: `contenedor_id IS NULL` Y sin espacio
 * físico real (`ubicacion_id IS NULL`).
 *
 * El limbo de mudanza («En Tránsito» / «Zona de Mudanza») cuenta como SIN
 * espacio físico: es una habitación VIRTUAL de sistema, no un cuarto del plano,
 * así que el objeto sigue siendo un bulto a ubicar (espejo de `esCajaEnLimbo`).
 */
export function esObjetoSueltoSinHogar(
  objeto: ObjetoConHogar | null | undefined,
): boolean {
  if (esObjetoAlojadoEnContenedor(objeto)) return false;
  if (objeto?.ubicacion == null) return true;
  return esHabitacionLimbo(objeto.ubicacion_nombre);
}

/**
 * Tipo físico normalizado (mayúsculas) tolerando payloads legacy o parciales.
 *
 * `null`/vacío → 'CAJA' (mismo default del modelo `Contenedor`).
 * 'MUEBLE' → MUEBLE_INMUEBLE si `es_inmueble`, si no MUEBLE_MOVIL.
 * 'ESTANTE' → CONJUNTO.
 */
export function tipoFisico(pieza: PiezaTaxonomica | null | undefined): string {
  const crudo = String(pieza?.tipo || '').toUpperCase();
  if (crudo === 'MUEBLE') {
    return pieza?.es_inmueble ? TIPO_MUEBLE_INMUEBLE : TIPO_MUEBLE_MOVIL;
  }
  if (crudo === 'ESTANTE') return TIPO_CONJUNTO;
  return crudo || TIPO_CAJA;
}

/** CAJA móvil: contenido puro del inventario (`tipo='CAJA'` y es_inmueble=false). */
export function esCajaMovil(pieza: PiezaTaxonomica | null | undefined): boolean {
  return tipoFisico(pieza) === TIPO_CAJA && !pieza?.es_inmueble;
}

/** CONJUNTO: estructura interna de un mueble (estante/cajonera/cajón). */
export function esConjunto(pieza: PiezaTaxonomica | null | undefined): boolean {
  return tipoFisico(pieza) === TIPO_CONJUNTO;
}

/** MUEBLE (móvil o inmueble): dueño de su cuadrícula de casilleros. */
export function esMueble(pieza: PiezaTaxonomica | null | undefined): boolean {
  return tipoFisico(pieza) === TIPO_MUEBLE_MOVIL
    || tipoFisico(pieza) === TIPO_MUEBLE_INMUEBLE
    || pieza?.es_inmueble === true;
}

/** MUEBLE inmueble fijo (ropero empotrado, PC Setup, cama fija). */
export function esMuebleInmueble(pieza: PiezaTaxonomica | null | undefined): boolean {
  return tipoFisico(pieza) === TIPO_MUEBLE_INMUEBLE || pieza?.es_inmueble === true;
}

/**
 * MUEBLE MÓVIL (mudable): ropero espejo, archivador, cama cucheta. Es un mueble
 * CONTENEDOR mudable —el único tipo de mueble admitido en la bandeja lateral de
 * «Elementos por ubicar»— y nunca una estructura fija.
 */
export function esMuebleMovil(pieza: PiezaTaxonomica | null | undefined): boolean {
  return tipoFisico(pieza) === TIPO_MUEBLE_MOVIL && pieza?.es_inmueble !== true;
}

/**
 * ESTRUCTURA INGRESABLE (navegable hacia adentro): un mueble (móvil o inmueble),
 * un CONJUNTO o cualquier contenedor que ya tenga sub-divisiones. Es el criterio
 * con el que el lienzo ABRE el interior de una pieza en vez de tratarla como hoja
 * del inventario (permite bajar de nivel en «PC Setup», «Zona Indoor», etc.).
 */
export function esEstructuraIngresable(pieza: PiezaTaxonomica | null | undefined): boolean {
  return esMueble(pieza)
    || esConjunto(pieza)
    || Number(pieza?.subcontenedores_count) > 0;
}

/**
 * ARQUITECTURA FIJA DEL PLANO: valores de `ui_*` que significan «sin geometría»
 * (default del modelo o cero exacto). Espejo de `VALORES_SIN_GEOMETRIA`
 * (`inventario/services/taxonomia_contenedor.py`).
 */
export const VALORES_SIN_GEOMETRIA: readonly string[] = [
  '',
  '0',
  '0%',
  '0px',
  'auto',
  '0.0',
  '0.0%',
  '0.00',
  '0.00%',
];

/** Campos posicionales del plano que declaran una pieza como arquitectura fija. */
export const CAMPOS_GEOMETRIA_FIJA = ['ui_left', 'ui_top', 'ui_height'] as const;

/**
 * GEOMETRÍA FIJA EN UN PLANO: la pieza tiene coordenadas geométricas propias
 * (`ui_left`/`ui_top` fuera del origen, o una altura MODELADA distinta de
 * 'auto'), o sea que está CLAVADA en el lienzo de su cuarto o mueble.
 *
 * Es una pieza de ARQUITECTURA: un «Espacio», una división interna o un mueble
 * modelado NUNCA es un bulto transportable, aunque su tipo sea CAJA y no tenga
 * sub-divisiones. Regla matemática estricta compartida con el backend
 * (`inventario/services/taxonomia_contenedor.tiene_geometria_de_plano`).
 */
export function tieneGeometriaDePlano(pieza: PiezaTaxonomica | null | undefined): boolean {
  return CAMPOS_GEOMETRIA_FIJA.some((campo) => {
    const crudo = String(pieza?.[campo] ?? '').trim().toLowerCase();
    return !VALORES_SIN_GEOMETRIA.includes(crudo);
  });
}

/**
 * BULTO MOVIBLE REAL admitido en la canasta lateral de «Elementos por ubicar».
 *
 * WHITELIST FÍSICA: sólo CAJAS móviles (`tipo='CAJA'`, no inmueble).
 *
 * PURGA DE NODOS JERÁRQUICOS: una caja con sub-contenedores propios ya es una
 * estructura, no un bulto transportable.
 *
 * CANALES DE RECONOCIMIENTO (espejo exacto del ORM `aplicar_filtro_bandeja`):
 *   1. RESCATE del limbo de mudanza (caja raíz suelta en «En Tránsito»);
 *   2. `declarado_movible=True` (checkbox del modal / alta de caja);
 *   3. `en_transito_interno=True` (guardada sin estante fino);
 *   4. rótulo que EMPIEZA por «Caja» («Caja 01»…«Cajas 05», «Caja de
 *      herramientas»).
 *
 * BUG QUE ESTO CORRIGE
 *   La purga por geometría de plano (`tieneGeometriaDePlano`) se evaluaba ANTES
 *   de los canales 2–4, así que toda caja dibujada en el minimapa de su mueble
 *   (las «Caja 01…05» hijas de «Estante 1» tienen `ui_left/ui_top/ui_height`)
 *   desaparecía de la canasta aunque existiera y tuviera objetos dentro. La
 *   ARQUITECTURA —habitaciones «Espacio N», muebles y zonas— tampoco entra
 *   ahora: no aparece por ningún canal (no está declarada movible ni se rotula
 *   «Caja…»).
 */
export function esBultoMovibleDeBandeja(pieza: PiezaEnBandeja | null | undefined): boolean {
  if (!esCajaMovil(pieza)) return false;
  if (Number(pieza?.subcontenedores_count ?? 0) > 0) return false;
  // 1 · RESCATE DE EMERGENCIA (Lote 28): una caja RAÍZ suelta en el LIMBO de
  // mudanza entra SIEMPRE —aunque `declarado_movible` esté en False por una
  // mudanza vieja—: es la única vía para que el operador la vea y la edite.
  if (esCajaEnLimbo(pieza) && !pieza?.parent_contenedor) return true;
  // 2-4 · CANALES DE RECONOCIMIENTO DE CAJA.
  if (pieza?.declarado_movible === true) return true;
  if (pieza?.en_transito_interno === true) return true;
  return esNombreDeCaja(pieza?.nombre);
}

// =============================================================================
// OBJETOS CONTENEDOR («📦 Cajas e Inventario Interno»)
// =============================================================================
/**
 * Nombre de categoría comparable: sin espacios extremos, minúsculas y SIN
 * ACENTOS («Baúles» → «baules»). Espejo de
 * `taxonomia_contenedor.normalizar_nombre_categoria` del backend.
 */
export function normalizarNombreCategoria(nombre?: string | null): string {
  return String(nombre ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Categorías que declaran un Objeto como bulto contenedor. Espejo EXACTO de
 * `CATEGORIAS_QUE_DECLARAN_CONTENEDOR` en
 * `inventario/services/taxonomia_contenedor.py` (fuente única del backend).
 *
 * Sólo estos nombres autorizan `es_contenedor = true` sin checkbox manual: un
 * objeto de «Muebles», «Materiales», «Herramientas» o «Electrónica» NUNCA es
 * contenedor, aunque su categoría tenga marcado `es_contenedor` (ese flag del
 * backend significa «categoría de Mercado Libre con subcategorías»).
 */
const CATEGORIAS_OBJETO_CONTENEDOR = [
  'cajas y contenedores',
  'cajas y contenedor',
  'cajas / contenedores',
  'cajas/contenedores',
  'cajas',
  'caja',
  'contenedores',
  'contenedor',
  'baules',
  'baul',
  'organizadores',
  'organizador',
  'maletas',
  'maleta',
  'valijas',
  'valija',
  'canastos',
  'canasto',
];

/** ¿El NOMBRE de la categoría declara bultos contenedores? (espejo backend). */
export function esCategoriaQueDeclaraContenedor(nombre?: string | null): boolean {
  return CATEGORIAS_OBJETO_CONTENEDOR.includes(normalizarNombreCategoria(nombre));
}

/**
 * RÓTULO DE CAJA («Caja 02», «Cajas 03», «Caja de herramientas»). Espejo
 * exacto de `PATRON_NOMBRE_CAJA` en `inventario/services/taxonomia_contenedor.py`.
 *
 * Es la TERCERA vía de declaración de una caja (además de `es_contenedor` y de
 * la categoría «Cajas y Contenedores»): el alta rápida persiste sólo el nombre,
 * así que sin esta regla las cajas se leían como OBJETOS SUELTOS.
 * La regla es el PREFIJO «Caja»/«Cajas»: el operador no necesita marcar ninguna
 * casilla para que el registro sea reconocido como bulto contenedor.
 */
export const RE_NOMBRE_CAJA = /^\s*cajas?/i;

/** ¿El rótulo declara caja? (espejo de `es_nombre_de_caja`). */
export function esNombreDeCaja(nombre?: string | null): boolean {
  return RE_NOMBRE_CAJA.test(String(nombre ?? '').trim());
}

/** Campos mínimos para decidir si un Objeto es una caja/contenedor. */
export interface ObjetoClasificable {
  es_contenedor?: boolean | null;
  categoria_nombre?: string | null;
  /** Rótulo del registro: empezar por «Caja» lo declara caja por sí solo. */
  nombre?: string | null;
}

/**
 * OBJETO CONTENEDOR: bulto declarado por el operador (`es_contenedor=true`), por
 * la categoría base «Cajas y Contenedores» o por su RÓTULO de caja (empieza por
 * «Caja»).
 *
 * La consumen las vistas que deben agrupar estos registros junto a las cajas
 * físicas (bandeja de Almacenamiento) y NUNCA entre los «Objetos sueltos».
 * Espejo exacto de `services/arbol_inventario_objetos_contenedor.es_objeto_contenedor`.
 */
export function esObjetoContenedor(objeto: ObjetoClasificable | null | undefined): boolean {
  if (objeto?.es_contenedor === true) return true;
  if (esCategoriaQueDeclaraContenedor(objeto?.categoria_nombre)) return true;
  return esNombreDeCaja(objeto?.nombre);
}
