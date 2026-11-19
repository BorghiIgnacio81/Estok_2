// =============================================================================
// ALTA RÁPIDA · CLASIFICACIÓN DEL OBJETO AL CREARLO (Lote 31 · punto 4)
// -----------------------------------------------------------------------------
// Los disyuntores de components/objetos/ClasificacionAltaRapida.astro son
// OPCIONALES y MUTUAMENTE EXCLUYENTES (Caja ⇄ Mueble). Este módulo:
//   1. Unifica el estado visual de la opción activa (clase .alta-opcion-activa).
//   2. Lee la clasificación elegida EN EL MOMENTO DEL ENVÍO
//      (`camposClasificacionAlta`), sin guardar estado propio: así el reseteo
//      absoluto del formulario (objetoFormCore.resetFormularioCompleto, que
//      desmarca todos los checkboxes) deja la clasificación limpia por definición.
//
// Mapeo persistido (SIN migraciones, sólo campos ya existentes del modelo Objeto):
//   · `es_contenedor = true` → el objeto puede contener otros objetos dentro
//     (campo del modelo aceptado por ObjetoCreateSerializer).
//   · `esta_llena` + `cantidad_objetos_lote` → LOTE EN FOTO opcional (campos
//     espejo de Contenedor): la fila «Caja llena» se despliega al declarar
//     Caja/Mueble y la cantidad estimada sólo con ese tilde activo.
//   · `especificaciones.alta_rapida = 'caja' | 'mueble'` → conserva la DISTINCIÓN
//     elegida dentro del JSON libre `especificaciones` del objeto.
//     DRF parsea el string del multipart en su JSONField (JSONField.get_value
//     envuelve el valor de los formularios HTML como JSONString → json.loads).
//
// Ninguna casilla marcada → se envía `es_contenedor=false` (objeto simple).
//
// REGLA DE `es_contenedor` (única, aplicada también por el backend en
// `ObjetoCreateSerializer` + `clasificacion_contenedor_objeto.declara_contenedor`):
//   · DEFAULT de todo objeto nuevo: `es_contenedor = false`. Una mesa o una
//     escalera JAMÁS nacen cajas.
//   · Sólo lo pone en `true` la marca MANUAL del operador (estos disyuntores) o
//     una categoría EXPLÍCITA de bultos contenedores («Cajas y Contenedores»,
//     «Cajas», «Baúles», «Organizadores»). El frontend no infiere nada por su
//     cuenta: la categoría la evalúa el backend al guardar.
// =============================================================================

const SELECTOR = '[data-alta-clasificacion]';
const CLASE_ACTIVA = 'alta-opcion-activa';
const CLAVE_ESPECIFICACIONES = 'alta_rapida';
// CAJA LLENA / LOTE EN FOTO: controles condicionales del alta. No llevan
// `name` (no viajan en el FormData del formulario): su estado se lee del DOM.
const ID_FILA_CAJA_LLENA = 'altaCajaLlenaRow';
const ID_ESTA_LLENA = 'altaEstaLlena';
const ID_FILA_CANTIDAD_LOTE = 'altaCantidadLoteRow';
const ID_CANTIDAD_LOTE = 'altaCantidadLote';

/** Clasificaciones admitidas por el alta rápida. */
export type ClasificacionAlta = 'caja' | 'mueble';

export interface ClasificacionSeleccionada {
  /** true cuando el operador marcó «📦 Caja» o «🚪 Mueble». */
  esContenedor: boolean;
  /** Clasificación elegida (null = objeto simple, sin marcar nada). */
  clasificacion: ClasificacionAlta | null;
}

function casillas(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(SELECTOR));
}

/**
 * CAJA LLENA / LOTE EN FOTO (visibilidad condicional).
 *
 * La fila sólo existe cuando el operador declaró el objeto como Caja/Mueble
 * (`es_contenedor=True`). Al desmarcar la clasificación se oculta y se limpia
 * la declaración de lote: un objeto simple no puede nacer «lleno».
 */
export function sincronizarCajaLlenaAlta(): void {
  const fila = document.getElementById(ID_FILA_CAJA_LLENA);
  if (!fila) return;
  const esContenedor = casillas().some((casilla) => casilla.checked);
  fila.classList.toggle('hidden', !esContenedor);
  if (!esContenedor) {
    const check = document.getElementById(ID_ESTA_LLENA) as HTMLInputElement | null;
    if (check) check.checked = false;
    sincronizarCantidadLoteAlta();
  }
}

/** Muestra la cantidad estimada sólo con el tilde «Caja llena» activo. */
export function sincronizarCantidadLoteAlta(): void {
  const check = document.getElementById(ID_ESTA_LLENA) as HTMLInputElement | null;
  const fila = document.getElementById(ID_FILA_CANTIDAD_LOTE);
  const input = document.getElementById(ID_CANTIDAD_LOTE) as HTMLInputElement | null;
  const llena = check?.checked === true;
  fila?.classList.toggle('hidden', !llena);
  // Destildar la caja significa «con espacio disponible»: no se arrastra la
  // cantidad de un lote anterior.
  if (!llena && input) input.value = '';
}

/** Refleja el estado de las casillas en el resalte visual de su tarjeta. */
export function sincronizarClasificacionAlta(): void {
  for (const casilla of casillas()) {
    casilla
      .closest<HTMLElement>('[data-alta-opcion]')
      ?.classList.toggle(CLASE_ACTIVA, casilla.checked);
  }
  // El bloque «Caja llena» depende de la clasificación elegida.
  sincronizarCajaLlenaAlta();
}

/**
 * Inicializa los disyuntores de clasificación del alta de objetos.
 * Idempotente: se puede llamar desde /objetos/nuevo y desde el tutorial.
 */
export function initObjetoClasificacionAlta(): void {
  for (const casilla of casillas()) {
    if (casilla.dataset.altaActivo === 'true') continue;
    casilla.dataset.altaActivo = 'true';
    casilla.addEventListener('change', () => {
      // MUTUA EXCLUSIÓN: marcar una casilla desmarca la otra (Caja ⇄ Mueble).
      if (casilla.checked) {
        for (const otra of casillas()) {
          if (otra !== casilla) otra.checked = false;
        }
      }
      sincronizarClasificacionAlta();
    });
  }
  // CAJA LLENA: el campo «Cantidad estimada de objetos en el lote» se
  // despliega únicamente con el checkbox activo (visibilidad condicional).
  const estaLlena = document.getElementById(ID_ESTA_LLENA) as HTMLInputElement | null;
  if (estaLlena && estaLlena.dataset.altaLoteActivo !== 'true') {
    estaLlena.dataset.altaLoteActivo = 'true';
    estaLlena.addEventListener('change', sincronizarCantidadLoteAlta);
  }
  sincronizarClasificacionAlta();
}

/** Clasificación elegida AHORA (leída del DOM: no hay estado duplicado). */
export function leerClasificacionAlta(): ClasificacionSeleccionada {
  const marcada = casillas().find((casilla) => casilla.checked);
  const clasificacion =
    (marcada?.dataset.altaClasificacion as ClasificacionAlta | undefined) ?? null;
  return { esContenedor: clasificacion !== null, clasificacion };
}

/** Campos del alta rápida listos para el FormData del POST /api/objetos/. */
export function camposClasificacionAlta(): Record<string, string> {
  const { esContenedor, clasificacion } = leerClasificacionAlta();
  // CAJA LLENA / LOTE EN FOTO: sólo tiene sentido con una clasificación de
  // contenedor. La cantidad vacía viaja como 0 y el backend la normaliza a
  // null (el badge del listado sólo lee cantidades > 0).
  const checkLlena = document.getElementById(ID_ESTA_LLENA) as HTMLInputElement | null;
  const cantidadLote =
    (document.getElementById(ID_CANTIDAD_LOTE) as HTMLInputElement | null)?.value.trim() ?? '';
  const estaLlena = esContenedor && checkLlena?.checked === true;
  const campos: Record<string, string> = {
    es_contenedor: esContenedor ? 'true' : 'false',
    esta_llena: estaLlena ? 'true' : 'false',
    cantidad_objetos_lote: estaLlena && cantidadLote !== '' ? cantidadLote : '0',
  };
  if (clasificacion) {
    campos.especificaciones = JSON.stringify({ [CLAVE_ESPECIFICACIONES]: clasificacion });
  }
  return campos;
}
