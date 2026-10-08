// =============================================================================
// PORTALES DE ALMACENAMIENTO - FACHADA PÚBLICA (barrel)
// -----------------------------------------------------------------------------
// Este archivo era el monolito de la máquina de niveles (escala FIJA 0..4). Su
// lógica fue fragmentada en el paquete `src/lib/mapa/portales/` para respetar el
// límite de mantenibilidad (< 400 líneas por archivo):
//
//   - estadoPortales.ts         → pila de nodos + mutadores PUROS.
//   - panelesPortales.ts        → física dual de paneles, cabeceras y hosts.
//   - domPortales.ts            → helpers de DOM compartidos.
//   - datosNodosPortales.ts     → capa de datos (jerarquía real por parent_id).
//   - tarjetasHabitaciones.ts   → habitaciones con mini-mapa de espacios internos.
//   - tarjetasContenedores.ts   → interior jerárquico recursivo (tarjetas).
//   - grillaObjetosDirectos.ts  → Espacio Único: bloque + grilla directa.
//   - transitoInterno.ts        → Drop → «En Tránsito Interno» nativo.
//   - portalesAlmacenamiento.ts → máquina de la cascada (transición y refresco).
//   - portalesEnlaces.ts        → clics, drops y eventos públicos (entrada).
//
// Se conserva esta fachada re-exportando el API anterior para no romper a los
// consumidores que importan desde './portalesAlmacenamiento' (0 regresiones).
// =============================================================================

export { iniciarPortalesAlmacenamiento } from './mapa/portales/portalesEnlaces';
export {
  portalANodo,
  refrescarNivel,
  renderMinimapaDelNivel,
  transicionar,
  volverARaiz,
  volverNivel,
} from './mapa/portales/portalesAlmacenamiento';
export { panelesDe, HOSTS } from './mapa/portales/panelesPortales';
export type { PanelIzquierdo, PanelDerecho, Paneles } from './mapa/portales/panelesPortales';
export type { NodoPortal, TipoNodoPortal } from './mapa/portales/estadoPortales';
export { guardarEnContenedor, guardarEnUbicacion } from './mapa/portales/transitoInterno';
export type { CargaArrastrada, DestinoDrop } from './mapa/portales/transitoInterno';
