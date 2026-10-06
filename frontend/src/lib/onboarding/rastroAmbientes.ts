// =============================================================================
// RASTRO DE AMBIENTES DEL ONBOARDING — PUENTE LOCAL PASO 2 → PASO 3
// -----------------------------------------------------------------------------
// El Paso 2 registra acá (sessionStorage) los ambientes REALES que acaba de
// crear. Si el fetch de red del Paso 3 llega vacío por una CARRERA DE DATOS
// (Django todavía consolidando el nuevo tenant), el embudo se hidrata con este
// rastro para que el usuario JAMÁS quede bloqueado frente a un «plano
// falsamente desierto».
//
// Rastro LIGERO y transitorio: vive sólo en la sesión del navegador y se
// descarta al cerrarla. NO reemplaza a la fuente de verdad (PostgreSQL): es una
// red de seguridad anti-latencia con los ids REALES para que el lienzo funcione.
// =============================================================================

/** Clave de sessionStorage donde vive el rastro. */
const CLAVE_RASTRO = 'estok_onboarding_ambientes';

/** Ambiente real mínimo (id + nombre) tal como lo devuelve el backend. */
export interface AmbienteRastro {
  id: string;
  nombre: string;
}

/** Reemplaza el rastro completo por la lista indicada (cierre del Paso 2). */
export function fijarRastroAmbientes(ambientes: readonly AmbienteRastro[]): void {
  const limpios: AmbienteRastro[] = [];
  for (const ambiente of ambientes) {
    if (ambiente?.id && ambiente?.nombre) {
      limpios.push({ id: String(ambiente.id), nombre: String(ambiente.nombre) });
    }
  }
  try {
    sessionStorage.setItem(CLAVE_RASTRO, JSON.stringify(limpios));
  } catch {
    /* sessionStorage no disponible: se ignora el rastro. */
  }
}

/** Limpia el rastro de la sesión (cierre exitoso del asistente). */
export function limpiarRastroAmbientes(): void {
  try {
    sessionStorage.removeItem(CLAVE_RASTRO);
  } catch {
    /* sessionStorage no disponible: no hay nada que limpiar. */
  }
}

/** Lee el rastro de la sesión (`[]` si no existe, está corrupto o vacío). */
export function leerRastroAmbientes(): AmbienteRastro[] {
  try {
    const bruto = sessionStorage.getItem(CLAVE_RASTRO);
    if (!bruto) return [];
    const datos = JSON.parse(bruto) as unknown;
    if (!Array.isArray(datos)) return [];
    const salida: AmbienteRastro[] = [];
    for (const item of datos as Array<Record<string, unknown>>) {
      const id = item?.id;
      const nombre = item?.nombre;
      if (id && nombre) salida.push({ id: String(id), nombre: String(nombre) });
    }
    return salida;
  } catch {
    return [];
  }
}
