// =============================================================================
// ATRIBUTOS TÉCNICOS DEL LIBRO PARA LA BÚSQUEDA DE PRECIO (ISBN + AUTOR)
// -----------------------------------------------------------------------------
// Fuente ÚNICA de los valores `isbn` y `autor` que viajan a
// GET /objetos/buscar_precio_referencia/. Los consumen las DOS pantallas que
// cotizan (alta de objetos y edición) y ambas comparten el MISMO markup de
// campos técnicos (`lib/objetos/objetoCamposEspecificosForm.ts`), que inyecta
// un input por clave con id `especifico-<clave>`.
//
// POR QUÉ: el backend ejecuta la búsqueda estricta por ISBN (edición exacta) y
// la complementaria por «Título + Autor» (mercado local) cuando la edición es
// rara o la muestra es escasa. Sin estos dos datos esa flexibilidad nunca se
// activaba y una edición de colección de $120.000 definía el valor del libro.
//
// Se leen los campos por id y, como red de seguridad, por `name` (el mismo
// formulario los publica con ambos nombres al enviar el multipart).
// =============================================================================

/** Valor actual de un campo técnico (`especifico-<clave>`) sin espacios extra. */
function valorCampoTecnico(clave: string): string {
  const porId = document.getElementById(`especifico-${clave}`) as HTMLInputElement | null;
  const porNombre = document.querySelector<HTMLInputElement>(`[name="${clave}"]`);
  return String(porId?.value ?? porNombre?.value ?? '').trim();
}

/**
 * ISBN/ISSN y autor del objeto que se está cotizando.
 * Ambos son opcionales: fuera de la familia «Libro» los campos ni existen y se
 * devuelven vacíos (el backend mantiene entonces la búsqueda histórica).
 */
export function isbnYAutorParaBusqueda(): { isbn: string; autor: string } {
  return {
    isbn: valorCampoTecnico('isbn_issn'),
    autor: valorCampoTecnico('autor'),
  };
}
