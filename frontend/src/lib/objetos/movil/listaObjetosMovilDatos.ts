// =============================================================================
// LISTA MÓVIL DE OBJETOS (/objetos) · CAPA DE DATOS (100% pura, sin DOM)
// -----------------------------------------------------------------------------
// Alimenta la VISTA MÓVIL del inventario (la reemplaza en pantallas chicas):
//
//   1. APLANA el payload de GET /api/contenedores/arbol/ en UNA sola lista de
//      ítems —objetos sueltos, objetos en contenedor, objetos de categoría
//      «Muebles», cajas y muebles— cada uno con su ubicación legible, su foto
//      (o ícono canónico) y el destino de sus acciones.
//   2. Construye las OPCIONES de la barra de filtros EN CASCADA (combobox de
//      criterio → combobox de opciones) a partir del inventario realmente
//      presente, para que nunca se ofrezcan opciones vacías.
//   3. FILTRA acumulando criterios simultáneos (Categoría · Ubicación ·
//      Estado/Decisión · Capacidad de Caja) más la búsqueda libre.
//
// Sin red y sin estado propio: el DOM y el estado de los filtros viven en el
// controlador (listaObjetosMovil.ts) y el HTML en listaObjetosMovilVista.ts.
// =============================================================================

import type { ObjetoArbol, PayloadArbol } from '../../listadoObjetosPiezas';
// Etiquetas visibles: FUENTE ÚNICA compartida con los chips del listado.
import { ETIQUETA_DECISION, ETIQUETA_ESTADO } from '../../listadoObjetosPiezas';
// Estado de la caja (llena / con espacio / vacía): fuente ÚNICA del dominio.
import { estadoCaja } from '../../cajaEstadoBadge';
import type { CajaEstadoFuente } from '../../cajaEstadoBadge';
// Ícono canónico del contenedor que aloja un objeto («📦 En Caja 02»).
import { ICONO_CONTENEDOR } from '../../listadoObjetosEnContenedor';
// Ícono canónico del objeto según su categoría (/mueble.webp · /fluffy-objeto.webp).
import { iconoDeObjeto } from '../../iconoObjeto';
// Iconografía de interfaz (rutas WebP optimizadas) en UN solo módulo.
import { ASSET_CAJA, ASSET_MUEBLE } from '../../assetsUi';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Criterios de la barra de filtros en cascada. */
export type CriterioFiltroMovil = 'categoria' | 'ubicacion' | 'estado' | 'caja';

/** Naturaleza del renglón: objeto físico o contenedor (caja / mueble). */
export type OrigenItemMovil = 'suelto' | 'contenedor' | 'caja' | 'mueble';

/** Criterio + opción elegida acumulada (una píldora por criterio). */
export interface FiltroMovilActivo {
  criterio: CriterioFiltroMovil;
  /** Valor de la opción (`<uuid>`, `estado:<clave>`, `caja:llenas`, …). */
  valor: string;
  /** Etiqueta visible de la opción (sin el nombre del criterio). */
  etiqueta: string;
}

/** Opción del segundo combobox. `grupo` arma los <optgroup>. */
export interface OpcionFiltroMovil {
  valor: string;
  etiqueta: string;
  grupo?: string;
}

/** Renglón de la lista móvil de detalles. */
export interface ItemListaMovil {
  tipo: 'objeto' | 'contenedor';
  origen: OrigenItemMovil;
  id: string;
  nombre: string;
  /** Foto real o ícono canónico (siempre una URL válida). */
  foto: string;
  /** Ubicación legible del ambiente («Planta de Arriba · Habitación Frente»). */
  ubicacion: string;
  /** Clave del filtro «Ubicación» ('' = sin ubicación registrada). */
  ubicacionClave: string;
  /** Insignia del contenedor que lo aloja («📦 En Caja 02»), si aplica. */
  contenedor: string;
  categoria: string;
  /** Clave del filtro «Categoría» ('' = sin categoría). */
  categoriaClave: string;
  /** Chip de naturaleza: «📦 Caja», «🗄 Mueble», «🧸 Objeto». */
  tipoEtiqueta: string;
  estado: string;
  decision: string;
  /** Caja declarada llena (lote fotografiado). */
  esLlena: boolean;
  /** Objetos directos registrados en la caja/mueble. */
  objetos: number;
  href: string;
  hrefEditar: string;
  /** `true` cuando las acciones operativas son las de un Objeto. */
  editableComoObjeto: boolean;
  /** Nodo crudo: alimenta los chips y los `data-*` de las acciones. */
  datos: Record<string, any>;
}

// Marcadores de los valores «sin dato» (nunca colisionan con un UUID).
export const SIN_UBICACION = 'sin_ubicacion';
export const SIN_CATEGORIA = 'sin_categoria';
export const SIN_DECISION = 'sin_decision';

/** Criterios en el orden en que se ofrecen en el primer combobox. */
export const CRITERIOS_FILTRO_MOVIL: Array<{ valor: CriterioFiltroMovil; etiqueta: string }> = [
  { valor: 'categoria', etiqueta: 'Categoría' },
  { valor: 'ubicacion', etiqueta: 'Ubicación' },
  { valor: 'estado', etiqueta: 'Estado / Decisión' },
  { valor: 'caja', etiqueta: 'Capacidad / Estado de Caja' },
];

/** Etiqueta visible de un criterio (usada en las píldoras activas). */
export function etiquetaCriterio(criterio: CriterioFiltroMovil): string {
  return CRITERIOS_FILTRO_MOVIL.find((c) => c.valor === criterio)?.etiqueta || criterio;
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

/** Texto normalizado para búsquedas: minúsculas y sin tildes. */
function normalizarTexto(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function texto(valor: unknown): string {
  return String(valor ?? '').trim();
}

/** Foto real del objeto o su ícono canónico según la categoría. */
function fotoObjeto(obj: ObjetoArbol): string {
  const foto = texto(obj.foto_principal);
  if (foto) return foto;
  return iconoDeObjeto(obj.categoria_nombre, obj.categoria_slug);
}

// ---------------------------------------------------------------------------
// Construcción de renglones
// ---------------------------------------------------------------------------

/** Renglón de un OBJETO físico (suelto, en contenedor o mueble-objeto). */
function itemObjeto(obj: ObjetoArbol, origen: OrigenItemMovil): ItemListaMovil {
  const id = texto(obj.id);
  const categoria = texto(obj.categoria_nombre);
  const categoriaId = texto(obj.categoria);
  const contenedorNombre = texto(obj.contenedor_etiqueta);
  const contenedor = contenedorNombre
    ? (ICONO_CONTENEDOR[texto(obj.contenedor_tipo)] || '📦') + ' En ' + contenedorNombre
    : '';
  const ubicacionClave = texto(obj.ubicacion_nombre);
  return {
    tipo: 'objeto',
    origen,
    id,
    nombre: texto(obj.nombre) || 'Sin nombre',
    foto: fotoObjeto(obj),
    ubicacion: texto(obj.ubicacion_display) || ubicacionClave || contenedor,
    ubicacionClave,
    contenedor,
    categoria,
    categoriaClave: categoriaId || (categoria ? 'n:' + normalizarTexto(categoria) : ''),
    tipoEtiqueta: '🧸 Objeto',
    estado: texto(obj.estado_conservacion),
    decision: texto(obj.owner_action),
    esLlena: obj.esta_llena === true,
    objetos: 0,
    href: '/objetos/' + id,
    hrefEditar: '/objetos/' + id + '/editar',
    editableComoObjeto: true,
    datos: obj,
  };
}

/**
 * Renglón de un CONTENEDOR (caja o mueble del árbol). Los Objetos declarados
 * caja (`origen='objeto'`) conservan su enlace a la ficha de objeto; el resto
 * abre la ficha del contenedor y sus acciones operativas de siempre.
 */
function itemContenedor(nodo: Record<string, any>, origen: 'caja' | 'mueble'): ItemListaMovil {
  const id = texto(nodo.id);
  const esObjetoDeclarado = origen === 'caja' && texto(nodo.origen) === 'objeto';
  const estado = estadoCaja(nodo as CajaEstadoFuente);
  const ubicacionClave = texto(nodo.ubicacion_nombre);
  return {
    tipo: 'contenedor',
    origen,
    id,
    nombre: texto(nodo.nombre) || 'Sin nombre',
    foto: texto(nodo.foto)
      || (origen === 'mueble' ? ASSET_MUEBLE : ASSET_CAJA),
    ubicacion: ubicacionClave,
    ubicacionClave,
    contenedor: '',
    categoria: '',
    categoriaClave: '',
    tipoEtiqueta: esObjetoDeclarado
      ? '📦 Caja / Contenedor'
      : (origen === 'mueble' ? '🗄 Mueble' : '📦 Caja'),
    estado: '',
    decision: '',
    esLlena: estado.esLlena,
    objetos: estado.objetos,
    href: esObjetoDeclarado ? '/objetos/' + id : '/contenedores/' + id,
    hrefEditar: esObjetoDeclarado ? '/objetos/' + id + '/editar' : '',
    editableComoObjeto: esObjetoDeclarado,
    datos: nodo,
  };
}

// ---------------------------------------------------------------------------
// Aplanado del payload
// ---------------------------------------------------------------------------

/**
 * Aplana el payload jerárquico en la lista móvil, en el MISMO orden de las
 * secciones del escritorio: sueltos → cajas → objetos en contenedor →
 * muebles (+ objetos de categoría «Muebles»). Sin duplicados por `tipo:id`.
 */
export function construirItemsMoviles(payload: PayloadArbol): ItemListaMovil[] {
  const items: ItemListaMovil[] = [];
  const vistos = new Set<string>();
  const agregar = (item: ItemListaMovil): void => {
    if (!item.id) return;
    const clave = item.tipo + ':' + item.id;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    items.push(item);
  };

  for (const obj of payload.sueltos || []) agregar(itemObjeto(obj, 'suelto'));
  for (const caja of payload.cajas || []) agregar(itemContenedor(caja, 'caja'));
  for (const obj of payload.objetos_en_contenedor || []) agregar(itemObjeto(obj, 'contenedor'));
  for (const grupo of payload.estructuras || []) {
    for (const nodo of grupo.contenedores || []) agregar(itemContenedor(nodo, 'mueble'));
  }
  for (const obj of payload.muebles_objetos || []) agregar(itemObjeto(obj, 'suelto'));
  return items;
}

// ---------------------------------------------------------------------------
// Opciones del segundo combobox (dependen del criterio elegido)
// ---------------------------------------------------------------------------

/** Opciones reales del inventario cargado para el criterio elegido. */
export function opcionesFiltroMovil(
  criterio: CriterioFiltroMovil,
  items: ItemListaMovil[],
): OpcionFiltroMovil[] {
  const objetos = items.filter((item) => item.tipo === 'objeto');

  if (criterio === 'categoria') {
    const porClave = new Map<string, string>();
    let haySinCategoria = false;
    for (const item of objetos) {
      if (!item.categoriaClave) {
        haySinCategoria = true;
        continue;
      }
      if (!porClave.has(item.categoriaClave)) {
        porClave.set(item.categoriaClave, item.categoria || 'Sin categoría');
      }
    }
    const opciones = Array.from(porClave.entries())
      .map(([valor, etiqueta]) => ({ valor, etiqueta }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
    if (haySinCategoria) opciones.push({ valor: SIN_CATEGORIA, etiqueta: 'Sin categoría' });
    return opciones;
  }

  if (criterio === 'ubicacion') {
    const porClave = new Map<string, string>();
    let haySinUbicacion = false;
    for (const item of items) {
      if (!item.ubicacionClave) {
        haySinUbicacion = true;
        continue;
      }
      if (!porClave.has(item.ubicacionClave)) {
        porClave.set(item.ubicacionClave, item.ubicacionClave);
      }
    }
    const opciones = Array.from(porClave.entries())
      .map(([valor, etiqueta]) => ({ valor, etiqueta }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
    if (haySinUbicacion) opciones.push({ valor: SIN_UBICACION, etiqueta: 'Sin ubicación' });
    return opciones;
  }

  if (criterio === 'estado') {
    const estados = new Set(objetos.map((item) => item.estado).filter(Boolean));
    const decisiones = new Set(objetos.map((item) => item.decision));
    const opciones: OpcionFiltroMovil[] = [];
    for (const [valor, cfg] of Object.entries(ETIQUETA_ESTADO)) {
      if (estados.has(valor)) {
        opciones.push({ valor: 'estado:' + valor, etiqueta: cfg.texto, grupo: 'Estado de conservación' });
      }
    }
    for (const [valor, cfg] of Object.entries(ETIQUETA_DECISION)) {
      if (decisiones.has(valor)) {
        opciones.push({ valor: 'decision:' + valor, etiqueta: cfg.texto, grupo: 'Decisión' });
      }
    }
    if (decisiones.has('')) {
      opciones.push({ valor: 'decision:' + SIN_DECISION, etiqueta: 'Sin decisión', grupo: 'Decisión' });
    }
    return opciones;
  }

  // 'caja' · Capacidad / Estado de Caja: recorta SÓLO las cajas.
  if (!items.some((item) => item.origen === 'caja')) return [];
  return [
    { valor: 'caja:con_espacio', etiqueta: 'Con espacio disponible' },
    { valor: 'caja:llenas', etiqueta: 'Llenas / Lotes' },
  ];
}

// ---------------------------------------------------------------------------
// Filtrado acumulado
// ---------------------------------------------------------------------------

/** ¿El ítem entra en el filtro activo? (criterios incompatibles lo excluyen). */
function coincideFiltro(item: ItemListaMovil, filtro: FiltroMovilActivo): boolean {
  switch (filtro.criterio) {
    case 'categoria':
      if (item.tipo !== 'objeto') return false;
      return filtro.valor === SIN_CATEGORIA
        ? !item.categoriaClave
        : item.categoriaClave === filtro.valor;
    case 'ubicacion':
      return filtro.valor === SIN_UBICACION
        ? !item.ubicacionClave
        : item.ubicacionClave === filtro.valor;
    case 'estado': {
      if (item.tipo !== 'objeto') return false;
      if (filtro.valor.startsWith('estado:')) {
        return item.estado === filtro.valor.slice('estado:'.length);
      }
      const decision = filtro.valor.slice('decision:'.length);
      return decision === SIN_DECISION ? !item.decision : item.decision === decision;
    }
    case 'caja':
      if (item.origen !== 'caja') return false;
      return filtro.valor === 'caja:llenas' ? item.esLlena : !item.esLlena;
    default:
      return true;
  }
}

/**
 * Aplica TODOS los filtros activos (AND entre criterios distintos) más la
 * búsqueda libre por nombre, categoría, ubicación y contenedor.
 */
export function filtrarItemsMoviles(
  items: ItemListaMovil[],
  filtros: FiltroMovilActivo[],
  busqueda = '',
): ItemListaMovil[] {
  const activos = filtros.slice();
  const textoBuscado = normalizarTexto(busqueda);
  return items.filter((item) => {
    for (const filtro of activos) {
      if (!coincideFiltro(item, filtro)) return false;
    }
    if (!textoBuscado) return true;
    const heno = normalizarTexto([
      item.nombre,
      item.categoria,
      item.ubicacion,
      item.contenedor,
      item.tipoEtiqueta,
    ].join(' '));
    return heno.includes(textoBuscado);
  });
}
