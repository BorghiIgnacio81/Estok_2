// =============================================================================
// GENERADOR VISUAL ESPACIAL · MOTOR DE PRESETS 2D (100% puro)
// -----------------------------------------------------------------------------
// Fuente ÚNICA de las 4 plantillas arquitectónicas que ofrece el modal de 3
// pasos en CADA nivel de la jerarquía de almacenamiento:
//
//   Nivel 1 · Planta / Propiedad        → distribución de casa/depto
//   Nivel 2 · Habitación / Muebles      → disposición de muebles en el cuarto
//   Nivel 3 · Mueble / Subdivisiones    → cajones, estantes, barrales, maleteros
//   Nivel 4 · Estante / Cajas           → cómo acomodar y apilar las cajas
//
// Todas las geometrías son PORCENTAJES del lienzo (0..100), el MISMO sistema de
// coordenadas que persiste el motor elástico (ui_left/ui_top/ui_width/ui_height).
// Este módulo no toca el DOM, no hace fetch y no conoce Tailwind.
// =============================================================================

// El contrato de persistencia (ui_*) vive en el motor elástico: import SOLO de
// tipo para no acoplar el motor de presets a la capa de red.
import type { ItemNuevoEspacial } from '../lienzoElastico';

export type NivelEspacial = 1 | 2 | 3 | 4;

/** Rectángulo sugerido por una plantilla (siempre en % del lienzo). */
export interface ElementoEspacial {
  nombre: string;
  icono: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Plantilla 2D con sus subdivisiones ya posicionadas. */
export interface PresetEspacial {
  id: string;
  titulo: string;
  descripcion: string;
  elementos: ElementoEspacial[];
}

/** Cantidades/tipos que el operador ajusta en el Paso 1 del modal. */
export interface ConfiguracionNivel {
  dormitorios: number;
  banos: number;
  cocina: number;
  living: number;
  muebles: number;
  mueblesAltos: number;
  cajones: number;
  estantes: number;
  barrales: number;
  maleteros: number;
  cajas: number;
  columnas: number;
  altura: number;
}

/** Selector rápido del Paso 1. */
export interface CampoConfiguracion {
  clave: keyof ConfiguracionNivel;
  etiqueta: string;
  icono: string;
  minimo: number;
  maximo: number;
  ayuda: string;
}

/** Encabezado contextual del nivel que abrió el generador. */
export interface ContextoGenerador {
  titulo: string;
  descripcion?: string;
}

/** Parámetros que recibe el motor desde cualquier nivel del árbol. */
export interface ParametrosGeneradorEspacial {
  nivel: NivelEspacial;
  contexto: ContextoGenerador;
  configuracionInicial?: Partial<ConfiguracionNivel>;
}

export const CONFIGURACION_POR_DEFECTO: ConfiguracionNivel = {
  dormitorios: 3,
  banos: 2,
  cocina: 1,
  living: 1,
  muebles: 6,
  mueblesAltos: 2,
  cajones: 4,
  estantes: 3,
  barrales: 1,
  maleteros: 1,
  cajas: 6,
  columnas: 3,
  altura: 2,
};

/** Mezcla los valores iniciales del nivel con los defaults del motor. */
export function configuracionDeNivel(
  _nivel: NivelEspacial,
  parcial: Partial<ConfiguracionNivel> = {},
): ConfiguracionNivel {
  const base: ConfiguracionNivel = { ...CONFIGURACION_POR_DEFECTO, ...parcial };
  // Coherencia: nunca menos muebles altos que muebles totales.
  base.mueblesAltos = Math.min(base.mueblesAltos, base.muebles);
  return base;
}


// -----------------------------------------------------------------------------
// HELPERS DE GEOMETRÍA
// -----------------------------------------------------------------------------

interface Etiqueta {
  nombre: string;
  icono: string;
}

const redondear = (n: number): number => Math.round(n * 100) / 100;

function caja(
  nombre: string,
  icono: string,
  left: number,
  top: number,
  width: number,
  height: number,
): ElementoEspacial {
  return {
    nombre,
    icono,
    left: redondear(left),
    top: redondear(top),
    width: redondear(width),
    height: redondear(height),
  };
}

/** Reparte los ítems en UNA fila horizontal de ancho `width` (default 96%). */
function fila(
  items: Etiqueta[],
  top: number,
  height: number,
  left = 2,
  width = 96,
  gap = 2,
): ElementoEspacial[] {
  if (items.length === 0) return [];
  const ancho = (width - gap * (items.length - 1)) / items.length;
  return items.map((it, i) =>
    caja(it.nombre, it.icono, left + i * (ancho + gap), top, ancho, height),
  );
}

/** Reparte los ítems en UNA columna vertical de alto `height` (default 96%). */
function columna(
  items: Etiqueta[],
  left: number,
  width: number,
  top = 2,
  height = 96,
  gap = 2,
): ElementoEspacial[] {
  if (items.length === 0) return [];
  const alto = (height - gap * (items.length - 1)) / items.length;
  return items.map((it, i) =>
    caja(it.nombre, it.icono, left, top + i * (alto + gap), width, alto),
  );
}

/** Grilla de cajas (filas × columnas) dentro de una región del lienzo. */
function grilla(
  items: Etiqueta[],
  columnas: number,
  left: number,
  top: number,
  width: number,
  height: number,
  gap = 2,
): ElementoEspacial[] {
  if (items.length === 0) return [];
  const cols = Math.max(1, Math.min(columnas, items.length));
  const filas = Math.ceil(items.length / cols);
  const ancho = (width - gap * (cols - 1)) / cols;
  const alto = (height - gap * (filas - 1)) / filas;
  return items.map((it, i) => {
    const f = Math.floor(i / cols);
    const c = i % cols;
    return caja(it.nombre, it.icono, left + c * (ancho + gap), top + f * (alto + gap), ancho, alto);
  });
}

const repeticion = (cantidad: number, base: string, icono: string): Etiqueta[] =>
  Array.from({ length: Math.max(0, cantidad) }, (_, i) => ({
    nombre: cantidad > 1 ? `${base} ${i + 1}` : base,
    icono,
  }));

// -----------------------------------------------------------------------------
// PASO 1 · CAMPOS RÁPIDOS POR NIVEL
// -----------------------------------------------------------------------------

const CAMPOS: Record<NivelEspacial, CampoConfiguracion[]> = {
  1: [
    { clave: 'dormitorios', etiqueta: 'Dormitorios', icono: '🛏️', minimo: 0, maximo: 4, ayuda: 'Cuartos para dormir' },
    { clave: 'banos', etiqueta: 'Baños', icono: '🚿', minimo: 0, maximo: 3, ayuda: 'Núcleos húmedos' },
    { clave: 'cocina', etiqueta: 'Cocina', icono: '🍳', minimo: 0, maximo: 1, ayuda: 'Sí / No' },
    { clave: 'living', etiqueta: 'Living', icono: '🛋️', minimo: 0, maximo: 1, ayuda: 'Sí / No' },
  ],
  2: [
    { clave: 'muebles', etiqueta: 'Muebles', icono: '🗄️', minimo: 1, maximo: 8, ayuda: 'Piezas dentro del cuarto' },
    { clave: 'mueblesAltos', etiqueta: 'Muebles altos', icono: '📚', minimo: 0, maximo: 6, ayuda: 'Roperos, bibliotecas' },
  ],
  3: [
    { clave: 'cajones', etiqueta: 'Cajones', icono: '🗃️', minimo: 0, maximo: 6, ayuda: 'Cajones del mueble' },
    { clave: 'estantes', etiqueta: 'Estantes', icono: '🗄️', minimo: 0, maximo: 6, ayuda: 'Repisas horizontales' },
    { clave: 'barrales', etiqueta: 'Barrales', icono: '👔', minimo: 0, maximo: 3, ayuda: 'Colgado de ropa' },
    { clave: 'maleteros', etiqueta: 'Maleteros', icono: '🧳', minimo: 0, maximo: 2, ayuda: 'Estantes altos' },
  ],
  4: [
    { clave: 'cajas', etiqueta: 'Cajas', icono: '📦', minimo: 2, maximo: 12, ayuda: 'Bultos a acomodar' },
    { clave: 'columnas', etiqueta: 'Columnas', icono: '📏', minimo: 1, maximo: 4, ayuda: 'Torres a lo ancho' },
    { clave: 'altura', etiqueta: 'Altura', icono: '🪜', minimo: 1, maximo: 3, ayuda: 'Cajas apiladas' },
  ],
};

/** Selectores rápidos del Paso 1 para el nivel pedido. */
export function camposDeNivel(nivel: NivelEspacial): CampoConfiguracion[] {
  return CAMPOS[nivel] ?? CAMPOS[1];
}

// -----------------------------------------------------------------------------
// NIVEL 1 · PLANTA / PROPIEDAD — 4 DISTRIBUCIONES DE CASA/DEPTO
// -----------------------------------------------------------------------------

interface EtiquetasNivel1 {
  dorm: Etiqueta[];
  banos: Etiqueta[];
  cocina: Etiqueta[];
  living: Etiqueta[];
}

function etiquetasNivel1(config: ConfiguracionNivel): EtiquetasNivel1 {
  return {
    dorm: repeticion(config.dormitorios, 'Dormitorio', '🛏️'),
    banos: repeticion(config.banos, 'Baño', '🚿'),
    cocina: config.cocina > 0 ? [{ nombre: 'Cocina', icono: '🍳' }] : [],
    living: config.living > 0 ? [{ nombre: 'Living', icono: '🛋️' }] : [],
  };
}

function presetsNivel1(config: ConfiguracionNivel): PresetEspacial[] {
  const { dorm, banos, cocina, living } = etiquetasNivel1(config);
  const humedos: Etiqueta[] = [...cocina, ...banos];

  // 1 · Franjas abiertas: dormitorios arriba, núcleo húmedo al medio, living abajo.
  const franjas: ElementoEspacial[] = [
    ...fila(dorm, 2, 34),
    ...fila(humedos, 38, 20),
    ...fila(living, 60, 38),
  ];

  // 2 · Núcleo húmedo central con dormitorios a ambos lados.
  const mitad = Math.ceil(dorm.length / 2);
  const nucleo: ElementoEspacial[] = [
    ...columna(dorm.slice(0, mitad), 2, 30, 2, 58),
    ...columna([...banos, ...cocina], 34, 32, 2, 58),
    ...columna(dorm.slice(mitad), 68, 30, 2, 58),
    ...fila(living, 64, 34),
  ];

  // 3 · Distribución en «L»: el living abraza la esquina inferior izquierda.
  const enEle: ElementoEspacial[] = [
    ...(living.length > 0
      ? [
          caja(living[0].nombre, living[0].icono, 2, 64, 96, 34),
          caja('Living · ala', living[0].icono, 2, 2, 28, 60),
        ]
      : []),
    ...fila(humedos, 2, 22, 32, 66),
    ...fila(dorm, 26, 36, 32, 66),
  ];

  // 4 · Pasillo distribuidor: corredor al medio y ambientes a los costados.
  const pasillo: ElementoEspacial[] = [
    ...fila(dorm, 4, 40),
    caja('Pasillo', '🚪', 2, 46, 96, 8),
    ...fila(humedos, 56, 20),
    ...fila(living, 78, 20),
  ];

  return [
    {
      id: 'n1-franjas',
      titulo: 'Franjas abiertas',
      descripcion: 'Zonas paralelas de norte a sur: dormir arriba, servicios al centro y living al frente.',
      elementos: franjas,
    },
    {
      id: 'n1-nucleo',
      titulo: 'Núcleo húmedo',
      descripcion: 'Baños y cocina concentrados en el centro; los cuartos se reparten a ambos lados.',
      elementos: nucleo,
    },
    {
      id: 'n1-ele',
      titulo: 'Distribución en «L»',
      descripcion: 'El living abraza la esquina y libera el ala derecha para dormitorios y servicios.',
      elementos: enEle,
    },
    {
      id: 'n1-pasillo',
      titulo: 'Pasillo distribuidor',
      descripcion: 'Corredor central que ordena el acceso a todos los ambientes de la propiedad.',
      elementos: pasillo,
    },
  ];
}

// -----------------------------------------------------------------------------
// NIVEL 2 · HABITACIÓN / MUEBLES — 4 DISPOSICIONES DEL CUARTO
// -----------------------------------------------------------------------------

interface EtiquetasNivel2 {
  altos: Etiqueta[];
  bajos: Etiqueta[];
  todos: Etiqueta[];
}

/**
 * ⚠️ TAXONOMÍA DEL BACKEND: un Contenedor raíz cuyo rótulo NO empieza por
 * «Mueble» cae al fallback CAJA (bulto de inventario) y el lienzo 2D lo trata
 * como contenido. Por eso los muebles del Nivel 2 llevan SIEMPRE el prefijo
 * canónico «Mueble …» (→ MUEBLE_MOVIL) y un icono que describe su función.
 */
const MUEBLES_ALTOS_N2: Etiqueta[] = [
  { nombre: 'Mueble ropero', icono: '🗄️' },
  { nombre: 'Mueble biblioteca', icono: '📚' },
  { nombre: 'Mueble cajonera', icono: '🗃️' },
  { nombre: 'Mueble placard', icono: '👔' },
];

const MUEBLES_BAJOS_N2: Etiqueta[] = [
  { nombre: 'Mueble cama', icono: '🛏️' },
  { nombre: 'Mueble escritorio', icono: '🖥️' },
  { nombre: 'Mueble mesa de luz', icono: '💡' },
  { nombre: 'Mueble sillón', icono: '🪑' },
  { nombre: 'Mueble TV', icono: '📺' },
];

/** Toma `cantidad` piezas de un catálogo, numerándolas para no colisionar. */
function tomarCatalogo(catalogo: Etiqueta[], cantidad: number): Etiqueta[] {
  return Array.from({ length: Math.max(0, cantidad) }, (_, i) => {
    const base = catalogo[i % catalogo.length];
    return { nombre: `${base.nombre} ${i + 1}`, icono: base.icono };
  });
}

function etiquetasNivel2(config: ConfiguracionNivel): EtiquetasNivel2 {
  const total = Math.max(1, config.muebles);
  const altos = tomarCatalogo(MUEBLES_ALTOS_N2, Math.min(config.mueblesAltos, total));
  const bajos = tomarCatalogo(MUEBLES_BAJOS_N2, total - altos.length);
  return { altos, bajos, todos: [...altos, ...bajos] };
}

function presetsNivel2(config: ConfiguracionNivel): PresetEspacial[] {
  const { altos, bajos, todos } = etiquetasNivel2(config);
  const total = todos.length;

  // 1 · Pared de dormir: todos los muebles contra la pared superior.
  const pared = fila(todos, 2, 34);

  // 2 · Estudio en «L»: cabecera superior + columna izquierda.
  const cabecera = todos.slice(0, Math.ceil(total / 2));
  const resto = todos.slice(cabecera.length);
  const estudio: ElementoEspacial[] = [
    ...fila(cabecera, 2, 34),
    ...columna(resto, 2, 32, 40, 58),
  ];

  // 3 · Isla central: la pieza principal al medio y el resto en dos columnas.
  const isla: ElementoEspacial[] = todos.length
    ? [
        caja(todos[0].nombre, todos[0].icono, 32, 34, 36, 32),
        ...columna(todos.slice(1, 1 + Math.ceil((total - 1) / 2)), 2, 26, 2, 96),
        ...columna(todos.slice(1 + Math.ceil((total - 1) / 2)), 72, 26, 2, 96),
      ]
    : [];

  // 4 · Zonas paralelas: altos a la izquierda, bajos a la derecha.
  const paralelas: ElementoEspacial[] = [
    ...columna(altos.length ? altos : todos, 2, 32, 2, 96),
    ...columna(altos.length ? bajos : [], 66, 32, 2, 96),
  ];

  return [
    {
      id: 'n2-pared',
      titulo: 'Pared de dormir',
      descripcion: 'Los muebles se alinean contra la pared principal y dejan el centro libre.',
      elementos: pared,
    },
    {
      id: 'n2-estudio',
      titulo: 'Estudio en «L»',
      descripcion: 'Cabecera de muebles altos y un ala lateral para escritorio o biblioteca.',
      elementos: estudio,
    },
    {
      id: 'n2-isla',
      titulo: 'Isla central',
      descripcion: 'La pieza protagonista ocupa el centro y las secundarias se recuestan en los bordes.',
      elementos: isla,
    },
    {
      id: 'n2-zonas',
      titulo: 'Zonas paralelas',
      descripcion: 'Dos columnas enfrentadas: estructuras altas a un lado y muebles bajos al otro.',
      elementos: paralelas,
    },
  ];
}

// -----------------------------------------------------------------------------
// NIVEL 3 · MUEBLE / SUBDIVISIONES — 4 ESTRUCTURAS INTERNAS
// -----------------------------------------------------------------------------

interface EtiquetasNivel3 {
  cajones: Etiqueta[];
  estantes: Etiqueta[];
  barrales: Etiqueta[];
  maleteros: Etiqueta[];
}

function etiquetasNivel3(config: ConfiguracionNivel): EtiquetasNivel3 {
  return {
    cajones: repeticion(config.cajones, 'Cajón', '🗃️'),
    estantes: repeticion(config.estantes, 'Estante', '🗄️'),
    barrales: repeticion(config.barrales, 'Barral', '👔'),
    maleteros: repeticion(config.maleteros, 'Maletero', '🧳'),
  };
}

function presetsNivel3(config: ConfiguracionNivel): PresetEspacial[] {
  const { cajones, estantes, barrales, maleteros } = etiquetasNivel3(config);
  const verticales = cajones.length ? cajones : estantes;
  const laterales = cajones.length ? estantes : [];

  // 1 · Torre de cajones: pila central con estantes y colgantes a los costados.
  const torre: ElementoEspacial[] = [
    ...columna(laterales, 2, 24, 2, 96),
    ...columna(verticales, 28, 44, 2, 96),
    ...columna([...barrales, ...maleteros], 74, 24, 2, 96),
  ];

  // 2 · Estantes corridos: repisas a todo lo ancho; maleteros arriba y cajones abajo.
  const altoEstantes = maleteros.length ? 28 : 2;
  const altoCajones = cajones.length ? 18 : 0;
  const corridos: ElementoEspacial[] = [
    ...fila(maleteros, 2, 22),
    ...columna(estantes, 2, 96, altoEstantes, 98 - altoEstantes - altoCajones),
    ...fila(cajones, cajones.length ? 78 : 98, altoCajones || 0),
    ...fila(barrales, cajones.length ? 60 : 64, 16),
  ];

  // 3 · Barral + maletero: colgado arriba, maletas al medio y el resto apilado.
  const barral = columna(barrales, 2, 96, 2, Math.min(42, 14 * Math.max(1, barrales.length)));
  const finBarral = 2 + Math.min(42, 14 * Math.max(1, barrales.length));
  const colgado: ElementoEspacial[] = [
    ...barral,
    ...fila(maleteros, finBarral + 2, 20),
    ...columna([...cajones, ...estantes], 2, 96, finBarral + 24, 98 - finBarral - 24),
  ];

  // 4 · Mixto: repisas arriba, barral al medio y una fila de cajones al pie.
  const mixto: ElementoEspacial[] = [
    ...columna(estantes, 2, 96, 2, 42),
    ...columna(barrales, 2, 96, 46, 16),
    ...fila([...cajones, ...maleteros], 64, 34),
  ];

  return [
    {
      id: 'n3-torre',
      titulo: 'Torre de cajones',
      descripcion: 'Cajones apilados en el centro, con estantes y colgantes a los lados.',
      elementos: torre,
    },
    {
      id: 'n3-estantes',
      titulo: 'Estantes corridos',
      descripcion: 'Repisas horizontales de lado a lado, con maleteros arriba y cajones al pie.',
      elementos: corridos,
    },
    {
      id: 'n3-barral',
      titulo: 'Barral + maletero',
      descripcion: 'Zona de colgado superior, maleteros al medio y cajones/estantes debajo.',
      elementos: colgado,
    },
    {
      id: 'n3-mixto',
      titulo: 'Mixto',
      descripcion: 'Combina repisas, barral y cajones en tres bandas bien diferenciadas.',
      elementos: mixto,
    },
  ];
}

// -----------------------------------------------------------------------------
// NIVEL 4 · ESTANTE / CAJAS — 4 MAQUETAS DE APILADO
// -----------------------------------------------------------------------------

function presetsNivel4(config: ConfiguracionNivel): PresetEspacial[] {
  // ⚠️ TAXONOMÍA: un contenedor cuyo rótulo EMPIEZA por «Caja» se clasifica como
  // CAJA/BULTO y el lienzo lo trata como contenido (no como subdivisión). Por eso
  // los compartimentos de esta maqueta llevan el rótulo «Compartimento N» con
  // icono 📦: reservan el lugar exacto de cada caja dentro del estante.
  const cajas = repeticion(config.cajas, 'Compartimento', '📦');
  const columnas = Math.max(1, config.columnas);

  // 1 · Torre única: todas las cajas en una sola columna central.
  const torre = grilla(cajas, 1, 32, 2, 36, 96);

  // 2 · Pares apilados: tantas columnas como indique el operador.
  const pares = grilla(cajas, columnas, 2, 2, 96, 96);

  // 3 · Fila baja corrida: una única hilera al ras del estante.
  const filaBaja = grilla(cajas, cajas.length, 2, 60, 96, 36);

  // 4 · Pirámide: base ancha y filas superiores más angostas.
  const base = Math.min(cajas.length, columnas + 2);
  const filas: Etiqueta[][] = [];
  let indice = 0;
  let anchoFila = base;
  while (indice < cajas.length) {
    const cuantas = Math.min(anchoFila, cajas.length - indice);
    filas.push(cajas.slice(indice, indice + cuantas));
    indice += cuantas;
    anchoFila = Math.max(1, anchoFila - 1);
  }
  const altoFila = 96 / Math.max(1, filas.length);
  const piramide: ElementoEspacial[] = [];
  filas.forEach((filaItems, i) => {
    const top = 2 + (filas.length - 1 - i) * altoFila;
    const anchoBloque = Math.min(96, 20 * filaItems.length - 2);
    const izquierda = 2 + (96 - anchoBloque) / 2;
    piramide.push(
      ...grilla(filaItems, filaItems.length, izquierda, top, anchoBloque, altoFila - 2, 2),
    );
  });

  return [
    {
      id: 'n4-torre',
      titulo: 'Torre única',
      descripcion: 'Una sola columna de cajas: máxima altura y mínimo ancho ocupado.',
      elementos: torre,
    },
    {
      id: 'n4-pares',
      titulo: 'Pares apilados',
      descripcion: 'Columnas parejas de cajas para aprovechar todo el ancho del estante.',
      elementos: pares,
    },
    {
      id: 'n4-fila',
      titulo: 'Fila baja corrida',
      descripcion: 'Todas las cajas en una hilera accesible a la altura de la mano.',
      elementos: filaBaja,
    },
    {
      id: 'n4-piramide',
      titulo: 'Pirámide',
      descripcion: 'Base ancha y filas superiores más cortas: estable y fácil de contar.',
      elementos: piramide,
    },
  ];
}

/** Las 4 plantillas 2D del nivel pedido (siempre devuelve exactamente 4). */
export function presetsDeNivel(nivel: NivelEspacial, config: ConfiguracionNivel): PresetEspacial[] {
  switch (nivel) {
    case 2:
      return presetsNivel2(config);
    case 3:
      return presetsNivel3(config);
    case 4:
      return presetsNivel4(config);
    default:
      return presetsNivel1(config);
  }
}

// -----------------------------------------------------------------------------
// MINIATURAS VECTORIALES + GEOMETRÍA PERSISTIBLE
// -----------------------------------------------------------------------------

/** Paleta pastel estable: cada subdivisión de la miniatura recibe su tono. */
const PALETA_PRESET = [
  '#fde68a',
  '#bfdbfe',
  '#fecaca',
  '#bbf7d0',
  '#ddd6fe',
  '#fed7aa',
  '#fbcfe8',
  '#c7d2fe',
];

/** Miniatura SVG 2D de una plantilla (misma proporción que el lienzo real). */
export function miniaturaPresetSvg(preset: PresetEspacial): string {
  const rects = preset.elementos
    .map((el, i) => {
      const relleno = PALETA_PRESET[i % PALETA_PRESET.length];
      return `<rect x="${el.left}" y="${el.top}" width="${el.width}" height="${el.height}" rx="2" fill="${relleno}" stroke="#92400e" stroke-width="1" />`;
    })
    .join('');
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${preset.titulo}" focusable="false"><rect width="100" height="100" fill="#fffbeb" />${rects}</svg>`;
}

/** Token CSS porcentual con dos decimales (contrato ui_* del backend). */
export function porcentaje(valor: number): string {
  return `${Math.round(valor * 100) / 100}%`;
}

/** Geometría lista para persistir (ui_left/ui_top/ui_width/ui_height). */
export function geometriaCssDe(elemento: ElementoEspacial): {
  ui_left: string;
  ui_top: string;
  ui_width: string;
  ui_height: string;
} {
  return {
    ui_left: porcentaje(elemento.left),
    ui_top: porcentaje(elemento.top),
    ui_width: porcentaje(elemento.width),
    ui_height: porcentaje(elemento.height),
  };
}

/** Rótulo legible del nivel (lo muestra el modal en la cabecera). */
export function nombreDeNivel(nivel: NivelEspacial): string {
  switch (nivel) {
    case 2:
      return 'Nivel 2 · Habitación / Muebles';
    case 3:
      return 'Nivel 3 · Mueble / Subdivisiones';
    case 4:
      return 'Nivel 4 · Estante / Cajas';
    default:
      return 'Nivel 1 · Planta / Propiedad';
  }
}

/** Siguiente geometría libre para una subdivisión manual (cascada dentro del lienzo). */
export function geometriaSugerida(indice: number): Pick<ElementoEspacial, 'left' | 'top' | 'width' | 'height'> {
  return {
    left: 6 + (indice % 4) * 16,
    top: 8 + (Math.floor(indice / 4) % 4) * 16,
    width: 26,
    height: 20,
  };
}

/**
 * Convierte un elemento de plantilla al contrato de alta del nivel
 * (`ItemNuevoEspacial`): nombre + icono + geometría `ui_*` en porcentaje.
 * Es el ÚNICO punto de traducción entre el generador y la persistencia.
 */
export function itemNuevoDesdeElemento(elemento: ElementoEspacial): ItemNuevoEspacial {
  return {
    nombre: elemento.nombre,
    icono: elemento.icono,
    ...geometriaCssDe(elemento),
  };
}



