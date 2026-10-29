// =============================================================================
// ASSETS DE INTERFAZ — RUTAS CANÓNICAS (fuente única)
// -----------------------------------------------------------------------------
// Todas las imágenes que la app usa como BOTÓN o ICONO de interfaz se declaran
// acá. Antes cada módulo repetía su propia ruta ('/mueble.png' aparecía en más
// de 15 archivos); con este módulo hay UN solo lugar donde viven y se documenta
// su tamaño de renderizado.
//
// OPTIMIZACIÓN (assets WebP redimensionados al tamaño real de renderizado):
//   · Los originales eran PNG/JPG de 1254x1254 a 1680x1527 (175 KB a 3,4 MB
//     cada uno) dibujados a 48-144 px en pantalla.
//   · Ahora son WebP de lado mayor 128 px (entre 1 y 5 KB cada uno). La única
//     excepción es el fondo de la cómoda del login —se pinta a 420 px de ancho—
//     que va a 768 px de ancho (~17 KB).
//   · Viven en frontend/public/ y están en la lista de precache del Service
//     Worker (frontend/public/sw.js). Si agregás o renombrás uno, actualizá LOS
//     DOS lugares y subí CACHE_VERSION en sw.js.
// =============================================================================

/** Objeto individual / mueble (antes /mueble.png). Render: 12-48 px. */
export const ASSET_MUEBLE = '/mueble.webp';

/** Contenedor pequeño / caja (antes /Nuevo Contenedor.png). Render: 20-64 px. */
export const ASSET_CAJA = '/nuevo-contenedor.webp';

/** Contenedor grande que anida contenedores (antes /archivador-login.png). Render: 64 px. */
export const ASSET_CONTENEDOR_GRANDE = '/contenedor-grande.webp';

/** CTA «Nuevo Objeto» (antes /nuevo objeto.png). Render: 96-144 px. */
export const ASSET_NUEVO_OBJETO = '/nuevo-objeto.webp';

/** Trigger «Nueva Categoría» (antes /Nueva Categoria.png). Render: 80-144 px. */
export const ASSET_NUEVA_CATEGORIA = '/nueva-categoria.webp';

/** CTA «Mudanza Inter-Estok» (antes /mudanza.png). Render: 96-144 px. */
export const ASSET_MUDANZA = '/mudanza.webp';

/** Botón «Nueva ubicación» del plano elástico (antes /nueva ubicacion.png). Render: 76 px. */
export const ASSET_NUEVA_UBICACION = '/nueva-ubicacion.webp';

/** Foto de reemplazo del objeto individual (antes /fluffy_plush_ball.jpg). Render: 48 px. */
export const ASSET_FOTO_OBJETO = '/fluffy-objeto.webp';

/**
 * Fondo de la cómoda del login (antes /archivador-login.png, 1680x1527).
 * Render: 420 px de ancho. Conserva EXACTA la relación de aspecto 1680/1527
 * porque los porcentajes de los cajones (login.astro) están calibrados sobre
 * ella.
 */
export const ASSET_LOGIN_COMODA = '/login-comoda.webp';
